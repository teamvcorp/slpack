# USPS International API notes (v3) — research 2026-09-10

For adding USPS as a third carrier to the international shipping flow (currently
UPS + FedEx only). Auth is the SAME as the domestic USPS route — reuse
`getUspsToken()` + `BASE` from `lib/uspsToken.ts` (OAuth client-credentials, one
token covers all APIs, 8h TTL; `USPS_SANDBOX=true` → `apis-tem.usps.com`).

Sources: developers.usps.com (International Prices 3.0, International Labels 3.0),
USPS/api-examples GitHub (issue #18 has a concrete intl-prices request).

## 1. International Prices (rates)

- **Endpoint:** `POST {BASE}/international-prices/v3/base-rates-list/search`
  (NOTE: international is **`base-rates-list`**, not the domestic `base-rates`.)
- **Request body (confirmed from issue #18 + docs):**
  ```json
  {
    "originZIPCode": "50588",
    "foreignPostalCode": "77210",
    "destinationCountryCode": "MX",     // ISO alpha-2
    "weight": 3.0,                        // pounds (confirm oz vs lb in sandbox)
    "length": 12.0, "width": 10.0, "height": 8.0,
    "mailingDate": "2026-09-10",         // YYYY-MM-DD
    "mailClass": "PRIORITY_MAIL_INTERNATIONAL",
    "priceType": "COMMERCIAL"            // like domestic; COMMERCIAL = our cost
  }
  ```
- **`mailClass` is REQUIRED** despite the schema marking it optional (issue #18:
  a missing mailClass 400s with the enum list). So, exactly like the DOMESTIC
  route, query **one mailClass per call** and fan out with `Promise.allSettled`.
- **International mailClass enum:**
  - `FIRST-CLASS_PACKAGE_INTERNATIONAL_SERVICE` (FCPIS — cheapest, ≤ 4 lb / ~64 oz)
  - `PRIORITY_MAIL_INTERNATIONAL` (PMI)
  - `PRIORITY_MAIL_EXPRESS_INTERNATIONAL` (PMEI)
  - `GLOBAL_EXPRESS_GUARANTEED` (GXG — FedEx-carried, priciest, most limited)
- **Response:** `base-rates-list/search` returns a LIST of price points (mirror
  the domestic parse: `data.rates ?? data.pricePoints`, pick the best `price ??
  totalBasePrice`). Confirm exact shape in sandbox.
- **May also accept** `processingCategory`, `rateIndicator`, `destinationEntry
  FacilityType`, `extraServices` (analogous to domestic). Start minimal (the
  issue's working request omitted them) and add only if the API demands them.

## 2. International Labels

- **Endpoint:** `POST {BASE}/international-labels/v3/international-label`
- Creates the label (TIFF/PDF) AND the customs form + Shipping Services File per
  USPS Pub 199. Supports FCPIS, PMI, PMEI.
- **Request (shape to CONFIRM against the OpenAPI spec / sandbox before building
  the label path):** `imageInfo` (image type/format), `toAddress`, `fromAddress`,
  `packageDescription` (mailClass, rateIndicator, weight, dimensions,
  processingCategory, extraServices), and a **customs** block — items array with
  description, quantity, value, weight, `hsTariffNumber`, `countryOfOrigin`,
  plus `customsContentType` (MERCHANDISE / GIFT / DOCUMENTS / SAMPLE / RETURN /
  OTHER). This maps directly to the commodity/HS data the app ALREADY collects
  for UPS/FedEx intl (see `lib/shippingIntl.ts` + `intl/hs-search`).
- Response: label image (base64) + tracking barcode; may be multipart.
- **CONFIRMED against USPS sandbox (apis-tem.usps.com) 2026-09-10** — a real
  201 label minted. Verified request shape:
  ```jsonc
  {
    "imageInfo": { "imageType": "PDF", "labelType": "4X6LABEL" },
    "toAddress": {
      "firstName", "lastName", "firm?", "streetAddress", "secondaryAddress?",
      "city", "province?", "postalCode?",
      "country": "Mexico",            // full name — REQUIRED
      "countryISOAlpha2Code": "MX",   // ISO-2 — ALSO REQUIRED (both needed)
      "phone?"
    },
    "fromAddress": { "firstName","lastName","streetAddress","city","state","ZIPCode","phone?" },
    "packageDescription": {
      "weight","weightUOM":"lb","length","width","height","dimensionsUOM":"in",
      "mailClass","rateIndicator":"SP","processingCategory":"MACHINABLE",
      "destinationEntryFacilityType":"NONE","priceType":"COMMERCIAL","mailingDate"
    },
    "customsForm": {
      "customsContentType": "MERCHANDISE",   // MERCHANDISE|GIFT|SAMPLE|DOCUMENTS|RETURNED_GOODS|OTHER
      "AESITN": "NOEEI 30.37(a)",            // REQUIRED. Exemption legend < $2,500; real ITN at/over
      "contentComments?",
      "contents": [{
        "itemDescription", "itemQuantity",
        "itemTotalValue",        // line total (unit × qty)
        "itemTotalWeight",       // NOT `weight`
        "weightUOM": "lb",
        "HSTariffNumber?",       // digits only; omit if unknown
        "countryofOrigin"        // note lowercase 'of'
      }]
    }
  }
  ```
- **RESPONSE is `multipart/form-data`, NOT JSON:** a `labelMetadata` JSON part
  (`internationalTrackingNumber`, `postage`, `SKU`, weight) + a `labelImage` part
  carrying the label PDF as **base64** (USPS integrates the CN22/CN23 customs form
  INTO the label — no separate invoice doc). The label route parses the multipart
  and reads `internationalTrackingNumber` + `postage`.
- **Auth:** sandbox accepts the PRODUCTION USPS creds (CRID/MID/EPS) — payment-
  authorization 200 on apis-tem.usps.com. (Prod payment-auth returned a transient
  401 "trouble validating your credit card" during probing — unrelated to schema.)
- **$2,500 AES guard:** the label route blocks (422) at/over `EEI_FILING_THRESHOLD_USD`
  because the exemption legend is only valid below it and the counter can't file AES.

## 3. Gotchas / decisions

- **Country + postal:** international uses `destinationCountryCode` (ISO-2) +
  `foreignPostalCode` (free-form, may be blank for countries without postal
  codes) — NOT the domestic `destinationZIPCode`.
- **Origin** is always the shop ZIP (`SITE.address.postalCode` = 50588).
- **GXG** is USPS-branded but FedEx-carried and heavily restricted — consider
  excluding it in v1 and offering FCPIS/PMI/PMEI only.
- **Weight unit** (lb vs oz) and whether dims are required for FCPIS need a
  sandbox check (FCPIS is often rated by weight alone).
- Pricing: feed USPS intl cost into the SAME retail formula the intl UPS/FedEx
  rates use, so retail is consistent (see `lib/quoteForRates`/`shippingPricing`
  as used by the intl rate routes — confirm from the flow map).
