import type { InsuranceOption } from '@/app/admin/types/shipping';

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

/**
 * Customer-facing price for declared-value coverage: the carrier's fee with the
 * store markup applied, same 1.55x as freight.
 *
 * declaredValueFee() deliberately stays at raw carrier cost — it mirrors the
 * published UPS/FedEx schedules in ups_declared_value_insurance.md and
 * fedex_declared_value_insurance.md, and must stay directly comparable to them
 * when those schedules are re-verified each January. Retail pricing layers on
 * top rather than being baked into the cost function.
 *
 * The <= $100 tier returns 0, and 0 * 1.55 = 0 — coverage that the carrier
 * includes in the base rate stays free to the customer.
 */
export function retailDeclaredValueFee(declaredValueUSD: number): number {
  return retailPrice(declaredValueFee(declaredValueUSD));
}

/** True when a FedEx rate is a Ground/Home Delivery service (declared value capped at $1,000). */
export function isFedexGround(serviceName: string): boolean {
  return /ground|home\s*delivery/i.test(serviceName);
}

/**
 * Maximum declared value allowed for a carrier/service.
 * FedEx Ground & Home Delivery cap at $1,000; FedEx Envelope (FedEx-branded
 * document packaging) caps at $100 per the FedEx Service Guide (see
 * fedex_packaging_notes.md); everything else at $50,000.
 */
export function maxDeclaredValue(
  carrier: string,
  serviceName: string,
  packaging?: string
): number {
  if (carrier === 'fedex' && packaging === 'FEDEX_ENVELOPE') return 100;
  if (carrier === 'fedex' && isFedexGround(serviceName)) return 1000;
  return 50000;
}

/**
 * Re-derive a client-supplied insurance selection on the server.
 *
 * Coverage is priced in the browser (CarrierDetailModal), so the premium that
 * arrives on a submit request must never be trusted — recompute it from the
 * declared value, and clamp that value to what the carrier will actually cover
 * for this service. The clamp matters beyond pricing: an over-cap declared value
 * forwarded to FedEx/UPS is rejected by the carrier, which costs us the label.
 *
 * `enabled && valueUSD > 0` is the same gate the label routes apply, so a toggle
 * left on with no value normalizes to "off" rather than to empty coverage.
 *
 * Returns a normalized option safe both to forward to a label route and to log.
 */
export function priceInsurance(
  raw: unknown,
  carrier: string,
  serviceName: string,
  packaging?: string
): InsuranceOption {
  const input = (raw ?? {}) as Partial<InsuranceOption>;
  const cap = maxDeclaredValue(carrier, serviceName, packaging);

  const requested = Number(input.valueUSD);
  const value = Number.isFinite(requested)
    ? Math.round(Math.min(Math.max(requested, 0), cap) * 100) / 100
    : 0;

  const enabled = input.enabled === true && value > 0;
  // Mirror the 120-char limit the modal's input enforces.
  const description =
    typeof input.description === 'string' ? input.description.trim().slice(0, 120) : '';

  return {
    enabled,
    valueUSD: enabled ? value : 0,
    premiumUSD: enabled ? retailDeclaredValueFee(value) : 0,
    description: enabled && description ? description : undefined,
  };
}
