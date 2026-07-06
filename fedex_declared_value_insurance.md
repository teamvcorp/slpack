# FedEx Declared Value — Insurance Billing Rules

## Overview

FedEx does not sell insurance. They offer **Declared Value** coverage, which represents the maximum
liability FedEx will accept for a shipment. This value must be declared **at time of label creation**
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
function calcFedExInsuranceFee(declaredValue: number): number {
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

| Service Type                              | Max Declared Value |
|-------------------------------------------|--------------------|
| FedEx Ground / Home Delivery              | $1,000             |
| FedEx Express (domestic)                  | $50,000            |
| FedEx International                       | $50,000 (varies by destination) |
| High-value / special handling (Express)   | Up to $50,000 with prior approval |

> **App note:** Enforce the $1,000 cap for Ground shipments in your UI — do not allow users to
> declare more than $1,000 when Ground is the selected service.

---

## Excluded / Limited Liability Items

FedEx limits or denies declared value coverage for these item categories regardless of declared amount:

- Jewelry, gems, precious metals
- Artwork, antiques, manuscripts
- Currency, coins, gift cards, negotiable instruments
- Furs and fur garments
- Live animals or plants
- Perishables (food, flowers, etc.)
- Plasma screens, glass, LCD panels
- One-of-a-kind or irreplaceable items
- Certain consumer electronics (reduced cap may apply)

> **App note:** Consider flagging these categories during checkout and displaying a disclaimer that
> declared value coverage may not apply or may be limited.

---

## Service-Specific Notes

### FedEx Ground & Home Delivery
- Declared value coverage capped at **$1,000**
- Fee structure above applies within that cap

### FedEx Express (Overnight, 2Day, etc.)
- Declared value up to **$50,000**
- Same fee structure applies

### FedEx International Priority / Economy
- Declared value available but subject to **destination country customs rules**
- Some countries restrict declared value amounts
- Currency conversion may apply for international claims

---

## Display Recommendations for UI

- Show insurance fee as a **line item** separate from shipping cost
- Label it: `"FedEx Declared Value Coverage"`
- If declared value ≤ $100, display: `"Included (up to $100)"`
- For Ground service: cap the declared value input field at **$1,000**
- Allow user to input a custom declared value; compute fee dynamically on input change
- Show a tooltip or info icon explaining this is carrier liability, not third-party insurance
- On service change (e.g., Ground → Express), re-validate declared value against new cap

---

## Data Source & Maintenance

- **Source:** FedEx published rate schedule
- **Last verified:** July 2025
- **Check for updates at:** https://www.fedex.com/en-us/shipping/declared-value.html
- **Update frequency:** FedEx adjusts rates annually (typically January); verify each year

---

## Notes

- Rates shown are for **standard retail** FedEx accounts. FedEx account holders with negotiated
  rates may see different fees — confirm via FedEx account portal or rep.
- Third-party insurance (e.g., Shipsurance, U-PIC) runs ~$0.55–$0.75 per $100 and may be cheaper
  for high declared values. Consider offering as an alternative in your app.
- FedEx and UPS use **identical fee structures** (as of July 2025), so a single shared billing
  function with a carrier parameter works cleanly if your app supports both.
