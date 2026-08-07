# FedEx packaging types (FEDEX_ENVELOPE etc.) — verified 2026-08-07, sandbox

Why this exists: FedEx-branded packaging (envelope, pak, tube, boxes) prices
differently from customer packaging. The shop needed "FedEx Envelope" to be
selectable so envelope shipments stop being quoted at box rates.

## API field

Both Rate and Ship APIs take the same enum at
`requestedShipment.packagingType`:

```
YOUR_PACKAGING (default) | FEDEX_ENVELOPE | FEDEX_PAK | FEDEX_TUBE |
FEDEX_BOX | FEDEX_SMALL_BOX | FEDEX_MEDIUM_BOX | FEDEX_LARGE_BOX |
FEDEX_EXTRA_LARGE_BOX | FEDEX_10KG_BOX | FEDEX_25KG_BOX
```

Schema source (same JSONs as saturday_delivery_notes.md):
https://developer.fedex.com/wirc/json/api_groups/Rate/RateQuotes-Resource.json
https://developer.fedex.com/wirc/json/api_groups/Ship/Shipment-Resource.json

## Rules (envelope)

- **Omit `dimensions`** on `requestedPackageLineItems` for any FedEx-branded
  packaging — FedEx knows its own dims; sending ours can reject/mis-rate.
  Weight is still required.
- **Express services only.** Sandbox rate with FEDEX_ENVELOPE returned 8
  services (no GROUND_HOME_DELIVERY, which the same request with
  YOUR_PACKAGING did return).
- **Envelope rate applies up to 8 oz**; heavier envelopes are billed at FedEx
  Pak rates (FedEx Service Guide). Staff note shown in the form.
- **Declared value cap $100** for FedEx Envelope (Service Guide limit for
  FedEx-branded document packaging) — enforced via
  `maxDeclaredValue(carrier, serviceName, packaging)` in
  `lib/shippingPricing.ts`. Re-verify annually with the Service Guide.
- Envelope prices ARE cheaper (sandbox, Fri 2026-08-07, 50588→10001):
  PRIORITY_OVERNIGHT $118.89 (envelope) vs $145.41 (own box, 1 lb 12×9×3).
- Saturday delivery composes fine with envelope (verified: sandbox ship
  accepted PRIORITY_OVERNIGHT + SATURDAY_DELIVERY + FEDEX_ENVELOPE;
  SATURDAY_DELIVERY=$16 itemized).

## Implementation map (this repo)

- Type: `ShipmentInput.packaging?: PackagingType` in
  `app/admin/types/shipping.ts` (`'YOUR_PACKAGING' | 'FEDEX_ENVELOPE'`).
  Absent = YOUR_PACKAGING (backward compatible — saved defaults lack it).
- UI: `ShipmentForm.tsx` "Packaging" dropdown next to weight; when envelope,
  the L/W/H inputs are hidden (state retained) and a helper note shows.
- Rate: `app/api/shipping/fedex/route.ts` whitelists the value
  (never pass raw client strings to a carrier) and omits dims for envelope.
- Label: `app/api/shipping/fedex/label/route.ts` same whitelist + dim rule
  (reads `shipment.packaging` — the whole shipment object is forwarded by
  `/api/shipping/submit`, so no extra plumbing was needed).
- Staleness: `rateSignature` in `app/admin/shipping/page.tsx` includes
  packaging, so switching it drops stale rates and forces re-compare.
- Other carriers ignore `packaging` and quote as a parcel (UPS Letter code 01
  / USPS flats NOT implemented — do the same pattern if ever needed).

## Adding more FedEx types later

1. Extend the `PackagingType` union in `app/admin/types/shipping.ts`.
2. Add `<option>`s in `ShipmentForm.tsx`.
3. Extend the whitelists in `app/api/shipping/fedex/route.ts` and
   `app/api/shipping/fedex/label/route.ts` (both currently map anything
   ≠ FEDEX_ENVELOPE to YOUR_PACKAGING).
4. Keep the omit-dimensions rule for every FedEx-branded type.
5. Check declared-value caps per type in the Service Guide and update
   `maxDeclaredValue`.
