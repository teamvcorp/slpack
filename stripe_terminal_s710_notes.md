# Stripe Terminal — Reader S700/S710 integration notes

In-person card payments via a Stripe Reader S700/S710, added alongside the existing on-screen
card entry. **Server-driven** integration: the reader talks directly to Stripe's cloud and our
API drives it — no browser/LAN connection, no connection token, no `@stripe/terminal-js`.

## Facts
- SDK `stripe@^17.7.0`, pin `apiVersion: '2025-02-24.acacia'` (matches all other PI routes).
- Reader network priority: **Ethernet › WiFi › cellular**; admin PIN **07139**; pairing code from
  the reader's Settings → Generate pairing code (~10-min TTL) — used **only** for the one-time
  Dashboard registration, not in-app.
- Reader must be registered in the same **mode** as `STRIPE_SECRET_KEY` (test/live) and only appears
  in this app's reader list for that mode.
- **No credit surcharge in person** — card funding isn't known before the tap; charge base total.

## Payment flow (per charge)
```js
const pi = await stripe.paymentIntents.create({
  amount, currency: 'usd',
  payment_method_types: ['card_present'],
  capture_method: 'automatic',
});
await stripe.terminal.readers.processPaymentIntent(readerId, { payment_intent: pi.id });
// poll: retrieve PI → 'succeeded' | 'canceled'; else retrieve reader → action.status
//   'in_progress' | 'failed' (action.failure_message). Cancel: readers.cancelAction(readerId).
```
Completion is detected by **polling** (the app has no webhooks) — client polls
`/api/terminal/status` ~every 1.8s, ~90s timeout.

## Code map (this repo)
- **SHARED reader, SELECT not register:** the S710 is one account-level device shared across sites;
  register it ONCE in the Stripe Dashboard. This app lists + selects it — there is NO in-app
  registration (the old `register` route was removed).
- **Config** (`slpack.settings` doc `_id:'stripeTerminal'` `{ readerId, label, enabled }`):
  - `app/api/admin/settings/terminal/route.ts` — GET / PUT `{ readerId?, label?, enabled }` (stores the
    SELECTED reader) / DELETE (clears selection). `GET ?status=1` returns live online/offline +
    firmware/serial via `stripe.terminal.readers.retrieve` (guards `Reader | DeletedReader`), plus
    `readerError` on failure.
  - `app/api/admin/terminal/readers/route.ts` — GET `stripe.terminal.readers.list()` → the selectable
    readers for the Settings dropdown.
- **Payment** (reads `readerId`/`enabled` server-side; amounts server-priced for register/combined):
  - `app/api/terminal/collect/route.ts` — create card_present PI (metadata `site` = SITE_URL host, for
    shared-account attribution) + `processPaymentIntent`. Body `{ items, taxRate, shippingUSD? }`
    (priceCart) OR `{ amountUSD, description }` (shipping-only). Maps `terminal_reader_busy` → 409.
  - `app/api/terminal/status/route.ts` — POST `{ paymentIntentId }` → `{ status, failureMessage? }`.
  - `app/api/terminal/cancel/route.ts` — `cancelAction` + `paymentIntents.cancel` (best-effort).
- **Client** `app/admin/components/stripeTerminal.ts` — `getTerminalEnabled()` (60s cache),
  `startReaderPayment`, `waitForReader(pid, {signal})`, `cancelReaderPayment`.
- **UI** — `RegisterCheckout` / `CombinedCheckout` / `StripeCheckout` each gain a `'reader'` step, a
  "💳 Tap on reader" primary button (+ "Key in" secondary = existing CardElement), a
  `handleChargeOnReader` + `handleCancelReader`, and a "Follow prompts on the reader" screen.
  Success routes into the SAME completion the manual card path uses:
  - RegisterCheckout → `recordSale('card', { paymentIntentId })` → `finishWithSale`.
  - CombinedCheckout → `finalize('card', 0, piId)` (finalize gained an optional `piIdOverride`).
  - StripeCheckout → `generateLabels('card', 0)`.
- **Settings UI** — `app/admin/settings/page.tsx` "Card reader" card: status, enable toggle, pair form.

## Behavior / reuse
- Reader sales record **identically** to manual card sales (`paymentMethod: 'card'`, PI id in
  `paymentIntentId`, `cardFeeUSD` 0) and print through the existing `receiptPrinter`/`eposReceipt`
  path (card → no drawer, no surcharge line).
- `priceCart` (`lib/registerPricing.ts`) keeps register/combined amounts authoritative.
- All routes admin-gated by `proxy.ts`; guard on `STRIPE_SECRET_KEY` (503).

## Future
- Webhooks (`terminal.reader.action_succeeded`, `payment_intent.succeeded`) could replace polling.
- In-person surcharge would require auth + manual capture and reading `card_present.funding` post-tap.
