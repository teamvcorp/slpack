import type { InsuranceOption } from '@/app/admin/types/shipping';

/** Store markup applied to carrier cost to get the customer (retail) price. */
export const SHIPPING_MARKUP = 1.55; // 55%

/**
 * Floor on the gross margin of a single label, in dollars.
 *
 * A percentage markup scales with carrier cost, but the work does not: taking a
 * package, boxing it, printing a label and handing it over costs the same
 * whether the freight is $6 or $90. At 55%, a $9 ground label grosses $4.95 —
 * less than the counter time it consumes.
 *
 * See freightPrice() for where this binds (only below ~$9.09 of carrier cost).
 */
export const MIN_SHIPPING_MARGIN_USD = 5;

/**
 * Raw store markup on a carrier cost, rounded to cents.
 *
 * This is the PURE multiplier with no margin floor, and it must stay that way —
 * retailDeclaredValueFee() builds on it, and coverage the carrier includes free
 * (the <= $100 tier, which returns 0) has to stay free. Applying the floor here
 * would charge $5 for nothing and turn the $3.90 declared-value fee into $8.90.
 *
 * For freight, use freightPrice() instead.
 */
export function retailPrice(costUSD: number): number {
  return Math.round(costUSD * SHIPPING_MARKUP * 100) / 100;
}

/**
 * Customer-facing price for FREIGHT — the store markup with a minimum gross
 * margin floor. This is the function every carrier rate should be priced through.
 *
 *   price = max(cost x 1.55, cost + 5)
 *
 * The floor only binds below **$9.09** of carrier cost: that is where 55% of the
 * cost first reaches $5 (0.55 x 9.09 = 5.00). Above it the percentage already
 * clears the floor on its own, so express, overnight and 2-day pricing are
 * untouched — this is purely a cheap-ground / USPS correction.
 *
 * A zero or negative cost returns 0 rather than the bare floor: a carrier that
 * returned no rating must not silently become a $5 charge.
 */
export function freightPrice(costUSD: number): number {
  const cost = Number(costUSD);
  if (!Number.isFinite(cost) || cost <= 0) return 0;
  const marked = cost * SHIPPING_MARKUP;
  const floored = cost + MIN_SHIPPING_MARGIN_USD;
  return Math.round(Math.max(marked, floored) * 100) / 100;
}

/** Minimum we can charge without losing money on a shipment. */
export function priceFloorUSD(costUSD: number): number {
  const cost = Number(costUSD);
  if (!Number.isFinite(cost) || cost <= 0) return 0;
  return Math.round((cost + MIN_SHIPPING_MARGIN_USD) * 100) / 100;
}

/**
 * The price we aim to charge: **the carrier's own published retail**.
 *
 * Shop policy (set 2026-08-24): never charge more than the carrier would charge
 * this customer directly, but charge full carrier retail whenever we can.
 *
 * Why not cost x 1.55? Because the markup is a multiple of OUR COST while the
 * carriers price off their own retail, and they discount express far harder than
 * ground. On a real overnight — $74.89 cost, $187.22 UPS retail — a cost-based
 * markup asks $116.08 and leaves $71 on the table on a single parcel. Anchoring
 * to the carrier's number captures that without ever being undercut by a
 * customer who checks ups.com.
 *
 * The floor still wins: if a carrier's retail somehow sits below our cost plus
 * the minimum margin, we charge the floor rather than book a loss. That is the
 * only case where the returned price exceeds carrier retail.
 *
 * Falls back to the cost-based markup when no list price exists (USPS, DHL).
 */
export function carrierAnchoredPrice(costUSD: number, listPriceUSD?: number | null): number {
  const list = Number(listPriceUSD);
  if (!Number.isFinite(list) || list <= 0) return freightPrice(costUSD);
  return Math.round(Math.max(list, priceFloorUSD(costUSD)) * 100) / 100;
}

/**
 * Hard ceiling on what may be charged — the carrier's retail, or our floor when
 * that is higher. Null when the carrier published no list price, in which case
 * there is nothing to compare against and no ceiling is enforced.
 */
export function priceCeilingUSD(costUSD: number, listPriceUSD?: number | null): number | null {
  const list = Number(listPriceUSD);
  if (!Number.isFinite(list) || list <= 0) return null;
  return Math.round(Math.max(list, priceFloorUSD(costUSD)) * 100) / 100;
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
