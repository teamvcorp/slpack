# UPS Declared Value — Insurance Billing Rules

## Overview

UPS does not sell insurance. They offer **Declared Value** coverage, which represents the maximum
liability UPS will accept for a shipment. This value must be declared **at time of label creation**
and cannot be added retroactively.

---

## Billing Logic

### Tier 1 — No Charge
- **Declared value:** $0.01 – $100.00
- **Fee:** $0.00 (included in base shipping rate)

### Tier 2 — Flat Fee
- **Declared value:** $100.01 – $300.00
- **Fee:** $3.90 flat

### Tier 3 — Per-$100 Rate
- **Declared value:** $300.01 and above
- **Fee:** $1.30 per $100 (or fraction thereof)
- **Formula:** `ceil((declared_value - 300) / 100) * 1.30 + 3.90`

---

## Implementation Reference

```
function calcUPSInsuranceFee(declaredValue: number): number {
  if (declaredValue <= 100) {
    return 0.00;
  } else if (declaredValue <= 300) {
    return 3.90;
  } else {
    const overage = declaredValue - 300;
    const units = Math.ceil(overage / 100);
    return 3.90 + (units * 1.30);
  }
}
```

### Example Calculations

| Declared Value | Fee Calculation                        | Total Fee |
|----------------|----------------------------------------|-----------|
| $50.00         | Free tier                              | $0.00     |
| $100.00        | Free tier                              | $0.00     |
| $100.01        | Flat fee                               | $3.90     |
| $200.00        | Flat fee                               | $3.90     |
| $300.00        | Flat fee                               | $3.90     |
| $300.01        | $3.90 + ceil(0.01/100) × $1.30        | $5.20     |
| $400.00        | $3.90 + ceil(100/100) × $1.30         | $5.20     |
| $500.00        | $3.90 + ceil(200/100) × $1.30         | $6.50     |
| $1,000.00      | $3.90 + ceil(700/100) × $1.30         | $13.00    |
| $2,500.00      | $3.90 + ceil(2200/100) × $1.30        | $32.50    |
| $5,000.00      | $3.90 + ceil(4700/100) × $1.30        | $65.00    |

---

## Maximum Declared Value

- **Standard packages:** $50,000
- **UPS Store drop-off:** May vary; confirm at point of sale

---

## Excluded / Limited Liability Items

UPS limits or denies declared value coverage for these item categories regardless of declared amount:

- Jewelry, gems, precious metals
- Artwork, antiques, collectibles
- Currency, coins, stamps
- Furs and fur garments
- Live animals
- Perishables
- Glass, porcelain, ceramics (fragile items)
- Certain electronics (may have reduced liability caps)

> **App note:** Consider flagging these categories during checkout and displaying a disclaimer that
> declared value coverage may not apply.

---

## Display Recommendations for UI

- Show insurance fee as a **line item** separate from shipping cost
- Label it: `"UPS Declared Value Coverage"`
- If declared value ≤ $100, display: `"Included (up to $100)"`
- Allow user to input a custom declared value; compute fee dynamically on input change
- Show a tooltip or info icon explaining this is carrier liability, not third-party insurance

---

## Data Source & Maintenance

- **Source:** UPS published rate schedule
- **Last verified:** July 2025
- **Check for updates at:** https://www.ups.com/us/en/support/shipping-support/shipping-costs-rates/declared-value.page
- **Update frequency:** UPS adjusts rates annually (typically January); verify each year

---

## Notes

- Rates shown are for **retail** UPS accounts. Negotiated/volume accounts may have different fees.
- Third-party insurance (e.g., Shipsurance, U-PIC) runs ~$0.55–$0.75 per $100 and may be cheaper
  for high declared values. Consider offering as an alternative in your app.
