/**
 * Groups carrier service names into speed classes for margin reporting.
 *
 * The question this exists to answer: does our flat 55% markup hold up across
 * service speeds, or does express behave differently? Answering it needs
 * "UPS Next Day Air", "UPS Next Day Air Saver" and "FedEx Priority Overnight"
 * to land in one bucket.
 *
 * Service names arrive from the rate routes exactly as the carriers spell them,
 * possibly with a " — Saturday Delivery" suffix appended by the rate route (see
 * saturday_delivery_notes.md). The suffix never changes the speed class, and the
 * patterns below match on the base name regardless.
 */

export type ServiceClass =
  | 'overnight'
  | 'two-day'
  | 'three-day'
  | 'ground'
  | 'international'
  | 'other';

export const SERVICE_CLASS_LABELS: Record<ServiceClass, string> = {
  overnight: 'Overnight / Next Day',
  'two-day': '2-Day',
  'three-day': '3-Day / Saver',
  ground: 'Ground',
  international: 'International',
  other: 'Other',
};

/** Display order for report rows — fastest (and priciest) first. */
export const SERVICE_CLASS_ORDER: ServiceClass[] = [
  'overnight',
  'two-day',
  'three-day',
  'ground',
  'international',
  'other',
];

/**
 * ORDER MATTERS — first match wins, and several patterns overlap:
 *
 *  - International goes first. "FedEx International Priority" contains
 *    "Priority" and "UPS Worldwide Express" contains "Express"; both belong in
 *    the international bucket regardless of their speed, because they're rated
 *    on a different tariff entirely.
 *  - Overnight before three-day. "FedEx Priority Overnight" and "FedEx Express
 *    Saver" both contain a speed word, but "Saver" here means 3-day. Matching
 *    a bare /express/ would put them in the same bucket, so we never do —
 *    "express saver" is spelled out under three-day instead.
 *  - USPS "Priority Mail Express" IS the overnight product, so it's matched
 *    explicitly rather than left to fall through to /express saver/.
 */
const RULES: Array<{ test: RegExp; cls: ServiceClass }> = [
  { test: /international|worldwide/i, cls: 'international' },
  { test: /overnight|next\s*-?\s*day|priority\s*mail\s*express/i, cls: 'overnight' },
  { test: /\b2\s*-?\s*day|2nd\s*day|second\s*day/i, cls: 'two-day' },
  { test: /\b3\s*-?\s*day|express\s*saver/i, cls: 'three-day' },
  { test: /ground|home\s*delivery/i, cls: 'ground' },
];

export function classifyService(serviceName: string): ServiceClass {
  const name = String(serviceName ?? '');
  for (const { test, cls } of RULES) {
    if (test.test(name)) return cls;
  }
  return 'other';
}
