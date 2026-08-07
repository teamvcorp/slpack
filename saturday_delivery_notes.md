# Saturday Delivery — FedEx + UPS (verified 2026-08-07, sandbox)

Why this exists: staff quoted FedEx Priority Overnight on a Friday, customer
expected Saturday, label printed Monday. Neither the rate request nor the ship
request ever asked for Saturday delivery — carriers treat Saturday as a paid
special service, so "Priority Overnight" from a Friday commits **Monday** by
default. This doc records the API facts so we never re-research them.

## FedEx (REST, apis.fedex.com)

Official schema JSONs behind developer.fedex.com (the doc pages are JS-rendered;
these are their data sources — authoritative):
- Rate:  https://developer.fedex.com/wirc/json/api_groups/Rate/RateQuotes-Resource.json
  (docs page: https://developer.fedex.com/api/en-us/catalog/rate/v1/docs.html)
- Ship:  https://developer.fedex.com/wirc/json/api_groups/Ship/Shipment-Resource.json
  (docs page: https://developer.fedex.com/api/en-us/catalog/ship/v1/docs.html)
- Guide: https://developer.fedex.com/wirc/json/api_groups/API_Reference_Guide.json
  (docs page: https://developer.fedex.com/api/en-us/guides/api-reference.html)

### Rating — ask for Saturday variants

```jsonc
"rateRequestControlParameters": {
  "returnTransitTimes": true,
  "variableOptions": "SATURDAY_DELIVERY"   // STRING, not array
}
```

Schema: `variableOptions` enum = `SATURDAY_DELIVERY | FREIGHT_GUARANTEE |
SMART_POST_ALLOWED_INDICIA | SMARTPOST_HUB_ID`.

- FedEx replies with **duplicate serviceType entries** — one standard, one
  Saturday. The Saturday row has `commit.saturdayDelivery: true` and
  `commit.dateDetail.dayOfWeek: "SAT"`.
- The Saturday **surcharge is already inside** `totalNetFedExCharge`
  (itemized as `surchargeType: "SATURDAY_DELIVERY"`). Never add it again.
- Do **NOT** request Saturday via `shipmentSpecialServices` on the RATE call —
  that suppresses the standard variants (returns only Saturday options).

Sandbox result (Fri 2026-08-07, 50588→10001 residential, 1 lb):

| service            | saturdayDelivery | commit     | net     |
|--------------------|------------------|------------|---------|
| FIRST_OVERNIGHT    | true             | Sat 08-08  | $194.76 |
| PRIORITY_OVERNIGHT | true             | Sat 08-08  | $162.21 |
| STANDARD_OVERNIGHT | true             | Sat 08-08  | $144.45 |
| FIRST_OVERNIGHT    | false            | Mon 08-10  | $177.96 |
| PRIORITY_OVERNIGHT | false            | Mon 08-10  | $145.41 |
| …                  |                  |            |         |

⚠ The Service Guide names First Overnight / Priority Overnight / 2Day, but the
API also returned a Saturday variant for **STANDARD_OVERNIGHT** — our label
route whitelist therefore includes FIRST_OVERNIGHT, PRIORITY_OVERNIGHT,
STANDARD_OVERNIGHT, FEDEX_2_DAY, FEDEX_2_DAY_AM.

### Shipping — book Saturday on the label

```jsonc
"requestedShipment": {
  "shipmentSpecialServices": { "specialServiceTypes": ["SATURDAY_DELIVERY"] }
}
```

- No sub-detail object needed (unlike COD/HOLD_AT_LOCATION).
- `shipDatestamp` must be the real (store-local!) ship date — FedEx derives the
  Saturday commitment from it. See `lib/localDate.ts` (UTC-date bug fixed
  2026-08-07: after 7 pm CT the old code stamped tomorrow's date).
- FedEx prints a large **SAT** box on the label.
- Verified sandbox 2026-08-07: ship accepted for PRIORITY_OVERNIGHT with
  envelope AND own box; surcharges itemized `SATURDAY_DELIVERY=$16`.
- API Reference: "For U.S. package shipments, Saturday delivery is available
  with FedEx First Overnight, FedEx Priority Overnight and FedEx 2Day for an
  additional charge. If FedEx does not deliver or attempt delivery on Saturday
  because the shipper or recipient requested a later delivery … a Saturday
  delivery fee will still be charged."

## UPS (REST, onlinetools.ups.com / wwwcie.ups.com)

### Rating — Saturday variants come for free

`Shoptimeintransit` **natively returns Saturday-delivery variants as duplicate
service rows** (verified sandbox 2026-08-07) — no second call, no indicator
needed when rating. The Saturday row carries:

```jsonc
"TimeInTransit": { "ServiceSummary": {
  "EstimatedArrival": { "Arrival": { "Date": "20260808" }, "DayOfWeek": "SAT" },
  "SaturdayDelivery": "1",           // ← the explicit marker ("0" on standard rows)
  "SaturdayDeliveryDisclaimer": "Saturday Delivery is available for an additional charge."
}},
"ServiceOptionsCharges": { "MonetaryValue": "16.00" }  // surcharge, already inside TotalCharge
```

Sandbox: codes 14 + 01 each returned twice — Sat-arrival rows ($222.01/$183.69)
and Mon-arrival rows ($217.41/$179.10); $16.00 Saturday surcharge included.

Note: setting `ShipmentServiceOptions.SaturdayDeliveryIndicator` on the **rate**
request makes UPS return ONLY the Saturday-optioned rows — we don't use it for
rating (we'd lose the standard options).

Our route tags a row Saturday when `ServiceSummary.SaturdayDelivery === '1'`
**and** the arrival date actually falls on a Saturday (`isSaturdayDate` in
`lib/transit.ts` — belt and braces).

### Shipping — book Saturday on the label

```jsonc
"Shipment": { "ShipmentServiceOptions": { "SaturdayDeliveryIndicator": "" } }
```

- UPS indicator convention: element **presence** = true (empty string value).
- Shipment-level — distinct from package-level `PackageServiceOptions`
  (declared value lives there).
- Saturday delivery exists only for the air services: codes 01 (Next Day Air),
  13 (NDA Saver), 14 (NDA Early), 02 (2nd Day Air), 59 (2nd Day Air AM) —
  our label-route whitelist.
- Verified sandbox 2026-08-07: ship accepted, total $189.88 (CIE returns
  placeholder tracking `1ZXXXXXXXXXXXXXXXX`).

## Implementation map (this repo)

- Rate: `app/api/shipping/fedex/route.ts` (variableOptions + parse
  `commit.saturdayDelivery`), `app/api/shipping/ups/route.ts` (parse
  `ServiceSummary.SaturdayDelivery`). Both append the "— Saturday Delivery"
  serviceName suffix **once, server-side** — never re-append downstream.
- Flag ride-along: `ShippingRate.saturdayDelivery` → CartItem.rate →
  `StripeCheckout`/`CombinedCheckout` POST → `/api/shipping/submit`
  (forwards + logs it) → carrier label route.
- Label: `app/api/shipping/fedex/label/route.ts`,
  `app/api/shipping/ups/label/route.ts` — strict `=== true` coerce +
  eligible-service whitelists, then the special-service block.
- UI: `FedExPanel`/`UPSPanel` show a SATURDAY badge (name suffix stripped for
  display only) + composite React keys (Saturday rows duplicate serviceCode);
  delivery line leads with the committed DATE — a bare "1 business day" was
  how staff misread Friday quotes as Saturday.
- Ship-date: ALL carrier date stamps go through `localDateStamp()`
  (`lib/localDate.ts`, America/Chicago) — never `toISOString()`.

## Re-verify annually
Surcharge amounts and eligible-service lists change with the carriers' January
general rate increases. Re-verify by hitting the sandboxes with the rate
payloads shown above (any Friday ship date) or re-pull the schema JSONs.
