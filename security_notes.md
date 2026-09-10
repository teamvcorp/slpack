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
| C2 | Critical | Payment amount client-controlled; no payment↔label binding | **PARTIAL** — $2000 ceiling stopgap shipped; full binding OUTSTANDING (see below) |
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

## OUTSTANDING: payment binding (C2/H2/H3/H6) — the remaining structural fix

The charge amount is computed in the browser and trusted verbatim; label
issuance is not bound to a verified payment. The correct fix is a server-side
quote/order record: persist each quoted rate server-side (carrier, service,
cost, server-computed retail via `carrierAnchoredPrice`, expiry); have the
browser send only a `quoteId`; recompute the charge from the stored quote;
require a verified `paymentIntentId` (status succeeded, amount ≥ quote) in
`/api/shipping/submit` before minting the label; and add a
`payment_intent.succeeded` webhook (H6) as the server-side source of truth.

This closes C2, H2, H3, and H6 together. The server pricing authority already
exists (`lib/shippingPricing.ts`). What remains touches the three checkout
components (StripeCheckout, RegisterCheckout, CombinedCheckout) plus the
terminal path, and MUST be verified through a real Stripe **test-mode**
checkout in the browser — it cannot be validated from the command line. It also
needs `STRIPE_WEBHOOK_SECRET` configured. Do this as a focused session with the
app running and Stripe test keys.

Interim protection in place: the $2000 ceiling on both billing routes (refuses
absurd amounts, logs them), plus the existing below-cost backstop in submit.

## Not done, lower priority
- H4 void actor/refund reconciliation (do with sessions — record `voidedBy`).
- M7 terminal PI-ownership store.
- M8 alerting on money-anomaly error-log entries.
- CSP (needs the Epson SDK eval audit; scope `'unsafe-eval'` to /admin).
- stripe SDK 17→19 bump.
- `data/shipment-log.json` is untracked going forward but remains in git
  history; a history rewrite + repo-visibility check is a separate decision.
