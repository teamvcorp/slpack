import { cubicIn, roundDimsForRating, hasUsableDims, type Dims } from '@/lib/parcelGeometry';

/**
 * UPS Simple Rate — flat-rate pricing by cubic-volume tier.
 *
 * Simple Rate is NOT a different service. It is a different way UPS bills US for
 * the same UPS Ground / 3 Day Select / 2nd Day Air / Next Day Air Saver:
 * identical transit, identical tracking, identical customer experience. The
 * price is flat by box volume, using our own packaging, for any US zone at up to
 * 50 lb — and it is EXEMPT from residential, delivery-area, delivery-area-
 * extended and fuel surcharges, which is where a residential ground parcel
 * normally bleeds.
 *
 * So it is a pure cost play: quote and charge carrier retail exactly as before,
 * and when Simple Rate is cheaper for this parcel, book the label that way and
 * keep the difference. See carrier_rate_pricing_notes.md.
 *
 * IT MUST BE COMPARED, NEVER ASSUMED. Simple Rate is *more* expensive than
 * standard for light, short-zone parcels — a 1 lb zone-2 Ground beats XS Simple
 * Rate routinely — so booking it blindly would lose money on the commonest
 * package the shop ships.
 */

export type SimpleRateTier = 'XS' | 'S' | 'M' | 'L' | 'XL';

/** Upper cubic-inch bound of each tier, ascending. Lower bound is the previous cap + 1. */
export const SIMPLE_RATE_TIERS: ReadonlyArray<{ tier: SimpleRateTier; maxCubicIn: number }> = [
  { tier: 'XS', maxCubicIn: 100 },
  { tier: 'S', maxCubicIn: 250 },
  { tier: 'M', maxCubicIn: 650 },
  { tier: 'L', maxCubicIn: 1050 },
  { tier: 'XL', maxCubicIn: 1728 },
];

/** Largest parcel Simple Rate accepts, in cubic inches. */
export const SIMPLE_RATE_MAX_CUBIC_IN = 1728;

/** Simple Rate is flat regardless of weight, but only up to this. */
export const SIMPLE_RATE_MAX_WEIGHT_LBS = 50;

/**
 * UPS service codes Simple Rate can be applied to.
 *
 * Deliberately excludes 01 (Next Day Air), 14 (Next Day Air Early) and 59
 * (2nd Day Air A.M.) — UPS does not offer Simple Rate on those — and every
 * international service.
 */
export const SIMPLE_RATE_SERVICES: ReadonlySet<string> = new Set([
  '03', // UPS Ground
  '02', // UPS 2nd Day Air
  '12', // UPS 3 Day Select
  '13', // UPS Next Day Air Saver
]);

/** How close to a tier's cap counts as "worth re-measuring before taping". */
export const NEAR_BOUNDARY_FRACTION = 0.05;

export interface SimpleRateEligibility {
  eligible: boolean;
  /** Null whenever `eligible` is false. */
  tier: SimpleRateTier | null;
  /** Volume actually classified on — ceil-rounded, not the raw entry. */
  cubicIn: number;
  /** Within NEAR_BOUNDARY_FRACTION of this tier's cap. */
  nearBoundary: boolean;
  /** Why it was refused, for the counter. Empty when eligible. */
  reason: string;
}

const INELIGIBLE = (reason: string, cubic = 0): SimpleRateEligibility => ({
  eligible: false,
  tier: null,
  cubicIn: cubic,
  nearBoundary: false,
  reason,
});

/**
 * Which tier a box falls in, classified on CEIL-ROUNDED dimensions.
 *
 * The rounding is the point. UPS measures the physical box at the hub, so a
 * 4.6" side becomes 5". Classifying on the raw 4.6 would put a 97 cubic-inch
 * parcel in XS when UPS will measure 125 and charge S — and a mis-declared tier
 * is re-rated and billed back weeks later, with nothing collected against it.
 * Rounding up first means we are never on the wrong side of that.
 *
 * Returns null when the box is unusable or exceeds the largest tier.
 */
export function simpleRateTier(dims: Dims): SimpleRateTier | null {
  if (!hasUsableDims(dims)) return null;
  const cubic = cubicIn(roundDimsForRating(dims, 'ceil'));
  const match = SIMPLE_RATE_TIERS.find((t) => cubic <= t.maxCubicIn);
  return match ? match.tier : null;
}

/** Cubic volume Simple Rate will be judged on — ceil-rounded, like the tier. */
export function simpleRateCubicIn(dims: Dims): number {
  return hasUsableDims(dims) ? cubicIn(roundDimsForRating(dims, 'ceil')) : 0;
}

/** True when the parcel sits within 5% of its tier's cap and should be re-measured. */
export function isNearTierBoundary(cubic: number, tier: SimpleRateTier): boolean {
  const entry = SIMPLE_RATE_TIERS.find((t) => t.tier === tier);
  if (!entry) return false;
  return cubic > entry.maxCubicIn * (1 - NEAR_BOUNDARY_FRACTION);
}

/**
 * Can this shipment ship Simple Rate, and in which tier?
 *
 * Called at rate time to decide whether to make the extra UPS call, and AGAIN in
 * the label route against the shipment itself — the tier that arrives from the
 * browser is never trusted.
 */
export function simpleRateEligibility(shipment: {
  weightLbs?: number;
  lengthIn?: number;
  widthIn?: number;
  heightIn?: number;
  destCountry?: string;
}): SimpleRateEligibility {
  const country = String(shipment?.destCountry ?? 'US').toUpperCase();
  if (country !== 'US') return INELIGIBLE('Simple Rate is US domestic only');

  const dims: Dims = {
    lengthIn: Number(shipment?.lengthIn) || 0,
    widthIn: Number(shipment?.widthIn) || 0,
    heightIn: Number(shipment?.heightIn) || 0,
  };
  if (!hasUsableDims(dims)) return INELIGIBLE('Package dimensions required');

  const weight = Number(shipment?.weightLbs);
  if (!Number.isFinite(weight) || weight <= 0) return INELIGIBLE('Package weight required');
  if (weight > SIMPLE_RATE_MAX_WEIGHT_LBS) {
    return INELIGIBLE(`Over the ${SIMPLE_RATE_MAX_WEIGHT_LBS} lb Simple Rate limit`);
  }

  const cubic = simpleRateCubicIn(dims);
  const tier = simpleRateTier(dims);
  if (!tier) {
    return INELIGIBLE(
      `Over the ${SIMPLE_RATE_MAX_CUBIC_IN} cu in Simple Rate limit (${cubic} cu in)`,
      cubic
    );
  }

  return {
    eligible: true,
    tier,
    cubicIn: cubic,
    nearBoundary: isNearTierBoundary(cubic, tier),
    reason: '',
  };
}

/** Whitelist a tier that arrived from the browser. Same discipline as normalizeSignature. */
export function normalizeSimpleRateTier(raw: unknown): SimpleRateTier | null {
  return SIMPLE_RATE_TIERS.some((t) => t.tier === raw) ? (raw as SimpleRateTier) : null;
}

/** True when Simple Rate can be applied to this UPS service code. */
export function isSimpleRateService(serviceCode: unknown): boolean {
  return SIMPLE_RATE_SERVICES.has(String(serviceCode));
}

/** The cap of a tier, for counter messaging. */
export function tierMaxCubicIn(tier: SimpleRateTier): number {
  return SIMPLE_RATE_TIERS.find((t) => t.tier === tier)?.maxCubicIn ?? SIMPLE_RATE_MAX_CUBIC_IN;
}
