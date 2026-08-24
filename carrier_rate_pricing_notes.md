# UPS & FedEx rate pricing — account rates, list rates, and how we price from them

Local copy of the carrier documentation behind `app/api/shipping/{ups,fedex}/route.ts`,
`lib/carrierIncentive.ts` and `lib/shippingPricing.ts`. Companion to `box_surcharge_notes.md`.

**Verified: 2026-08-24.**
**Re-verify every January** with the other carrier docs — both carriers reprice and reshape their
APIs in the first weeks of the year.

---

## 1. Why this exists — the $187.22 overnight

A real counter quote: **our UPS cost $74.89**, **UPS's own suggested retail for air $187.22**. That
is a 2.50x spread — but it is *UPS's* markup over what we pay, i.e. a ~60% express discount on our
account. It is a good contract, not a defect.

The problem it exposed: our markup is a multiple of **our cost** (`cost x 1.55`), while carriers
price off **their own retail**, and they discount express far harder than ground. So the two
diverge most exactly where the dollars are biggest:

| | Our cost | Cost x 1.55 | UPS retail | Left on the table |
|---|---|---|---|---|
| That overnight | $74.89 | $116.08 | **$187.22** | **$71.14** |

**Shop policy (2026-08-24): charge full carrier retail where we know it, and never more than it.**
Anchoring to the carrier's own number captures that spread while remaining impossible to undercut
by a customer who checks ups.com.

> **A correction worth recording.** An earlier reading of these two figures assumed $187.22 was
> *our* price and derived a $120.79 "published rate we quoted from", concluding the rate routes were
> silently falling back to list. **That was wrong** — $187.22 is UPS's retail, and $120.79 was an
> artifact of dividing it by 1.55. The rate routes are behaving correctly. The `rateSource` flag
> stays because a genuine list-only reply is still possible, but it was not what happened here.

## 2. The two price books

| | What it is | Who sees it |
|---|---|---|
| **Account / negotiated** | What the carrier actually bills us under contract | Us |
| **List / published** | What the carrier charges a customer walking into their own counter | The customer, on ups.com / fedex.com |

The spread between them is our gross margin before markup, and it is **widest on express** — which
is exactly why express was where the problem surfaced.

Two properties make list price worth keeping rather than discarding:

1. **It bounds our cost.** We can never pay more than list, so list is a hard ceiling on what a
   shipment costs us — the fallback cost basis when no account rate comes back.
2. **It is the competitive reference.** A customer can price-check it in seconds.

---

## 3. UPS Rating API

Request (`app/api/shipping/ups/route.ts`) — both are required for account rates:

```jsonc
"Shipper": { "ShipperNumber": "<UPS_ACCOUNT_NUMBER>" },
"ShipmentRatingOptions": { "NegotiatedRatesIndicator": "Y" }
```

Response, per `RateResponse.RatedShipment[]`:

| Field | Meaning |
|---|---|
| `TotalCharges.MonetaryValue` | **Published / list** price |
| `NegotiatedRateCharges.TotalCharge.MonetaryValue` | **Account** price (our cost) |

`lib/carrierCost.ts` reads the same pair off the *ship* response as
`ShipmentCharges.TotalCharges` / `NegotiatedRateCharges.TotalCharge`.

> ⚠️ **UNCONFIRMED FROM OFFICIAL DOCS (2026-08-24).** UPS's published `Rating.yaml` on GitHub is
> truncated and does not state whether `TotalCharges` and `NegotiatedRateCharges` both appear in the
> same `RatedShipment`, or whether the account container replaces the published one. Secondary
> sources describe `TotalChargesWithTaxes` as returned "when Negotiated Rates are not applicable",
> which is about a *third* container and does not settle it.
>
> **Settle it empirically:** the `rateSource` flag on every quote records which containers came back.
> Run one real UPS quote and check whether `listPriceUSD` is populated alongside a `negotiated`
> `rateSource`. If UPS returns only one container, `listPriceUSD` is simply absent on UPS and the
> incentive path in §5 carries the cost basis instead — which is what it is there for.
> **Record the result here when checked.**

## 4. FedEx Rate API

Request (`app/api/shipping/fedex/route.ts`):

```jsonc
"accountNumber": { "value": "<FEDEX_ACCOUNT_NUMBER>" },
"rateRequestType": ["ACCOUNT", "LIST"]
```

`rateRequestType` accepts `LIST`, `ACCOUNT`, `INCENTIVE`, `PREFERRED`. **`LIST` returns published
list rates *in addition to* account-specific rates** — confirmed against the FedEx developer
documentation, so asking for both is additive and does not change the ACCOUNT figure.

Response, per `rateReplyDetails[].ratedShipmentDetails[]`, keyed by `rateType`:

| `rateType` | Meaning |
|---|---|
| `ACCOUNT` / `PAYOR_ACCOUNT_PACKAGE` | Our negotiated cost |
| `LIST` | FedEx published retail |

Read `totalNetFedExCharge`, falling back to `totalNetCharge`.

**Do not** add `LIST` to `app/api/shipping/intl/fedex/estimate-duties/route.ts` — that call uses
`rateRequestType` for a duty estimate, not for pricing.

---

## 5. How we price (`lib/shippingPricing.ts`, `lib/carrierIncentive.ts`)

```
costBasis = account rate                    (when the carrier returned one)
          | list x (1 - incentive)          (when it did not)
          | the quoted rate                 (USPS/DHL - no list rate published)

price     = max(listPrice, costBasis + 5)   // carrierAnchoredPrice() - full carrier retail
          | max(costBasis x 1.55, costBasis + 5)   // freightPrice() - no list price available
```

- **`carrierAnchoredPrice(cost, list)` is the price every rate is quoted through.** Full carrier
  retail when we know it; the cost-based markup only for USPS/DHL, which publish no list rate.
- **`priceCeilingUSD(cost, list)`** - never charge above carrier retail. Null when no list price
  exists, so nothing is capped for USPS/DHL.
- **`priceFloorUSD(cost)`** = `cost + MIN_SHIPPING_MARGIN_USD` ($5). The floor outranks the ceiling:
  if a carrier's retail sits below our cost plus minimum margin we charge the floor and flag it.
  That is the only case where our price legitimately exceeds carrier retail.
- `SHIPPING_MARKUP = 1.55` and `freightPrice()` remain for the no-list-price path and as the
  "Cost+" discount option at the counter.
- `retailPrice()` is the **pure** multiplier with no floor and must stay that way -
  `retailDeclaredValueFee()` builds on it, and the free <=$100 insurance tier returns 0.
- **Incentives** are per carrier x service class, staff-editable at `/admin/settings`, stored in
  `slpack.settings` (`_id: 'carrierIncentives'`), clamped 0-0.90 on read *and* write. Default is
  **zero** - assuming no discount over-prices rather than under-prices, the safe direction. They
  matter only when a carrier returns no account rate. The measured spread per service is in
  **Reports -> Margin**.

### Guard rails at the counter (`CarrierDetailModal`)

- **Below `costBasis + $5`: hard block.** Add-to-Cart disables. A mistyped $5 on a $90 overnight has
  to be impossible, not merely discouraged.
- **Above carrier retail: hard block.** The customer could pay less going direct, so retail is the
  ceiling. The counter offers two one-click prices: **Retail** (the default) and **Cost+** (a
  deliberate discount toward the cost-based markup).
- Overrides are recorded as `priceOverridden` on the shipment log so the Margin tab can separate a
  judgement call from a mispriced quote.
- `app/api/shipping/submit/route.ts` re-checks freight against the carrier's **actual** billed cost
  after the label returns and writes any shortfall to the error log. It cannot reject — payment is
  already captured, and rejecting would leave a charged customer with no label.

---

## 6. Sources

- FedEx Rates and Transit Times API — <https://developer.fedex.com/api/en-us/catalog/rate/docs.html>
  (`rateRequestType` values; "If you choose LIST as the element value, you receive both account
  specific and list rates")
- UPS Rating API reference — <https://developer.ups.com/tag/Rating?loc=en_US>
- UPS `Rating.yaml` (truncated; the authority if these shapes are ever disputed) —
  <https://github.com/UPS-API/api-documentation/blob/main/Rating.yaml>
- UPS Rating business rules — <https://developer.ups.com/api/reference/rating/business-rules>
  (returned a connection error on 2026-08-24; retry when verifying)
