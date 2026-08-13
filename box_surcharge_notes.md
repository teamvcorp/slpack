# UPS & FedEx size surcharges — box size calculator reference

Local copy of the carrier documentation behind `lib/boxOptimizer.ts` and `/admin/box-size`.
Companion to `ups_declared_value_insurance.md` / `fedex_declared_value_insurance.md`.

**Verified: 2026-08-13** against the sources listed at the bottom.
**Re-verify every January** — both carriers reprice and re-scope these in the first two weeks of the year.

---

## 1. Why this exists

UPS and FedEx price parcels on **length + girth**, not just weight. One inch over 130" flips a package
from standard to Large Package / Oversize: a ~$220–$331 flat charge **plus** a forced 90 lb minimum
billable weight. On a light bulky item that is a $400+ swing on a single box, and the shop only finds
out after the item is packed and quoted.

`/admin/box-size` moves that decision before the tape goes on.

## 2. The core formula

```
sort dimensions descending → a ≥ b ≥ c
girth        = 2 × (b + c)
length+girth = a + 2b + 2c
cubic volume = a × b × c
dim weight   = ceil(cubic / 139)        ← 139 for both carriers, US domestic
billed weight = max(actual, dim weight) ← then the 90 lb floor if Large/Oversize
```

**Always sort first.** A parcel entered as 7 × 43 × 37 is the same box as 43 × 37 × 7. Implemented once
in `lib/parcelGeometry.ts`.

**All thresholds are strictly greater-than.** L+G of exactly 130.0" is SAFE. Longest side of exactly
48.0" is SAFE. Using `>=` anywhere would penalize compliant boxes.

---

## 3. UPS — verified 2026

Rates effective **2025-12-22**; the new cubic-volume and weight criteria effective **2026-01-26**.

### Additional Handling

Triggers (any one):

| Category | Trigger |
|---|---|
| Weight | actual weight > **50 lb** (US Ground/Express); > 55 lb international |
| Dimensions | longest > **48"**, OR second-longest > **30"**, OR L+G > **105"** |
| Cubic | volume > **10,368 in³** — *new 2026-01-26* |
| Packaging | not fully encased in corrugated; metal/plastic/cloth banding; cylindrical; wheels, casters, handles or straps |

**Only ONE Additional Handling charge is assessed per package.** When several categories trigger, UPS
charges the most expensive, prioritized **weight → dimensions → packaging**.

Amounts (2025 table, **verified**; UPS published a 7–9% increase for 2026 plus a new higher Zone 7 tier —
the exact 2026 cells could not be retrieved, so treat these as a floor):

| Category | Zone 2 | Zones 3–4 | Zones 5+ | International |
|---|---|---|---|---|
| Weight | $43.50 | $47.50 | $52.75 | $34.00 |
| Dimensions | $28.00 | $31.00 | $36.00 | $34.00 |
| Packaging | $25.00 | $29.00 | $31.00 | $34.00 |

### Large Package Surcharge

Triggers (any one): length > **96"**, L+G > **130"**, cubic > **17,280 in³**, actual weight > **110 lb**.
(The cubic and weight triggers are new for 2026.)

- **Minimum billable weight 90 lb**, regardless of actual or dimensional weight.
- **Additional Handling is NOT assessed when the Large Package Surcharge applies** — it replaces it entirely.

| Zone | Commercial | Residential |
|---|---|---|
| 2 | $219.50 | $254.50 |
| 3–4 | $239.50 | $274.50 |
| 5–6 | $273.00 | $320.50 |
| 7+ | $286.00 | $331.00 |
| International | $235.00 flat | — |

### Over Maximum Limits

Triggers: weight > **150 lb**, length > **108"**, or L+G > **165"**.
Charge **$1,875** per package (up from $1,775 on 2025-12-22), or UPS refuses the shipment. Ship LTL freight.

---

## 4. FedEx — verified 2026

Pricing effective **2026-01-05**; the new cubic-volume and weight triggers effective **2026-01-12**.

### Additional Handling Surcharge (AHS)

Triggers (any one): longest > **48"**, second-longest > **30"**, L+G > **105"**, cubic > **10,368 in³**
(*new 2026*), actual weight > **50 lb** domestic (> 55 lb international), or nonstandard packaging.

**If several AHS criteria trigger, FedEx applies only the highest.** Unlike UPS, FedEx charges the same
amount for every AHS category — only the zone varies:

| Zone | Amount |
|---|---|
| 2 | $29.50 |
| 3–4 | $32.75 |
| 5–6 | $38.50 |
| 7+ | $40.75 |
| International | $29.50 |

### Oversize Charge

Triggers (any one): length > **96"**, L+G > **130"**, cubic > **17,280 in³**, actual weight > **110 lb**.

- **Minimum billable weight 90 lb** domestic.
- **Oversize suppresses only the DIMENSION-based AHS.** A weight-based AHS still applies *alongside*
  Oversize. This is a genuine difference from UPS, which waives Additional Handling completely.

| Zone | Amount |
|---|---|
| 2 | $255.00 |
| 3–4 | $275.00 |
| 5–6 | $320.00 |
| 7+ | $330.00 |
| International | $208.00 flat |

### Ground Unauthorized Package

Triggers: length > **108"**, L+G > **165"**, or actual weight > **150 lb**.
Charge **$1,875** per package, or refusal/return. Applies to Ground, Home Delivery, International Ground.

### Demand (peak) surcharges

Applied roughly **late September through mid-January** (2025–26 season ran Sept 29 – Jan 18). These
**stack on top of** the standard charges above:

| Charge | Demand add-on |
|---|---|
| Additional Handling | $8.25 – $10.90 |
| Oversize | $90.00 – $108.50 |
| Ground Unauthorized | $490.00 – $545.00 |

Amounts are re-announced annually and move weekly within the season — the calculator warns that the
window is active rather than quoting a number.

---

## 5. Corrections to `carrier_surcharge_spec.pdf` (Edynsgate / The VA Corp, Aug 2026)

The internal spec describes the **2025** rules. Several are now wrong. Deltas, worst first:

| # | Spec says | Verified 2026 reality | Impact |
|---|---|---|---|
| 1 | No cubic-volume trigger anywhere | **AH at > 10,368 in³, Large/Oversize at > 17,280 in³** (both carriers) | A 26×26×26 box is L+G 130" — "safe" per the spec — but 17,576 in³ makes it a **Large Package**: ~$286 + 90 lb billing. The spec cannot see this case at all. |
| 2 | Additional Handling triggers on longest > 48" only | Also **second-longest > 30"**, **L+G > 105"**, cubic, and weight | A 40×32×20 box reports STANDARD under the spec; really it takes AH. |
| 3 | FedEx AH weight threshold 70 lb | **50 lb** domestic (55 lb international) — same as UPS | Every 50–70 lb FedEx package is under-quoted by ~$30. |
| 4 | Standard parcel allows longest ≤ 108" on FedEx; 96" rule listed for UPS only | **Both carriers** trigger Large/Oversize at longest > 96" | Spec's §3 table has FedEx's column wrong. UPS's 96" entry was correct. |
| 5 | No weight trigger for Large Package | **Actual weight > 110 lb** triggers Large/Oversize on both | A 120 lb compact box is Large Package in 2026. |
| 6 | LPS ~$285 UPS / ~$295 FedEx, flat | **Zone- and residential-dependent**: UPS $219.50–$331.00, FedEx $255–$330 | A single flat constant is wrong by up to ~$110 in either direction. |
| 7 | AH ~$28.50 UPS / ~$31.45 FedEx, flat | UPS $25.00–$52.75 **by category and zone**; FedEx $29.50–$40.75 by zone | UPS AH-weight is nearly double AH-dimensions. |
| 8 | Over Max "refused or freight", no amount | **$1,875** per package, both carriers | Worth quoting — it is the most expensive mistake available. |
| 9 | §11 example: 37×7×42 is STANDARD, DIM weight 16 lb | Cubic is 10,878 in³ → **Additional Handling**; DIM weight is **79 lb** (10,878 ÷ 139) | The spec's headline "safe" example is neither safe nor 16 lb. See fixture 1. |

### Rulings on the spec's three internal contradictions

- **(a) 96" rule — spec was right about UPS, wrong about FedEx.** §3's table attributes 96" to UPS only.
  Verified: *both* carriers trigger at longest > 96". Implemented per-carrier anyway, since the carriers
  genuinely differ elsewhere (AH suppression, AH pricing model).
- **(b) Classification is exclusive, not stacking.** §3's prose says categories "stack"; §7's pseudocode
  uses `if/elif`. The pseudocode is right. UPS: "The Additional Handling Surcharge will not be assessed…
  when a Large Package Surcharge is already applicable." FedEx: "If a package triggers the Oversize
  Charge, FedEx will not consider the dimension-based AHS." Note the FedEx wording — *dimension-based*
  only, so FedEx weight-AHS survives Oversize. Modeled as `ahWeightSurvivesLarge` per carrier.
- **(c) Only one Additional Handling per package.** Confirmed at both carriers. UPS picks the most
  expensive by weight → dimensions → packaging; FedEx applies "only the highest" (its categories are
  priced identically, so the choice only matters for the reason string).

## 6. Why the estimate is a range, not a price

1. **Zone-dependent.** The tables above vary by zone, and zone depends on the destination. The calculator
   shows the applicable range and narrows it with the residential toggle (UPS) rather than inventing a zone.
2. **Base rate is not computable offline.** It needs zone × billed weight × service, which only the
   carriers have. The panel is labeled *"estimated surcharges — base rate not included."*
3. **Negotiated rates.** The shop rates on an account (`/api/shipping/ups` requests
   `NegotiatedRatesIndicator`, FedEx prefers the ACCOUNT rated detail), so real accessorials may be
   discounted off these published figures.
4. **Fuel applies to accessorials.** Both carriers apply the weekly fuel surcharge percentage on top of
   these charges, so published amounts are a floor, not a ceiling.

**The live-rate button is the source of truth for dollars.** The static estimate exists to show the
*cliff* — which box choice avoids a penalty — not to quote a customer.

---

## 7. Boundary fixture table

Hand-verification set (this repo has no test runner; same convention as `shippingPricing.ts`).
Classification only — no zone, so no dollar column. Actual weight 15 lb unless stated.

| # | Dimensions (in) | Actual lb | L+G | Cubic in³ | Expected class | Billed lb | Why |
|---|---|---|---|---|---|---|---|
| 1 | 42 × 37 × 7 | 15 | 130.0 | 10,878 | ADDITIONAL_HANDLING | 79 | Spec's "safe" box: L+G exactly at limit, but cubic > 10,368 **and** 2nd side 37 > 30 |
| 2 | 43 × 37 × 7 | 15 | 131.0 | 11,137 | LARGE_PACKAGE | 90 | The 1" cliff; 90 lb floor beats dim 81 |
| 3 | 26 × 26 × 26 | 15 | 130.0 | 17,576 | LARGE_PACKAGE | 127 | **Cubic-only trigger** — invisible to the spec. L+G exactly 130 is safe; cubic is not. Dim 127 beats the 90 floor |
| 4 | 26 × 26 × 25 | 15 | 128.0 | 16,900 | ADDITIONAL_HANDLING | 122 | Cubic under 17,280 but over 10,368; L+G 128 > 105 also fires |
| 5 | 24 × 24 × 20 | 15 | 112.0 | 11,520 | ADDITIONAL_HANDLING | 83 | No side over 48" and 2nd side 24 ≤ 30, but cubic > 10,368 **and** L+G 112 > 105 |
| 6 | 20 × 16 × 12 | 15 | 76.0 | 3,840 | STANDARD | 28 | Clean baseline |
| 7 | 20 × 16 × 12 | 55 | 76.0 | 3,840 | STANDARD + AH-weight | 55 | Weight > 50 on **both** carriers (spec says FedEx 70) |
| 8 | 30 × 20 × 20 | 120 | 110.0 | 12,000 | LARGE_PACKAGE | 120 | **Weight > 110 trigger**; actual beats the 90 floor |
| 9 | 48 × 20 × 20 | 15 | 128.0 | 19,200 | LARGE_PACKAGE | 139 | Longest exactly 48 (safe from AH-size), but cubic > 17,280. Dim 139 beats the 90 floor |
| 10 | 49 × 12 × 12 | 15 | 97.0 | 7,056 | ADDITIONAL_HANDLING | 51 | Longest 49 > 48; cubic and L+G both clear |
| 11 | 96 × 8 × 8 | 15 | 128.0 | 6,144 | ADDITIONAL_HANDLING | 45 | Longest exactly 96 — **safe** from Large Package |
| 12 | 97 × 8 × 8 | 15 | 129.0 | 6,208 | LARGE_PACKAGE | 90 | Longest 97 > 96 |
| 13 | 108 × 8 × 8 | 15 | 140.0 | 6,912 | LARGE_PACKAGE | 90 | Longest exactly 108 — **safe** from Over Max |
| 14 | 109 × 8 × 8 | 15 | 141.0 | 6,976 | OVER_MAX | — | Longest 109 > 108 → $1,875 / refused |
| 15 | 45 × 30 × 30 | 15 | 165.0 | 40,500 | LARGE_PACKAGE | 292 | L+G exactly 165 — **safe** from Over Max. Dim 292 dwarfs the 90 floor |
| 16 | 45 × 30 × 31 | 15 | 167.0 | 41,850 | OVER_MAX | — | L+G 167 > 165 |
| 17 | 20 × 16 × 12 | 150 | 76.0 | 3,840 | LARGE_PACKAGE | 150 | Weight exactly 150 is **safe** from Over Max (needs > 150) but > 110 makes it Large Package |
| 18 | 20 × 16 × 12 | 151 | 76.0 | 3,840 | OVER_MAX | — | Weight 151 > 150 |

Padding arithmetic to spot-check alongside:

- Uniform padding of `t` per side adds `10 × t` to L+G (2t on the longest axis, 4t on each of the others).
- Padding on the longest axis costs 2" of L+G per inch; on either short axis it costs **4"** — double.
- Max uniform thickness that keeps L+G ≤ 130 is `(130 − bareL+G) / 10`.

---

## 8. Source links

- UPS Large Package Surcharge, 2026 thresholds, zone tables, 90 lb floor, AH-waiver language, Over Max
  $1,875 — <https://redstagfulfillment.com/ups-large-package-surcharge/>
- UPS Additional Handling categories, zone table, "one charge per package, weight → size → packaging" —
  <https://redstagfulfillment.com/ups-additional-handling-surcharge/>
- UPS official guidance on avoiding charge corrections —
  <https://www.ups.com/us/en/support/shipping-support/shipping-dimensions-weight/avoid-additional-shipping-fees>
- UPS 2026 Additional Services and Charges (official PDF; large, slow to fetch — the authority if these
  numbers are ever disputed) —
  <https://assets.ups.com/adobe/assets/urn:aaid:aem:f1f1da89-e754-4a33-a91c-5846ab77f1b3/original/as/additional-service-charge-il-iw.pdf>
- FedEx Oversize + AHS 2026 thresholds, zone tables, demand surcharges, "Oversize does not consider the
  dimension-based AHS" — <https://redstagfulfillment.com/fedex-oversized-fees/>
- FedEx official 2026 surcharge and fee changes (official PDF; returned a system error on 2026-08-13,
  retry when verifying) —
  <https://www.fedex.com/content/dam/fedex/us-united-states/services/surcharge_and_fee_changes_2026.pdf>
- Internal spec: `carrier_surcharge_spec.pdf`, Edynsgate / The VA Corp, August 2026 (describes 2025 rules;
  see §5 for corrections).

**Caveat on sourcing:** the two official carrier PDFs were unreachable on 2026-08-13 (FedEx returned a
system-down page, UPS timed out). The threshold rules and zone tables above come from a specialist
secondary source and were cross-checked against a second independent source and against the internal
spec's 2025 figures, which fall inside the verified 2026 ranges. Re-pull both official PDFs at the next
annual verification and reconcile.

---

## 9. Shop packing charge (business pricing, not a carrier tariff)

Unlike everything above, these do **not** expire with the January carrier updates.

**Staff-editable at `/admin/settings` → Packing pricing.** Saved to `slpack.settings` (`_id:
'packingPricing'`) via `/api/admin/settings/packing-pricing` (GET/PUT/DELETE, DELETE resets). Every
terminal reads the same values. The figures below are the shipped defaults
(`DEFAULT_PACKING_RATES` in `lib/boxOptimizer.ts`), used until something is saved.

Values are re-validated on read as well as write (`normalizePackingRates`) — rates must be $0–$1 per
sq in and the multiplier 1–20, so a doc edited straight in the database cannot produce a nonsense
counter quote. Missing or null fields fall back to defaults rather than coercing to zero.

Billed on the **outside surface area of the finished box**: `2 × (LW + LH + WH)`. One area drives both
charges, which keeps it explainable — "your box is N square inches, we charge X a square inch."

| Component | Default rate per sq in |
|---|---|
| Light packing (bubble wrap only) | 2¢ |
| Standard packing (bubble + foam) | 3¢ |
| Fragile packing (foam board + bubble) | 4¢ |
| Box construction — **always applied** | +2¢ |
| Retail multiplier | **1.2×** |

```
cost   = surface area × (material rate + box rate)
retail = cost × retailMultiplier
```

Both figures show in the UI: staff need cost for margin, retail is the only number a customer hears.

Worked example at the defaults — a 12 × 9 × 6 box is 468 sq in:

| Level | Rate | Cost | Customer |
|---|---|---|---|
| Light | 4¢ | $18.72 | $22.46 |
| Standard | 5¢ | $23.40 | $28.08 |
| Fragile | 6¢ | $28.08 | $33.70 |

**Note the compounding.** Surface area grows roughly with the square of padding, so thickness moves this
charge fast — far more than the multiplier does. A 10 × 7 × 4 item at the fragile 2.5"/side build becomes
a 15 × 12 × 9 box (846 sq in, **$60.91**) against $26.35 for the same item at 0.5"/side. The Settings
card previews a 12 × 9 × 6 box live as rates are typed, so the effect of a change is visible before saving.

## 10. ZIP → city/state lookup (`/api/shipping/zip-lookup`)

UPS returns **111539 / 111542 "Invalid Destination"** for ZIPs it cannot resolve from the postal code
alone (78133 Canyon Lake TX is the known production case; see `app/api/shipping/ups/route.ts`). Supplying
City + StateProvinceCode fixes it, so the calculator auto-fills both from the ZIP.

Backed by **`data/zipCityState.json`** — 40,979 US ZIPs from the GeoNames US postal-code export
(CC BY 4.0), generated 2026-08-13. Offline by design:

- **USPS Addresses API is not available to this account.** It returns 403 — USPS introduced "Addresses API
  Access Controls" on **2026-08-01** and the shop has no Addresses licence. **Action:** add one at the
  Business Portal (<https://cop.usps.com> → My Account → API Licences → Add an Addresses API License).
  The route already calls USPS as a fallback for ZIPs missing from the local table, so it starts working
  the moment the licence exists — no code change needed.
- **FedEx address resolve is unusable in sandbox.** `fedex/validate` short-circuits because the FedEx
  sandbox returns a hardcoded dummy address for every request.
- An offline table also removes per-quote latency and any dependency on a carrier being reachable while a
  customer waits at the counter.

Refresh the dataset yearly from <https://download.geonames.org/export/zip/US.zip> (columns: country,
postal, place, state name, **state code**, …; keep the first row per ZIP).

**Sandbox note:** UPS CIE (`wwwcie.ups.com`, `UPS_SANDBOX=true`) has incomplete address data and returns
111539 intermittently for ZIPs that rate fine moments later. CIE rates are also not representative — a
15 lb 34×40×7 parcel quoted $700–$917 there. Verify pricing against production before trusting figures.
