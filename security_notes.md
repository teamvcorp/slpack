# Security review + remediation (2026-09-10)

Authorized review of the owner's own app. Three-part code audit (auth/session,
payments/PII, injection/uploads/infra), then remediation. Findings verified
against source; fixes verified against local dev. No production probing.

## Status by finding

| # | Sev | Finding | Status |
|---|---|---|---|
| C1 | Critical | `/api/contacts/*` PII + ID data anonymous (proxy `startsWith` prefix bug) | **FIXED** — exact-match allowlist; verified 401 without cookie |
| C3 | Critical | Auth fails open when `ADMIN_PASSCODE` unset | **FIXED** — fails closed in prod/preview |
| H5 | High | Public unlimited 1 GB blob-upload token minting | **FIXED** — rate-limited (12/10min), cap 50 MB |
| C2 | Critical | Payment amount client-controlled; no payment↔label binding | **ENFORCEMENT DONE (flag-gated OFF), verified vs Stripe test mode** — server recomputes freight from quotes + verifies PI before minting; rate-route + client wiring remain before it can be enabled (see below) |
| H1 | High | NoSQL operator injection into contacts filters | **FIXED** — `str()` coercion in lib/contacts.ts; verified |
| H7 | High | Zero security headers | **FIXED** — HSTS/nosniff/Referrer/frame-DENY/Permissions; CSP still deferred (Epson SDK eval) |
| M1 | Med | Static `sha256(PIN)` cookie; no revocation/audit | **FIXED (flag-gated)** — HMAC session tokens + auth log; enable via `SESSION_SECRET` |
| M2 | Med | `clientIp` trusts left-most XFF | **FIXED** — prefers `x-vercel-forwarded-for` |
| M3 | Med | Rate limiter non-atomic, no TTL/index | **FIXED** — atomic time-bucket + TTL/key indexes; verified under concurrency |
| M4 | Med | `isBlobUrl` validates vendor not our store | **FIXED** — `.public.` namespace + optional `BLOB_PUBLIC_HOSTNAME` exact pin |
| M5 | Med | Uncoerced `weightLbs` → stored XSS in admin print iframe | **FIXED** — coerced + esc'd |
| M6 | Med | Raw `err.message` to anonymous clients (3 public routes) | **FIXED** — generic message, detail server-side |
| M9 | Med | USPS EPS account number in runtime logs | **FIXED** — log line removed |
| H6 | High | No `payment_intent.succeeded` webhook (no proof of payment) | **FOUNDATION DONE** — webhook `/api/webhooks/stripe` records events; binding that reads it is deferred |
| H2 | High | `charge-saved-card`/`saved-cards` arbitrary email → card oracle + charge | **PARTIAL** — $2000 cap; full fix is part of payment binding |
| H3 | High | `register/checkout` trusts `shippingUSD`/`taxRate` | **OUTSTANDING** — part of payment binding |
| H4 | High | Void needs only shared passcode; no actor/refund | **OUTSTANDING** — best done with sessions (voidedBy) |
| M7 | Med | Terminal cancel/status accept any PI on shared account | **FIXED** — lib/terminalIntents ownership guard; verified |
| M8 | Med | Below-cost / underpriced detections log silently | **FIXED** — lib/alerts emails on both; needs RESEND_API_KEY |
| CSP | — | No Content-Security-Policy | **REPORT-ONLY SHIPPED** — enforcement (nonce + /admin unsafe-eval) deferred |
| P3 | Low | carrier path whitelist, send-link host, esc gaps, q cap, tracked PII file | **FIXED** |
| P3 | Low | stripe SDK two majors behind | **OUTSTANDING** (needs coordinated test) |

## What must be set in Vercel to activate flag-gated fixes

- **Session model (M1):** set `SESSION_SECRET` (long random) AND rotate
  `ADMIN_PASSCODE` to a strong non-numeric value. Both together. Until set, the
  app keeps the legacy cookie unchanged. Enabling logs everyone out once the
  passcode is rotated; do it off-shift.
- **Blob host pin (M4):** set `BLOB_PUBLIC_HOSTNAME` to this store's blob host
  (read it off any uploaded file URL, e.g. `abc123.public.blob.vercel-storage.com`).
- **Payment webhook (H6):** add a Stripe Dashboard endpoint at
  `https://<domain>/api/webhooks/stripe` for `payment_intent.succeeded`
  (and `.payment_failed` / `.canceled`), then set `STRIPE_WEBHOOK_SECRET` to its
  signing secret. Distinct from `STRIPE_IDENTITY_WEBHOOK_SECRET`. Until set, the
  endpoint returns 400 to everything (fails closed) and records nothing.
- **Money alerts (M8):** optional `ALERT_EMAIL` (defaults to the shop address);
  needs `RESEND_API_KEY` (already set) to actually send.

## Indexes created on Atlas (2026-09-10)
- `rateLimits`: unique `key`, TTL `expiresAt`
- `authEvents`: TTL `at` (90 days)
- `terminalIntents`: TTL `at` (1 day)
- `paymentEvents`: unique `eventId`

## Payment binding (C2) — status and what's left

**Done and verified against Stripe TEST mode (flag-gated OFF):**
- `lib/quoteStore.ts` — server quotes (create / getValid / consume; TTL + unique
  indexes on Atlas).
- `create-payment-intent`: with `PAYMENT_BINDING_ENABLED` and `quoteIds`, freight
  is recomputed from the stored quotes; the client amount is ignored for freight.
- `shipping/submit`: validates the quote and, for card sales, confirms the PI
  succeeded and names this quote BEFORE minting (402/409 otherwise); consumes the
  quote only after the label prints (Regenerate-safe). Freight logged is the
  quote's figure.
- `/api/webhooks/stripe` (H6) records payment_intent events.
- Verified: tampered $0.01 → PI for the real quote price; expired/missing quote →
  409; no PI → 402; mismatched PI → 402; valid PI → passes; **flag OFF →
  unchanged** (card, cash, and the Terminal reader all behave as today).

**Wiring — DONE for the standalone domestic UPS/FedEx shipping flow** (commit
07bc677), verified end-to-end against Stripe test mode:
- Rate routes store a quote per rate (`lib/quoteForRates.ts`, same price formula
  as the counter) and return `quoteId`; inert when the flag is off.
- StripeCheckout threads `quoteId`/`quoteIds`/`extrasUSD`/`paymentIntentId`
  (additive — server ignores them when the flag is off).
- submit binds standalone shipping; a reader PI (`metadata.source=terminal`) is
  accepted without the quote-name check, so **tap-and-pay is unaffected**;
  combined register+shipping (has a `transactionId`) stays on its legacy path.

**To turn it on (only when ready, and test first):**
1. Do a real browser checkout in Stripe **test mode** end-to-end (rate → card →
   label), for a normal card, a saved card, and the reader.
2. Decide the OVERRIDE question: under binding the server quote price wins, so a
   staff freight override is ignored. If overrides must keep working, tell me and
   I'll carry the override into the quote before you enable.
3. Set `PAYMENT_BINDING_ENABLED=true` — ideally in **preview** first, then prod.
4. (Optional but recommended) set `STRIPE_WEBHOOK_SECRET` + the Stripe endpoint.

**Not yet bound (left on their existing path so they don't break under the flag —
follow-up):** combined register+shipping, and international.

Interim protection stays in force regardless: the $2000 ceiling on both billing
routes plus the below-cost backstop + money alerts in submit.

## Not done, lower priority
- H4 void actor/refund reconciliation (do with sessions — record `voidedBy`).
- M7 terminal PI-ownership store.
- M8 alerting on money-anomaly error-log entries.
- CSP (needs the Epson SDK eval audit; scope `'unsafe-eval'` to /admin).
- stripe SDK 17→19 bump.
- `data/shipment-log.json` is untracked going forward but remains in git
  history; a history rewrite + repo-visibility check is a separate decision.

---

## Partner Shipping API — security posture (added 2026-09-10)

A new, isolated server-to-server API (`/api/partner/*`) for the sister site
mainstreet-shops.com. Built to the same "highest security" bar and deliberately
walled off from the counter. Contract: `PARTNER_API.md`. Ops: `reporting_notes.md`.

- **Isolation.** New routes (`/api/partner/*`), new libs (`lib/partner*.ts`), new
  collections (`partners`, `partnerQuotes`, `partnerShipments`, `partnerApiEvents`).
  The counter's submit/checkout/reports/StripeCheckout and `lib/quoteStore.ts` /
  `attachQuotes` are **not modified** — a partner-path bug cannot touch the
  counter's revenue book or payment binding. Carrier rate/label routes are reused
  by internal HTTP call (the same `x-admin-internal` mechanism `shipping/submit`
  already uses), not by code change.
- **Inert by default.** Every partner route 404s unless `PARTNER_API_SECRET` is
  set (fail-closed master switch, like `SESSION_SECRET` / `PAYMENT_BINDING_ENABLED`).
- **Credentials.** Static issued key: public `keyId` (X-Partner-Id) + high-entropy
  256-bit `secret` (X-Partner-Secret). Secret stored only as scrypt + per-credential
  salt, compared in constant time; shown once, never retrievable (rotate only).
  Verified in the **Node** route (`withPartnerAuth`), never the Edge proxy — the
  proxy merely steps aside for `/api/partner/`. A partner credential is a pair of
  headers, never the admin cookie or `x-admin-internal`, so it can never satisfy
  the admin gate. Unknown `keyId` burns an equal-cost dummy scrypt (no user
  enumeration by timing).
- **Abuse limits + audit.** Per-IP auth-failure lockout and per-credential
  throughput ceiling (`lib/rateLimit.ts`); every request appended to
  `partnerApiEvents` (never throws). A leaked key is bounded: rate-limited,
  deactivatable, and useless without a real succeeded payment.
- **Payment before every label.** The API retrieves the Stripe PaymentIntent on
  the shared account and requires `succeeded`, USD, `amount_received ≥` the quote
  retail, and — when present — `metadata.quoteId` matching. One PaymentIntent binds
  to one shipment (reuse across quotes → 402). Same guarantee as the counter's
  payment binding, applied to an externally created PI.
- **Retail-only egress.** Cost/list/rateSource/costBasis are consumed server-side
  to price the quote and then dropped; the quote store keeps cost server-side; the
  partner history projection excludes cost and label bytes. Partners never see
  carrier cost or margin.
- **Server-forced parameters.** Origin (the shop), carrier account, and price are
  all set server-side. The caller supplies only destination + package + recipient,
  and `recipient.zip` must equal the quoted ZIP. IDOR-safe: quotes and history are
  scoped to the authenticated `partnerId`, never a client-supplied id.
- **No double-mint.** The quote is claimed atomically before minting; a label
  failure after payment is recorded `needs_review` and the shop is notified rather
  than released for an automated retry (which could double-charge a carrier label).
  Retries are idempotent on `quoteId`.
