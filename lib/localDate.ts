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
 *
 * The same bug resurfaced in the REPORT windows on 2026-09-09 (a UTC host made
 * "Today" start at 7 pm CT the previous day, emptying the Reports page every
 * evening) — see reporting_notes.md and lib/reportPeriod.ts. If you are hunting
 * a date that is off by one, check whether the code below is being used at all.
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

/**
 * Offset of `timeZone` from UTC, in milliseconds, AT A SPECIFIC INSTANT.
 *
 * Must be evaluated per-instant, never stored as a constant: Central is UTC−5
 * in summer and UTC−6 in winter, so a hard-coded offset is wrong for half the
 * year — and wrong by an hour on the two transition days.
 *
 * Technique: format the instant into the target zone's wall-clock parts, then
 * reinterpret those parts AS IF they were UTC. The gap between that fictional
 * UTC instant and the real one IS the offset. Uses formatToParts rather than
 * parsing a formatted string, so no locale or format change can break it.
 *
 * Reads no host state — not one local-time Date getter is called below — so it
 * returns the same answer on the UTC production host and a Central dev box.
 */
export function zoneOffsetMs(instant: Date, timeZone: string = STORE_TIME_ZONE): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(instant)
      .filter((p) => p.type !== 'literal')
      .map((p) => [p.type, Number(p.value)])
  ) as Record<string, number>;

  // Some ICU builds render midnight as hour 24 rather than 0. Normalise it, or
  // Date.UTC silently rolls the day forward — the very bug this file exists for.
  const hour = parts.hour === 24 ? 0 : parts.hour;

  const asIfUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    hour,
    parts.minute,
    parts.second
  );
  return asIfUtc - instant.getTime();
}

/**
 * The UTC instant at which a store-local calendar day BEGINS (00:00:00 local).
 *
 * `dateStamp` is 'YYYY-MM-DD' in store-local terms — the output of
 * localDateStamp(), or that output with the day/month replaced to reach the
 * 1st of the month or the 1st of January.
 *
 * This is the value the report queries need. Every collection stores its
 * timestamp as a UTC ISO string, so "everything since midnight in Storm Lake"
 * is a `$gte` against the UTC instant of that local midnight — 05:00Z in
 * summer, 06:00Z in winter.
 *
 * TWO PASSES, on purpose. Pass 1 guesses the offset by reading the wall-clock
 * value as if it were UTC; that guess can land on the wrong side of a DST
 * transition (resolving 1 Nov using the 31 Oct offset, say). Pass 2 re-reads
 * the offset at the candidate instant and corrects if it disagrees. It
 * converges because the second reading is taken inside the target day.
 *
 * Only ever call this for midnight. America/Chicago switches at 02:00 local, so
 * local midnight is never a skipped or repeated wall time and there is no
 * ambiguity to resolve. That is why there is deliberately no `hour` parameter.
 */
export function startOfLocalDayUtc(
  dateStamp: string,
  timeZone: string = STORE_TIME_ZONE
): Date {
  const [y, m, d] = dateStamp.split('-').map(Number);
  const wallAsUtc = Date.UTC(y, m - 1, d, 0, 0, 0, 0);
  const first = zoneOffsetMs(new Date(wallAsUtc), timeZone);
  let ts = wallAsUtc - first;
  const second = zoneOffsetMs(new Date(ts), timeZone);
  if (second !== first) ts = wallAsUtc - second;
  return new Date(ts);
}
