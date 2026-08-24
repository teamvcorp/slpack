import { SERVICE_CLASS_ORDER, type ServiceClass } from '@/lib/serviceClass';

/**
 * Our negotiated discount off each carrier's PUBLISHED list price, per service
 * speed — the shop's contract incentive.
 *
 * WHY THIS EXISTS: the counter always needs a price, so it always needs a cost
 * to price from. When a carrier's rate reply carries no account rate (see
 * ShippingRate.rateSource), the only figure we have is the published list price,
 * which is far above what we actually pay — marking that up produced a $187.22
 * quote on a shipment costing $74.89. Applying the known incentive to list
 * recovers a realistic cost basis instead of pricing off a number we never pay.
 *
 * Carriers discount by service, not uniformly: express is usually discounted far
 * harder than ground, which is exactly why a single shop-wide percentage would
 * misprice the services that matter most.
 *
 * Staff edit these at /admin/settings; they persist in slpack.settings
 * (_id 'carrierIncentives') so every terminal agrees. The measured spread per
 * service is in Reports → Margin — read it there, enter it here.
 */

/** Carriers that publish a list rate we can discount from. USPS/DHL don't. */
export const INCENTIVE_CARRIERS = ['ups', 'fedex'] as const;
export type IncentiveCarrier = (typeof INCENTIVE_CARRIERS)[number];

export type CarrierIncentives = Record<IncentiveCarrier, Record<ServiceClass, number>>;

/** Highest discount we'll accept as plausible. Above this, assume a typo. */
export const MAX_INCENTIVE = 0.9;

function zeroed(): Record<ServiceClass, number> {
  return Object.fromEntries(SERVICE_CLASS_ORDER.map((c) => [c, 0])) as Record<ServiceClass, number>;
}

/**
 * Shipped default is ZERO discount everywhere — deliberately.
 *
 * A zero incentive makes the cost basis equal the list price, which OVER-prices
 * rather than under-prices. Guessing a discount we don't have would quote below
 * our real cost, so the safe default is to assume none until real contract
 * numbers are entered.
 */
export const DEFAULT_CARRIER_INCENTIVES: Readonly<CarrierIncentives> = {
  ups: zeroed(),
  fedex: zeroed(),
};

/**
 * Clamp saved settings into a sane range — never trust a stored value blindly,
 * on read as well as on write, so a document edited straight in the database
 * cannot produce a nonsense counter quote.
 *
 * null/undefined/'' fall back to the default rather than coercing: Number(null)
 * is 0, which here happens to be the safe direction, but relying on that would
 * break the moment a default becomes non-zero.
 */
export function normalizeCarrierIncentives(input: unknown): CarrierIncentives {
  const raw = (input ?? {}) as Partial<Record<IncentiveCarrier, Record<string, unknown>>>;
  const out = { ups: zeroed(), fedex: zeroed() } as CarrierIncentives;

  for (const carrier of INCENTIVE_CARRIERS) {
    for (const cls of SERVICE_CLASS_ORDER) {
      const value = raw?.[carrier]?.[cls];
      const fallback = DEFAULT_CARRIER_INCENTIVES[carrier][cls];
      if (value === null || value === undefined || value === '') {
        out[carrier][cls] = fallback;
        continue;
      }
      const n = Number(value);
      out[carrier][cls] = Number.isFinite(n) ? Math.min(Math.max(n, 0), MAX_INCENTIVE) : fallback;
    }
  }
  return out;
}

/** Look up one incentive, tolerating an unknown carrier (USPS/DHL → 0). */
export function incentiveFor(
  incentives: CarrierIncentives,
  carrier: string,
  serviceClass: ServiceClass
): number {
  const table = (incentives as Record<string, Record<ServiceClass, number>>)[carrier];
  return table ? (table[serviceClass] ?? 0) : 0;
}

/**
 * What this shipment actually costs us — the figure every price is derived from.
 *
 *   1. The carrier's account rate, when it returned one. Authoritative.
 *   2. Otherwise list x (1 - incentive): the best estimate available, and never
 *      below the truth by more than the incentive is wrong.
 *   3. Otherwise the quoted rate as-is (USPS/DHL, which publish no list rate).
 *
 * Deliberately never returns 0 for a real rate: a zero cost basis would let the
 * floor in freightPrice() price a shipment at $5.
 */
export function costBasisUSD(opts: {
  /** The carrier's negotiated/account rate, if the reply carried one. */
  accountUSD?: number | null;
  /** The carrier's published list rate, if available. */
  listUSD?: number | null;
  /** Our discount off list for this carrier + service, 0–0.9. */
  incentivePct?: number;
  /** The rate as quoted — last-resort fallback. */
  quotedUSD: number;
}): number {
  const account = Number(opts.accountUSD);
  if (Number.isFinite(account) && account > 0) return Math.round(account * 100) / 100;

  const list = Number(opts.listUSD);
  if (Number.isFinite(list) && list > 0) {
    const pct = Math.min(Math.max(Number(opts.incentivePct) || 0, 0), MAX_INCENTIVE);
    return Math.round(list * (1 - pct) * 100) / 100;
  }

  const quoted = Number(opts.quotedUSD);
  return Number.isFinite(quoted) && quoted > 0 ? Math.round(quoted * 100) / 100 : 0;
}
