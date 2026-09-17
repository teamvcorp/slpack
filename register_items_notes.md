# Register items — admin editor notes (2026-09-17)

Staff can add / edit / remove register items and arrange them into groups from
`/admin/register/items`, without opening the Stripe Dashboard.

## The one thing to understand first

**Register items ARE Stripe products.** There is no local product table and never
was. `app/api/register/products/route.ts` lists active Stripe products and keeps
the ones tagged `metadata.account_id === REGISTER_ACCOUNT_ID`. The admin editor
drives the Stripe API directly, so Stripe stays the single source of truth and
there is no second copy to drift.

Only **presentation** (category names + button order) lives in Mongo.

## ⚠️ The Stripe account is SHARED with another site

This is why the `account_id` metadata filter exists at all — without it this shop
would see the sister site's catalog. Consequences:

1. **Every mutation must call `assertOwnedProduct()`** (`lib/registerCatalog.ts`)
   before writing. The product id comes from the browser and is untrusted;
   without the check an admin here could rename, reprice or archive the other
   site's products.
2. It returns **404, not 403**, on a mismatch — a 403 would confirm that some
   other id exists over there, turning the route into an existence oracle.
3. **Newly created products must be stamped** with `metadata.account_id`, or they
   simply won't appear on the register. To staff that reads as "my new item
   vanished", so `GET /api/admin/register/items` returns the `accountId` and the
   editor footnotes it.

## Stripe Prices are immutable — the swap sequence

A price cannot be edited. Changing one means minting a new Price and repointing
the product at it. **Order is load-bearing** (`app/api/admin/register/items/[id]/route.ts`):

```
1. products.retrieve(id)                       → assert account_id   (else 404)
2. assert product.active === true                                    (else 409)
3. prices.create({ product, currency:'usd', unit_amount }, { idempotencyKey })
4. products.update(id, { default_price: newPrice.id })
5. prices.update(oldPriceId, { active: false })   ← best effort, non-fatal
```

- **Never archive before the swap.** Archive-first plus a failed create leaves the
  product with no active price — it disappears from the register mid-shift.
- Stripe also **refuses to deactivate a price that is still `default_price`**, so
  step 5 must follow step 4 regardless.
- Step 5 failing leaves a stray active non-default price. The register reads
  `default_price` only, so it never sees it. Harmless.
- **Idempotency keys** on create: counter tablets lag and staff double-tap.

**Removal is archive (`active:false`), not delete.** Stripe can't hard-delete a
product that has prices, and archiving is what we want anyway — the button
disappears immediately while past sales and reports still resolve the item.

## Money safety — why this was built this way

`lib/registerPricing.ts` `priceCart()` re-fetches `unit_amount` from Stripe for
every line carrying a `priceId`, and trusts the **client's** amount only when
`priceId` is null (the ad-hoc "Custom price" path). Because every item created
here has a real Stripe price, **that guarantee holds with zero changes to
`priceCart`** — no money-path file was touched by this feature.

A local price catalog was considered and rejected: DB items would arrive with
`priceId: null` and be priced from the browser. `security_notes.md` already lists
H3 (`register/checkout` trusts `shippingUSD`/`taxRate`) as outstanding; this
feature deliberately does not add a sibling to it.

**The layout document contains no prices, and must not.** That split is what
stops a corrupt or hand-edited layout from influencing a charge.

## Archiving/repricing is safe mid-sale (verified by reading the code)

`app/api/register/checkout/route.ts:65` and `app/api/terminal/collect/route.ts`
build the PaymentIntent from a **raw integer amount**. There is no Checkout
Session, no `line_items`, no price reference in the charge. An archived price is
still retrievable and still returns its `unit_amount`.

So: an item archived or repriced while sitting in an open cart on another
terminal **completes at the price the cashier quoted**. That is correct POS
behavior — silently repricing a customer's total mid-transaction would be worse.
The register refetches on `visibilitychange` so grids converge within seconds.

## Layout storage

`slpack.settings`, `_id: 'registerCatalog'` — alongside `packingPricing` and
`carrierIncentives`, following `settings/packing-pricing/route.ts` exactly.

```ts
{ categories: [{ id: uuid, name: string, productIds: string[] }], updatedAt }
```

- **Membership is the array.** Which `productIds` array an id sits in IS its
  category; its index IS its sort order. No parallel map, no numeric sort field —
  two representations of one fact is how a grid ends up showing a button twice.
- **Category `id` is a UUID, not the name**, so renaming never orphans items.
- **Order as an array index** makes gaps and duplicate positions impossible, and
  makes a reorder ONE document write instead of one API call per item. (Storing
  `sort` in Stripe metadata would have meant ~48 sequential API writes to drag an
  item up a 25-item list, non-atomically.)
- **Optimistic concurrency** on `updatedAt`: two admins reordering on two
  terminals would otherwise silently clobber each other. Mismatch → 409 "reload".
- `normalizeCatalog()` re-validates **on read as well as write** — a doc edited
  straight in Atlas must not be able to break the counter.

## Degradation (all deliberate)

| Broken | Result |
|---|---|
| No layout doc | Flat alphabetical grid — exactly the pre-feature register |
| Mongo unreachable | Same; `products` route catches and falls back to `groupProducts(products, null)` |
| Layout references a dead id | Silently skipped |
| Product created in the Stripe Dashboard | Appears under **Other**, fully sellable — the escape hatch when this app misbehaves |
| Stripe down / no key | Existing empty-state message; **"Custom price" still takes money** |

Grouping is a pure enhancement layered on a working register. Selling never
depends on it.

## Validation (reject, never clamp — the packing-pricing house rule)

- Name: NFC-normalized, whitespace-collapsed, 1–120 chars, ASCII control chars
  rejected. **NFC matters**: composed vs decomposed "café" are different strings
  that render identically on a receipt.
- **Duplicate active names → 409.** Not stylistic: `app/api/reports/sales/route.ts:41`
  summarizes sales as `` `${qty}× ${name}` `` and receipts print names only, so two
  items called "Tape" at different prices make the revenue book permanently
  ambiguous with no id to disambiguate them.
- Price: finite, `0 ≤ n ≤ 5000`, **at most 2 decimals** (more is a typo, not a
  price). **$0.00 is allowed** — a free bag is a legitimate item.
- Emoji/accents are **allowed with a soft UI warning** (ESC/POS code pages garble
  them), as are names over 32 chars (thermal receipts are 42 columns —
  `lib/eposReceipt.ts` `COLS`).

## Caching

`app/api/register/products/route.ts` previously had `export const revalidate = 60`
— the only caching directive in the app — meaning a corrected price could take a
minute to reach the counter. Now `dynamic = 'force-dynamic'`, client fetch uses
`cache: 'no-store'`.

⚠️ **Do not "optimize" this with `stripe.products.search`.** It supports
`metadata['account_id']` filtering and would replace the pagination with one
query, but it is **eventually consistent with ~1 minute of lag** on newly created
and updated objects — reintroducing exactly the staleness that was removed.

## Files

- `lib/registerCatalog.ts` — ownership guard, validation, `groupProducts()`, `normalizeCatalog()`
- `lib/registerCatalogStore.ts` — the layout doc; the only Mongo writer
- `app/api/admin/register/items/route.ts` — GET list, POST create
- `app/api/admin/register/items/[id]/route.ts` — PATCH edit, DELETE archive
- `app/api/admin/register/catalog/route.ts` — GET/PUT/DELETE layout
- `app/admin/register/items/page.tsx` + `app/admin/components/RegisterItemsEditor.tsx`
- Modified: `app/api/register/products/route.ts`, `app/admin/register/page.tsx`,
  `app/admin/settings/page.tsx`

Auth is free via `proxy.ts` (matcher covers `/admin/:path*` and `/api/:path*`) —
no per-route check, same as the four existing settings routes.

## Still to verify against the live account

Written and compile-verified; **not yet exercised against real Stripe.** Priority
order:

1. **The ownership guard.** Create a Stripe product with a *different*
   `account_id`; confirm it doesn't appear, then `PATCH` it with a valid admin
   cookie → **must be 404, product unchanged.** Anything else: stop and fix.
2. Price edit → Dashboard shows a new active price that IS `default_price`, old
   one archived. Double-click Save → only one new price (idempotency).
3. `12.345` / `-1` / `9999` → 400 each; `0` → accepted.
4. Two windows: A carts an item, B reprices it, A completes a cash sale → stored
   `SaleRecord` and printed receipt both show the **old** price.
5. Name `<img src=x onerror=alert(1)>` → sell → emailed receipt renders it as
   literal text (`lib/receipt.ts` `esc()`; `security_notes.md` M5 records this
   exact class shipping once before).
6. 60-char name and `Café ☕` → **print on the real Epson** and read the paper.
7. Two terminals reorder simultaneously → second save gets 409, first survives.
8. Money-path regression: one cash, one card, one Terminal reader, one combined
   sale. No money-path file changed, so a failure means something deviated.
