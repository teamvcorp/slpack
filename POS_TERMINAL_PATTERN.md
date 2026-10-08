# POS Terminal Picker — reusable pattern

How to let an admin pick a card reader from a dropdown of **live, network-connected**
terminals, persist that choice, and take secure in-person payments. Written as a spec
to reproduce in another codebase; Next.js App Router + MongoDB + Stripe here, but the
shape ports to any stack.

---

## Three decisions that make this work

**1. Server-driven, not browser-driven.** The reader talks to Stripe's cloud; your API
tells Stripe which reader to push a payment to. The browser never touches the reader.
No `@stripe/terminal-js`, no connection tokens, no LAN socket, no WebUSB. This is why
it works from any admin device, including a phone, and why nothing breaks when the
counter tablet is on a different VLAN than the reader.

**2. Select, don't register.** Register the physical device **once** in the Stripe
Dashboard. Your app only *lists and selects*. Registering in-app duplicates the device
every time someone re-pairs, and leaves stale entries that look identical in a dropdown.
This matters doubly if the Stripe account is shared across sites — the reader is an
account-level resource, not yours to claim.

**3. "Live on the network" comes from Stripe, not from you.** Do not scan the LAN, ping
an IP, or ask the browser to find the device. The reader continuously polls Stripe, so
`reader.status` is already authoritative: `online` / `offline`. You get liveness,
firmware, IP and last-action diagnostics from one API call, from anywhere.

> If you try to detect liveness yourself you will end up with a mDNS/ARP scan that fails
> on guest wifi, needs native permissions, and still can't tell you whether Stripe can
> reach the device — which is the only thing that actually matters.

---

## Data model

One document. Do not build a table.

```jsonc
// settings collection, _id: "stripeTerminal"
{
  "readerId": "tmr_xxx",   // selected device
  "label":    "Front counter",
  "enabled":  false        // separate from selection: lets staff turn the reader
                           // off without losing which one it is
}
```

Keep `enabled` distinct from `readerId`. A reader being out for repair is a different
state from no reader having been chosen, and collapsing them forces staff to re-pick.

---

## Endpoints

| Route | Method | Purpose |
|---|---|---|
| `/api/admin/terminal/readers` | GET | **Dropdown source.** `terminal.readers.list({limit:100})` → `{id,label,status,deviceType,serialNumber,location}` |
| `/api/admin/settings/terminal` | GET | Current selection. `?status=1` additionally retrieves the reader for live status + diagnostics |
| `/api/admin/settings/terminal` | PUT | Save selection and/or toggle `enabled` |
| `/api/admin/settings/terminal` | DELETE | Clear the selection (recovery from a stale/deleted reader) |
| `/api/terminal/collect` | POST | Create the PaymentIntent, push to reader |
| `/api/terminal/status` | POST | Poll until resolved |
| `/api/terminal/cancel` | POST | Cancel the in-progress action |

**PUT must treat `readerId` as optional.** The same endpoint handles "change the reader"
and "just toggle enabled"; if an absent `readerId` overwrites the stored one with `""`,
flipping the checkbox silently unpairs the counter. Check field *presence*, not truthiness:

```ts
const hasReaderField = typeof body.readerId === 'string';
const readerId = hasReaderField ? body.readerId.trim() : existing?.readerId ?? '';
if (enabled && !readerId) return 400; // can't enable nothing
```

---

## The dropdown

```
[ Front counter · online · stripe_s700    ▾ ]   [Refresh list]
```

- Options render as `label · status · deviceType`. **Status in the option text** is the
  whole point — it's how staff see the reader is live before trying to charge.
- Selecting immediately PUTs and enables. No separate save button; a dropdown that needs
  confirming gets left half-set.
- Empty list is a real state, not an error: *"No readers on this account. Register the
  reader once in the Stripe Dashboard, then Refresh."*
- Show a **diagnostics panel** for the chosen reader: mode (live/test), device type,
  firmware, serial, IP, and last action with failure message. Firmware and serial are
  exactly what Stripe support asks for, and a lagging firmware version explains
  "chip doesn't work but swipe does" without a support ticket.
- Surface a lookup failure loudly. A selected-but-unreachable reader must say *why*
  (deleted, or registered in the other test/live mode) — never render a blank panel.

---

## Security — the non-negotiables

**Gate the admin routes.** Everything under `/api/admin/*` requires the admin session.
Use exact-path allowlisting for public routes; a `startsWith` prefix check on an
allowlist is how private endpoints get exposed.

**The server owns the amount. Always.** Never charge a total posted by the browser.
Re-price the cart server-side from your own catalog and charge that:

```ts
const priced = await priceCart(stripe, items, taxRate);  // re-fetches each price
const amount = Math.round(priced.totalUSD * 100);        // integer cents throughout
```

**If the Stripe account is shared between sites, claim every PaymentIntent.** This is
the subtle one. `terminal.readers.list` and `paymentIntents.retrieve` are account-wide,
so without an ownership record *any* site on the account can poll another site's payment
status or cancel its in-progress sale.

```ts
// on create: tag it and record it
metadata: { source: 'terminal', site: SITE_TAG }
await recordTerminalIntent(pi.id);

// on status/cancel: refuse what isn't ours
if (!(await isOurTerminalIntent(id))) return 404;  // 404, not 403 — don't confirm it exists
```

Give that collection a TTL index; terminal intents resolve in seconds.

**Mode discipline.** A reader registered in test mode is invisible to live keys and vice
versa. Display `livemode` in the diagnostics panel — "my reader disappeared" is almost
always this.

**Don't apply a card surcharge in person.** Card funding (credit vs debit) isn't known
until the tap, so a surcharge computed beforehand is guesswork.

---

## Payment flow

```ts
const pi = await stripe.paymentIntents.create({
  amount, currency: 'usd',
  payment_method_types: ['card_present'],
  capture_method: 'automatic',
  metadata: { source: 'terminal', site: SITE_TAG },
});
await recordTerminalIntent(pi.id);
await stripe.terminal.readers.processPaymentIntent(readerId, { payment_intent: pi.id });
// client polls status ~1.8s, ~90s timeout
```

Poll resolution: retrieve the PI → `succeeded` | `canceled`; otherwise retrieve the
reader → `action.status` is `in_progress` | `failed` (with `action.failure_message`).
Cancel via `readers.cancelAction(readerId)`.

**If `processPaymentIntent` throws, cancel the PaymentIntent you just created.** Otherwise
a reader that was offline or busy leaves an orphaned PI sitting in your Stripe dashboard
for every failed attempt.

---

## Failure modes to handle explicitly

| Condition | Handling |
|---|---|
| Reader busy (shared account, another site mid-sale) | Detect `terminal_reader_busy`; return 409 with "wait a moment and try again" — recoverable, not an error |
| Reader offline | Fails at `processPaymentIntent`; cancel the PI, show the reader status |
| Selected reader deleted in Dashboard | `'deleted' in reader` → prompt to re-select |
| Wrong test/live mode | Retrieve throws; surface `livemode` |
| Stripe key missing | 503 with a clear message; **keep a manual payment path working** |

That last row matters most: the reader is a convenience, not the only way to take money.
Never gate the whole checkout behind it.

---

## Build checklist

1. Settings document + GET/PUT/DELETE, with `readerId` optional on PUT.
2. `readers` list endpoint → dropdown with status in the option text.
3. Selection auto-saves and enables; diagnostics panel with mode/firmware/serial/IP.
4. `collect` / `status` / `cancel`, amount re-priced server-side, integer cents.
5. Ownership record + TTL index if the Stripe account is shared.
6. Orphan-PI cancellation on push failure; busy-reader 409.
7. Verify in **test mode** first, then re-verify one charge in live.

---

## Reference implementation

`app/api/admin/terminal/readers/route.ts` · `app/api/admin/settings/terminal/route.ts` ·
`app/api/terminal/{collect,status,cancel}/route.ts` · `lib/terminalIntents.ts` ·
`app/admin/components/stripeTerminal.ts` · the Card Reader card in
`app/admin/settings/page.tsx`.

Operator instructions: `STRIPE_TERMINAL_SETUP.md`. Device and API specifics (SDK version,
pinned `apiVersion`, reader network priority, pairing codes): `stripe_terminal_s710_notes.md`.
