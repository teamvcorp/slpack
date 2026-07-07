# International Shipping API Notes (UPS + FedEx)

Field requirements discovered while wiring the isolated international flow
(`app/api/shipping/intl/*`). Verified against FedEx & UPS **sandbox** on
2026-07-07. Re-verify against production accounts before go-live (ETD/Paperless
enablement and account provisioning differ from sandbox).

## Architecture (isolation)

International is a **parallel** implementation — nothing domestic was forked:
- Routes: `app/api/shipping/intl/{fedex,ups}/route.ts` (rate),
  `app/api/shipping/intl/{fedex,ups}/label/route.ts` (label + invoice),
  `app/api/shipping/intl/submit/route.ts` (fan-out + documents passthrough).
- Shared customs payload builders: `lib/shippingIntl.ts`
  (`fedexCustomsClearanceDetail`, `fedexTotalCustomsValue`, `upsInternationalForms`).
- Types: `app/admin/types/shippingIntl.ts` (`CustomsInfo`, `Commodity`, `IntlShipmentInput`, `IntlDocument`).
- UI: `app/admin/shipping-intl/page.tsx` + `app/admin/components/intl/*`
  (`IntlShipmentForm`, `CustomsFormModal`, `IntlDocumentsModal`).
- Reused unchanged: OAuth (`lib/carrierTokens.ts`), `normalizePostal`, `SITE.address`,
  pricing (`retailPrice`, `declaredValueFee`), `logAndRespond`, `CarrierDetailModal`,
  `FedExPanel`/`UPSPanel`, and `StripeCheckout` (via new optional `submitPath` prop,
  default `/api/shipping/submit` — domestic behavior byte-for-byte unchanged).

## FedEx (REST)

- **Rate (`/rate/v1/rates/quotes`) REQUIRES `requestedShipment.customsClearanceDetail`**
  for international destinations — without it: `RATE.CUSTOMCLEARANCEDETAIL.INVALID`
  "Customs clearance detail cannot be null." (The domestic rate route fails on
  intl dests for exactly this reason — proof the flows must diverge.)
- **Rate `dutiesPayment.paymentType` MUST be `SENDER`** — `RECIPIENT` gives
  `RATE.PAYMENTTYPE.NOTALLOWED`. Duties aren't in the shipping charge when the
  recipient pays, so we force SENDER for the quote only (`fedexCustomsClearanceDetail(..., {forRating:true})`)
  and apply the real payer on the label.
- Because the customs step happens *after* rate selection, the rate route
  **synthesizes a minimal 1-commodity declaration** from `declaredValueUSD` when
  full commodities aren't entered yet.
- Empty `harmonizedCode` must be **omitted** (not sent as "") — else rejected.
- **Label (`/ship/v1/shipments`)**: send `customsClearanceDetail` (commodities w/
  `harmonizedCode`, `countryOfManufacture`, `quantity`+`quantityUnits:'PCS'`,
  `unitPrice`, `customsValue`, `weight`), `commercialInvoice{termsOfSale,purpose}`,
  and `totalCustomsValue`.
  - `commercialInvoice.purpose` enum: SOLD/GIFT/SAMPLE/RETURN_AND_REPAIR/REPAIR_AND_RETURN/PERSONAL_EFFECTS.
  - `termsOfSale` accepts the Incoterm code directly (DAP/DDP/DDU/CPT).
- **Printed commercial invoice**: request via `shippingDocumentSpecification.shippingDocumentTypes:['COMMERCIAL_INVOICE']`
  → returned in `output.transactionShipments[].shipmentDocuments[]` (`contentType` contains "INVOICE", base64 in `encodedLabel`).
- **ETD (electronic upload)** is opt-in via env `FEDEX_ETD_ENABLED=true`
  (`shipmentSpecialServices.specialServiceTypes:['ELECTRONIC_TRADE_DOCUMENTS']` + `etdDetail.requestedDocumentTypes:['COMMERCIAL_INVOICE']`).
  Requires an ETD-enabled account — left OFF so a non-enabled account still gets a printable invoice.
  - **How to enable ETD (account level, NOT the developer portal):** log in to fedex.com →
    Preferences / Account Administration → Customs Clearance / International Preferences →
    tick "Enable Electronic Trade Documents (ETD)", accept terms, upload letterhead
    (~700×50 px) + signature (~240×25 px) images (stamped on the generated invoice), Save.
    If the checkbox isn't shown, the account isn't provisioned — call the FedEx account
    executive or Ship Manager Tech Support 1.877.339.2774. developer.fedex.com only issues
    API credentials; it has no ETD toggle. After enablement, set `FEDEX_ETD_ENABLED=true`
    and restart. Do NOT set it before enablement — FedEx rejects the whole label request.
    Refs: fedex.com/en-us/electronic-trade-documents/enable.html
- Verified sandbox result: MX label returned LABEL (PDF) + COMMERCIAL_INVOICE (PDF).

## UPS (REST)

- **Rate (`/api/rating/v2403/Shoptimeintransit`)** for international needs:
  - **Full origin address** on Shipper + ShipFrom (`AddressLine` + `City`, not just
    postal/state/country) — otherwise `111538 Invalid Origin`.
  - **`Shipment.InvoiceLineTotal { CurrencyCode, MonetaryValue }`** (customs value of
    goods) — otherwise `111549 Invalid Shipment Contents Value`.
- **Label (`/api/shipments/v2501/ship`)** for international needs:
  - **`Shipper.AttentionName` + `Phone`** — else `Missing or invalid ship from attention name`.
  - **`ShipFrom.AttentionName` + `Phone`**.
  - **`ShipTo.AttentionName`** (default to recipient name) — else `120201 Missing or invalid ship to attention name`.
  - **`Package[].Description`** (merchandise description) — Mexico specifically:
    `121984 A package in a Mexico shipment must have a Merchandise Description`.
  - **`ShipmentServiceOptions.InternationalForms`** (FormType `['01']` = Commercial
    Invoice, `InvoiceDate` YYYYMMDD, `ReasonForExport`, `CurrencyCode`,
    `Contacts.SoldTo`, `Product[]` w/ `CommodityCode`=HS, `OriginCountryCode`,
    `Unit{Number,Value,UnitOfMeasurement:'PCS'}`). Presence triggers UPS Paperless.
  - `DeclaredValue.CurrencyCode` un-hardcoded (uses `customs.currency`).
- **Printed commercial invoice**: returned in `ShipmentResponse.ShipmentResults.Form`
  (array or object) → `Form.Image.GraphicImage` (base64) + `Form.Image.ImageFormat.Code`.
- Verified sandbox result: MX label returned LABEL (GIF) + COMMERCIAL_INVOICE (PDF).

## Guardrails / TODO before production

- **EEI/AES (ITN) filing** kicks in at **≥ $2,500 per commodity** (US Census) —
  `CustomsFormModal` blocks totals at/above the threshold (`EEI_FILING_THRESHOLD_USD`).
  Not yet automated; file separately or split shipments.
- Verify ETD/Paperless enablement on the production FedEx/UPS accounts.
- Consider shipper tax ID / EORI for certain destination customs regimes.
- DHL international label/pickup remain unbuilt (rate-only scaffolding exists).
