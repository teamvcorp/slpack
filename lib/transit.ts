/**
 * Shared helpers for normalizing carrier transit-time data into the
 * `estimatedDays` / `deliveryDate` shape the rate panels display.
 */

/** FedEx commit transit enum (e.g. "TWO_DAYS") → number of business days. */
const FEDEX_TRANSIT_DAYS: Record<string, number> = {
  ONE_DAY: 1,
  TWO_DAYS: 2,
  THREE_DAYS: 3,
  FOUR_DAYS: 4,
  FIVE_DAYS: 5,
  SIX_DAYS: 6,
  SEVEN_DAYS: 7,
  EIGHT_DAYS: 8,
  NINE_DAYS: 9,
  TEN_DAYS: 10,
  ELEVEN_DAYS: 11,
  TWELVE_DAYS: 12,
  THIRTEEN_DAYS: 13,
  FOURTEEN_DAYS: 14,
  FIFTEEN_DAYS: 15,
};

/** Maps a FedEx transit enum to a day count, or null if unknown/absent. */
export function fedexTransitToDays(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  return FEDEX_TRANSIT_DAYS[value.toUpperCase()] ?? null;
}

/**
 * Formats a carrier delivery date into a short, friendly string like
 * "Wed, Jun 18". Accepts UPS `YYYYMMDD`, ISO datetimes, and `YYYY-MM-DD`.
 * Returns the original string unchanged if it can't be parsed, and null for
 * empty input — so callers can pass raw carrier values safely.
 */
export function formatDeliveryDate(raw: unknown): string | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;

  let y: number, mo: number, d: number;
  const compact = /^(\d{4})(\d{2})(\d{2})$/.exec(s); // UPS YYYYMMDD
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s); // ISO / YYYY-MM-DD[...]
  if (compact) {
    [, y, mo, d] = compact.map(Number) as unknown as [string, number, number, number];
  } else if (iso) {
    [, y, mo, d] = iso.map(Number) as unknown as [string, number, number, number];
  } else {
    return s; // unrecognized — show as-is
  }

  const date = new Date(y, mo - 1, d);
  if (Number.isNaN(date.getTime())) return s;
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}
