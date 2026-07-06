/** Store markup applied to carrier cost to get the customer (retail) price. */
export const SHIPPING_MARKUP = 1.55; // 55%

/** Customer-facing retail price for a given carrier cost (rounded to cents). */
export function retailPrice(costUSD: number): number {
  return Math.round(costUSD * SHIPPING_MARKUP * 100) / 100;
}

/**
 * Declared-value (carrier liability) fee. UPS and FedEx use an identical tiered
 * schedule (retail accounts), so one function serves both:
 *   - ≤ $100.00           → $0.00  (included in the base rate)
 *   - $100.01 – $300.00   → $3.90  flat
 *   - > $300.00           → $3.90 + ceil((value - 300) / 100) * $1.30
 *
 * Source: ups_declared_value_insurance.md + fedex_declared_value_insurance.md
 * (published retail schedules, verified July 2025 — carriers adjust annually,
 * typically each January, so re-verify against those docs yearly).
 */
export function declaredValueFee(declaredValueUSD: number): number {
  const value = Number(declaredValueUSD) || 0;
  if (value <= 100) return 0;
  if (value <= 300) return 3.9;
  const units = Math.ceil((value - 300) / 100);
  return Math.round((3.9 + units * 1.3) * 100) / 100;
}

/** True when a FedEx rate is a Ground/Home Delivery service (declared value capped at $1,000). */
export function isFedexGround(serviceName: string): boolean {
  return /ground|home\s*delivery/i.test(serviceName);
}

/**
 * Maximum declared value allowed for a carrier/service.
 * FedEx Ground & Home Delivery cap at $1,000; everything else at $50,000.
 */
export function maxDeclaredValue(carrier: string, serviceName: string): number {
  if (carrier === 'fedex' && isFedexGround(serviceName)) return 1000;
  return 50000;
}
