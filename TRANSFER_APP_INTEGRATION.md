# Transfer app — per-shop revenue from the Stripe platform account

**Who this is for:** whoever builds the app that works out what each shop is owed and
moves the money. It assumes no access to any shop's codebase or database.

---

## The setup

- Many shops, each running its **own deployment with its own database**.
- All of them create charges on **one shared Stripe platform account**.
- Each shop is registered as a Stripe **connected account**, but **Connect is not used
  to route money.** No `transfer_data`, no `on_behalf_of`, no destination charges. Every
  payment settles into the single platform balance and pays out to one bank account.

**The consequence that shapes this whole app:** Stripe's own connected-account reporting
shows nothing, because no charge is linked to a connected account. Per-shop revenue
exists only in **charge metadata**, which each shop stamps (see `SHOP_CHARGE_TAGGING.md`).

You need nothing from any shop's database. Stripe is the single source of truth.

---

## Read Balance Transactions, not Charges

This is the most important instruction in this document.

```js
const txns = await stripe.balanceTransactions.list({
  created: { gte: startUnix, lt: endUnix },
  expand: ['data.source'],
  limit: 100,
});
// auto-paginate: for await (const t of stripe.balanceTransactions.list({...}))
```

Every row gives you three numbers that `charges.list` does not:

| Field | Meaning |
|---|---|
| `amount` | gross, in cents |
| `fee` | what Stripe actually took |
| `net` | what actually landed in the balance |

**Net is the only honest basis for a transfer.** Refunds show up here automatically as
negative rows, and the totals tie exactly to the bank deposit.

> **Do not** list charges and estimate the fee as 2.9% + 30¢. Real rates vary by card
> type — Amex, international cards, and card-present all differ — so an estimate drifts
> from the actual payout. That drift is invisible per transaction and surfaces months
> later as a shortfall nobody can account for.

---

## Attributing each row

```js
for (const txn of txns) {
  const shopId = await resolveShopId(txn, stripe);
  bucket[shopId ?? 'unattributed'].push(txn);
}
```

### Payments
`txn.source` expanded is a Charge. Read `source.metadata.shop_id`.

### Refunds (`txn.type === 'refund'`)
The source is a Refund object, which **carries no metadata of its own.** Resolve through
the original payment:

```js
const refund = txn.source;                       // expanded
const pi = await stripe.paymentIntents.retrieve(refund.payment_intent);
const shopId = pi.metadata?.shop_id;
```

Skipping this means a refunded sale still counts as revenue and the shop gets paid for
money you gave back. Cache the lookup — refunds are rare but the retrieve is a round trip.

### Everything else
Rows of type `stripe_fee`, `payout`, `adjustment`, `transfer` and chargeback types are
**platform-level, not shop revenue**. Report them in their own section. Do not fold them
into any shop, and do not silently drop them — a payout row that vanishes makes your
totals stop tying to the bank.

### The `unattributed` bucket is mandatory

Any row you can't resolve goes into an explicit `unattributed` bucket that is **visible
in the UI**. Never assign it to a default shop and never drop it.

Expect this bucket to be large at first: tagging only starts when each shop deploys the
change, and **historical charges can never be back-filled** — Stripe has no record of
which shop they came from. Track each shop's go-live date so the boundary is explainable.

---

## What to show per shop, per period

| Column | How |
|---|---|
| Gross collected | Σ `amount` |
| Stripe fees | Σ `fee` |
| Net received | Σ `net` |
| Surcharge collected | Σ `metadata.surcharge_usd` (× 100 for cents) |
| Platform spread | surcharge collected − Stripe fees |
| **Owed to shop** | net − platform spread |

The intended model: the customer pays a processing surcharge, and the platform keeps the
difference between that and Stripe's real cost.

### ⚠️ Two things to confirm with the platform operator first

1. **The surcharge may not be switched on.** In the reference implementation it is gated
   behind an environment flag that is currently **off**, so `computeCardFee()` returns 0
   and no customer pays a fee. While that's the case, `surcharge_usd` is `"0.00"`,
   platform spread is **negative by exactly the Stripe fees**, and "owed to shop" equals
   gross — i.e. the platform absorbs processing costs. Build the columns anyway; just
   don't assume the surcharge is live.

2. **A 5% *card surcharge* is not card-network compliant.** Visa caps surcharges at ~3%
   and at the merchant's actual cost, and surcharging debit cards is prohibited outright —
   which is why the reference implementation caps at 3% and applies the fee to credit
   only. A flat 5% **platform service fee**, charged on all payment methods equally, is a
   different structure and is generally permitted. Same money, different legal basis.
   Confirm which one is intended before building reports around 5%.

---

## Reconciliation

**Reconcile to the payout, not to the calendar day.** A payout is what actually hit the
bank, so it's the only figure that can be checked against a statement:

```js
const payouts = await stripe.payouts.list({ limit: 10 });
const rows = await stripe.balanceTransactions.list({
  payout: payouts.data[0].id,
  expand: ['data.source'],
  limit: 100,
});
// Σ net of these rows === payout.amount
```

Group *those* rows by `shop_id` and you have a defensible per-shop split of a real
deposit, not an estimate.

### Operational notes

- **Integer cents end to end.** Stripe gives cents; keep them. Convert to dollars only
  for display. Never let a money value be `null` or `undefined` in a total — in the
  reference app a `null` cost crashed an entire reports page, and the lesson recorded
  there is worth repeating: *wrong money is worse than a crash.* Guard with
  `typeof x === 'number' && Number.isFinite(x)` — `Number(null)` is `0`, which quietly
  produces a wrong total instead of an error.
- **Idempotency:** key stored rows on `balance_transaction.id`. Re-running a period must
  not double-count.
- **Time zones:** use the shop's local day boundaries, not UTC. The reference app had a
  real bug where UTC windows made "today" start at 19:00 local the previous day, so
  revenue read as zero after 7pm.
- **Pagination:** always auto-paginate. A silently truncated list is a quietly wrong
  revenue total.
- **Stripe API keys:** use a **restricted key** scoped read-only to balance transactions,
  charges, payment intents and payouts. Do not reuse a shop's secret key, and do not give
  this app write access to charges.

---

## The metadata contract

What the shops stamp, per `SHOP_CHARGE_TAGGING.md`:

| Key | Always present? | Notes |
|---|---|---|
| `shop_id` | Required | The grouping key. Stable and permanent per shop. |
| `source` | Required | `register`, `combined`, `terminal`, `shipping`, `partner`, `online` |
| `surcharge_usd` | When surcharging | String, 2 decimals, e.g. `"1.45"` |
| `connected_account` | Optional | `acct_…`, the intended payee |
| `partner_id` | Partner charges only | Identifies the referring partner site |

Treat every one as possibly absent and handle it — these are stamped by independent
deployments on their own schedules, so partial rollout is the normal state, not an error.

---

## Build order

1. Pull one day of balance transactions and print gross / fee / net. Confirm it matches
   the Dashboard before writing any grouping logic.
2. Add `shop_id` grouping and the `unattributed` bucket.
3. Add refund resolution through the parent PaymentIntent; verify with a test refund that
   the right shop's total goes down.
4. Add the fee/spread columns once the operator has confirmed the surcharge model.
5. Switch the period selector to payout-based reconciliation.
6. Only then wire up anything that moves money.
