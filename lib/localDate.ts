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

// ──────────────────────── When a parcel actually ships ────────────────────────

/**
 * The store's daily carrier pickup, as a store-local hour on a 24-hour clock.
 *
 * UPS and FedEx both collect at closing. A parcel labelled after this has
 * missed the day's collection and does not enter the carrier's network until
 * the next pickup. That matters because carriers count the delivery commitment
 * from the ship date they are given — quote a date the parcel cannot make and
 * the customer is promised a delivery day that was never possible.
 */
export const PICKUP_CUTOFF_HOUR = 18;

/** Pickup time as the local `HHmm` UPS expects. Collection is at the cutoff. */
export const PICKUP_TIME_COMPACT = '1800';

/** Wall-clock hour and minute in `timeZone` at `date`. Host-zone independent. */
export function localTimeParts(
  date: Date = new Date(),
  timeZone: string = STORE_TIME_ZONE
): { hour: number; minute: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone,
      hourCycle: 'h23',
      hour: '2-digit',
      minute: '2-digit',
    })
      .formatToParts(date)
      .filter((p) => p.type !== 'literal')
      .map((p) => [p.type, Number(p.value)])
  ) as Record<string, number>;
  // Some ICU builds render midnight as 24 rather than 0 (see zoneOffsetMs).
  return { hour: parts.hour === 24 ? 0 : parts.hour, minute: parts.minute };
}

/**
 * Add whole days to a YYYY-MM-DD stamp, as pure calendar arithmetic.
 *
 * Anchored at noon UTC on purpose: a stamp is a calendar date with no zone, and
 * stepping in 24-hour jumps from midday can never land on the wrong date the
 * way midnight ± a DST hour can. Nothing here depends on the host zone.
 */
function addCalendarDays(stamp: string, days: number): string {
  const [y, m, d] = stamp.split('-').map(Number);
  const shifted = new Date(Date.UTC(y, m - 1, d, 12) + days * 86_400_000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(
    shifted.getUTCDate()
  )}`;
}

/** True when a YYYY-MM-DD stamp falls on a Saturday or Sunday. */
function isWeekendStamp(stamp: string): boolean {
  const [y, m, d] = stamp.split('-').map(Number);
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return day === 0 || day === 6;
}

/**
 * The store-local calendar day a parcel handed over at `at` will actually be
 * collected by the carrier — the date every rate and label request should send.
 *
 * WHY THIS IS NOT localDateStamp() (2026-09-10): the store closes at 6 pm and
 * there are no weekend pickups, so "today" is the wrong answer twice over.
 * A label written at 7 pm on a Friday does not move until MONDAY. Sending
 * Friday makes the carrier quote a commitment counted from a pickup that never
 * happened, and the customer is promised a delivery date the parcel cannot
 * meet. The previous UPS code was worse still — it used the server's UTC clock,
 * so that same Friday-evening label was stamped SATURDAY, a day the carrier
 * does not collect here at all.
 *
 * Rules, in order: start from the store-local date; if the pickup cutoff has
 * passed, move to the next day; then skip forward over Saturday and Sunday.
 *
 * KNOWN GAP: this does not know about holidays. A label written on Thanksgiving
 * eve still reports the next weekday. Carriers generally absorb that in their
 * own commitment, but if holiday quoting ever matters, this is the one function
 * to teach a holiday table — every carrier path calls it.
 */
export function nextPickupDateStamp(
  at: Date = new Date(),
  timeZone: string = STORE_TIME_ZONE
): string {
  let stamp = localDateStamp(at, timeZone);
  if (localTimeParts(at, timeZone).hour >= PICKUP_CUTOFF_HOUR) {
    stamp = addCalendarDays(stamp, 1);
  }
  while (isWeekendStamp(stamp)) stamp = addCalendarDays(stamp, 1);
  return stamp;
}

/** nextPickupDateStamp as the compact `YYYYMMDD` UPS expects. */
export function nextPickupDateCompact(
  at: Date = new Date(),
  timeZone: string = STORE_TIME_ZONE
): string {
  return nextPickupDateStamp(at, timeZone).replace(/-/g, '');
}
