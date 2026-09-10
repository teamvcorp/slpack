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

**Remaining before the flag can be turned on (do NOT enable until then — with it
on and no quoteIds, submit 409s every shipment):**
1. Rate routes create a quote per offered rate and return its `quoteId`
   (server-compute cost basis + retail; the authority is `lib/shippingPricing.ts`
   + `lib/carrierIncentive.ts`).
2. Checkout components thread `quoteId` (per package) into create-payment-intent
   (as `quoteIds` + `extrasUSD`) and into submit (`quoteId` + `paymentIntentId`).
   The **Terminal reader flow is out of scope** — it stays on its own route.
3. A real browser checkout in Stripe **test mode** end-to-end, then flip the flag
   in preview before production. Needs `STRIPE_WEBHOOK_SECRET` for the webhook.

Interim protection stays in force: the $2000 ceiling on both billing routes plus
the below-cost backstop + money alerts in submit.

## Not done, lower priority
- H4 void actor/refund reconciliation (do with sessions — record `voidedBy`).
- M7 terminal PI-ownership store.
- M8 alerting on money-anomaly error-log entries.
- CSP (needs the Epson SDK eval audit; scope `'unsafe-eval'` to /admin).
- stripe SDK 17→19 bump.
- `data/shipment-log.json` is untracked going forward but remains in git
  history; a history rewrite + repo-visibility check is a separate decision.
