/**
 * Store-local date helpers.
 *
 * WHY THIS EXISTS (bug fix, 2026-08-07): several carrier routes computed the
 * ship date with `new Date().toISOString().split('T')[0]`, which is **UTC**.
 * Storm Lake is US Central (UTC−5 CDT / UTC−6 CST), so any label or rate
 * request made at/after 19:00 CDT (18:00 CST) rolled the date forward one
 * calendar day — e.g. a 7 pm Friday label was submitted with a *Saturday*
 * shipDatestamp, which made FedEx commit to Monday delivery instead of
 * Saturday. Carriers derive the delivery commitment from the ship date, so
 * this date must always be the store's local calendar day.
 *
 * Uses Intl with an explicit IANA time zone (DST-safe — never hand-roll
 * UTC offsets). The 'en-CA' locale formats as YYYY-MM-DD (ISO order).
 */
export const STORE_TIME_ZONE = 'America/Chicago';

/** YYYY-MM-DD in the store's local time zone. */
export function localDateStamp(
  date: Date = new Date(),
  timeZone: string = STORE_TIME_ZONE
): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}
