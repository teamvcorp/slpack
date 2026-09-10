# Storm Lake Pack & Ship — Partner Shipping API

**Audience:** the mainstreet-shops.com engineering team.
**Status:** contract v1. This document is the source of truth; build against it.

This API lets mainstreet-shops.com create real shipping labels through Storm Lake
Pack & Ship, fully server-to-server (no human touch). Your site prices shipping
at **retail**, charges the consumer, and then calls this API to produce the
label. The label ships on the shop's carrier account (the shop is billed the
carrier cost; you charged retail; the difference is the shop's margin).

**You never see carrier cost or margin** — the API returns retail only.

---

## 1. Base URL & environment

| Environment | Base URL |
|---|---|
| Production | `https://www.slpacknship.com` |
| (Staging, if provided) | given separately |

All endpoints are under `/api/partner/`. All requests and responses are JSON
(`Content-Type: application/json`). All calls are **server-to-server** — never
call this API from a browser or expose the credential to a client.

---

## 2. Authentication

Every request must include two headers with the credential the shop issued you:

```
X-Partner-Id:     <your key id>
X-Partner-Secret: <your secret>
```

- Keep the secret server-side only (environment variable / secret manager).
- If the credential is ever exposed, ask the shop to rotate it; the old secret
  stops working immediately.
- Missing/invalid credential → **401** `{ "error": "Unauthorized" }`.
- The API is rate-limited per credential; on a burst you may get **429** with a
  `Retry-After` header — back off and retry.

---

## 3. The integration sequence (do it in this order)

```
1. POST /api/partner/rates       → you receive retail options, each with a quoteId
2. (your checkout) charge the consumer for the chosen retail shipping amount,
   creating a Stripe PaymentIntent on the SHARED Stripe account, and set
   metadata.quoteId = <the quoteId the consumer chose>.
3. after the PaymentIntent SUCCEEDS,
   POST /api/partner/shipments    → { quoteId, paymentIntentId, ... }
   → self_ship: label is emailed to the business email, tracking returned
   → pickup_pack: the shop is notified to pick up & pack; no label returned
```

Notes:
- **A label is only ever produced after the API verifies the PaymentIntent** it
  is given (succeeded, on the shared Stripe account, amount at least the retail
  quote, and — strongly recommended — `metadata.quoteId` matching). So the
  consumer's payment must complete before you call `/shipments`.
- A **quoteId expires ~30 minutes** after `/rates`. If it expires you'll get
  **409**; just call `/rates` again.
- Use the SAME Stripe account the shop uses (you already share it). The
  PaymentIntent may be for the whole order (product + shipping); the API only
  requires it to have succeeded and to cover at least the retail shipping amount.
- **One PaymentIntent → one shipment.** A given `paymentIntentId` can create only
  one shipment; reusing it for a second quote is rejected (`402`). Create a
  PaymentIntent per order. Stamping `metadata.quoteId` is strongly recommended so
  the API can also assert the payment matches the exact quote, not just the amount.

---

## 4. `POST /api/partner/rates`

Quote a shipment. Returns one retail option per available carrier service.
The **origin is always the shop** — you never send it.

### Request

```json
{
  "destination": {
    "zip": "90210",
    "city": "Beverly Hills",
    "state": "CA",
    "country": "US",
    "residential": true
  },
  "package": {
    "weightLbs": 3.0,
    "lengthIn": 12,
    "widthIn": 10,
    "heightIn": 8
  },
  "mode": "self_ship"
}
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `destination.zip` | string | yes | US ZIP (5-digit; ZIP+4 accepted). |
| `destination.city` | string | recommended | Improves rating accuracy; some ZIPs require it. |
| `destination.state` | string | recommended | 2-letter. |
| `destination.country` | string | no | `"US"` only in v1 (domestic). |
| `destination.residential` | boolean | no | Default `false`. Residential surcharges apply when `true`. |
| `package.weightLbs` | number | yes | Pounds, > 0. |
| `package.lengthIn` / `widthIn` / `heightIn` | number | yes | Inches, > 0. |
| `mode` | string | yes | `"self_ship"` or `"pickup_pack"`. For `pickup_pack` the returned retail **includes the shop's packing fee**. |

### Response `200`

```json
{
  "quoteExpiresInSeconds": 1800,
  "rates": [
    {
      "quoteId": "b1a2…",
      "carrier": "ups",
      "serviceName": "UPS Ground",
      "serviceCode": "03",
      "retailUSD": 18.45,
      "deliveryDate": "2026-09-15",
      "estimatedDays": 3
    },
    {
      "quoteId": "c9f0…",
      "carrier": "fedex",
      "serviceName": "FedEx 2Day",
      "serviceCode": "FEDEX_2_DAY",
      "retailUSD": 31.10,
      "deliveryDate": "2026-09-12",
      "estimatedDays": 2
    }
  ]
}
```

- `retailUSD` is exactly what you should charge the consumer for shipping (it
  already includes the packing fee when `mode` is `pickup_pack`).
- `quoteId` is opaque; pass the chosen one to `/shipments`. Do not reuse a
  quoteId for more than one shipment (it is single-use).
- No cost, list price, or margin is ever returned.

### Errors
`401` auth · `422` `{ "error": "…", "field": "…" }` invalid input · `429` rate-limited · `502` a carrier was unreachable (retry).

---

## 5. `POST /api/partner/shipments`

Create the shipment for a paid quote.

### Request

```json
{
  "quoteId": "b1a2…",
  "paymentIntentId": "pi_3ABC…",
  "mode": "self_ship",
  "businessEmail": "owner@mainstreet-shops.com",
  "orderRef": "MS-10432",
  "recipient": {
    "name": "Jane Buyer",
    "phone": "3105551234",
    "email": "jane@example.com",
    "street": "123 Palm Dr",
    "street2": "",
    "city": "Beverly Hills",
    "state": "CA",
    "zip": "90210",
    "country": "US"
  }
}
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `quoteId` | string | yes | From `/rates`. Must be unexpired and unused. |
| `paymentIntentId` | string | yes | The succeeded Stripe PaymentIntent (shared account) that paid for this shipment. |
| `mode` | string | yes | Must match the `mode` used at `/rates` for this quote. |
| `businessEmail` | string | yes (self_ship) | Where the label is emailed. |
| `orderRef` | string | no | Your order id, stored for reconciliation. |
| `recipient.*` | object | yes | Full ship-to. `recipient.zip` **must equal** the ZIP quoted at `/rates` (you can't quote one place and ship to another). `street2` optional. |

The package dimensions/weight and the price come from the stored quote — you do
**not** resend them here.

### Response `200` — self_ship

```json
{
  "id": "shp_7fa…",
  "status": "shipped",
  "carrier": "ups",
  "serviceName": "UPS Ground",
  "trackingNumber": "1ZX6H3440322397015",
  "labelEmailedTo": "owner@mainstreet-shops.com"
}
```

The label (PDF/GIF) is emailed to `businessEmail`. The label bytes are **not**
returned in the API response — email is the delivery channel.

### Response `200` — pickup_pack

```json
{
  "id": "shp_7fa…",
  "status": "awaiting_pack"
}
```

No label is produced. The shop is notified to pick up the product and pack it;
the shop generates and applies the label when it ships.

### Response `502` — self_ship label could not be produced

If the payment verified but the carrier label could not be created, you get:

```json
{
  "id": "shp_7fa…",
  "status": "needs_review",
  "message": "The label could not be created automatically. The shop has been notified and will complete this shipment."
}
```

This is **not** a lost order. The payment is kept, the shop is notified, and the
shop completes the shipment by hand. **Do not re-quote or re-charge**, and do not
treat it as a failure to the consumer. Retrying the same request returns this
same result (see idempotency below).

### Errors

| Status | Meaning | Action |
|---|---|---|
| `401` | bad/missing credential | check headers |
| `402` | payment not verified, or already used for another shipment | the PaymentIntent isn't succeeded, doesn't cover the retail, doesn't match this quote, or was already spent on a different quote — one payment = one shipment |
| `409` | quote expired or already used | call `/rates` again for a fresh quote |
| `422` | validation error `{ "error", "field" }` | fix the field |
| `429` | rate-limited | honor `Retry-After` |
| `502` | carrier label failed (`status:"needs_review"`, above) or no carrier reachable | the shop is handling `needs_review`; a bare `502` with no body id is retryable |

**Idempotency / retries:** every call is idempotent on `quoteId`. A quote is
single-use, so once it has produced a shipment — `shipped`, `awaiting_pack`, or
`needs_review` — retrying `/shipments` with that same `quoteId` returns the
**same** result (including on a lost-response retry). You will never be
double-charged a carrier label for one quote. If a quote never produced a
shipment and has expired, you get `409` — request a fresh quote.

---

## 6. `GET /api/partner/shipments` (optional — your history)

Returns the shipments **you** created (retail figures only). Scoped to your
credential automatically; you cannot see other partners' or the counter's data.

```
GET /api/partner/shipments?limit=50
→ 200 { "shipments": [ { "id", "createdAt", "status", "carrier", "serviceName",
                         "trackingNumber", "retailUSD", "mode", "orderRef",
                         "recipient": { "name", "city", "state", "zip" } }, … ] }
```

---

## 7. Quick reference — a full self-ship flow

```
POST /api/partner/rates
  headers: X-Partner-Id, X-Partner-Secret
  body: { destination:{zip,city,state,residential}, package:{weightLbs,lengthIn,widthIn,heightIn}, mode:"self_ship" }
→ pick a rate, note its quoteId and retailUSD

(your Stripe) create + confirm a PaymentIntent for the order incl. retailUSD,
  with metadata.quoteId = <quoteId>   → status must become "succeeded"

POST /api/partner/shipments
  headers: X-Partner-Id, X-Partner-Secret
  body: { quoteId, paymentIntentId, mode:"self_ship", businessEmail, orderRef,
          recipient:{ name, phone, email, street, city, state, zip, country } }
→ { status:"shipped", trackingNumber, labelEmailedTo }
→ the label arrives by email at businessEmail
```

---

## 8. Conventions & guarantees

- **Retail-only:** carrier cost, list price, and margin are never in any response.
- **Origin is fixed** to the shop; you only ever specify the destination.
- **Payment first:** no label without a verified, succeeded PaymentIntent that
  covers the quote.
- **Single-use quotes**, ~30-minute expiry.
- **US domestic** in v1 (UPS, FedEx, USPS). International may come later.
- All money is USD; amounts are decimal dollars (e.g. `18.45`).

*Contract questions or a needed field? Contact the shop before assuming — this
document will be versioned when it changes.*
