import { localDateStamp, startOfLocalDayUtc } from './localDate';

/** Reporting periods on the Sales / Margin / Drop-off tabs. */
export type ReportPeriod = 'today' | 'mtd' | 'ytd';

/** Periods on the Shipments tab. A different vocabulary because staff use a
 *  rolling week and an all-time view there; both sets share the math below. */
export type LogPeriod = 'day' | 'week' | 'month' | 'all';

/**
 * WHY THIS IS NOT `new Date(y, m, d)` (bug fix, 2026-09-09):
 *
 * it was, and it ran on a host whose clock is UTC. `new Date(y, m, d)` builds
 * midnight in the SERVER's zone, so "Today" began at 00:00 UTC — 19:00 CT the
 * PREVIOUS day. Measured against production rows: at 7 pm Central the Reports
 * page dropped from 9 drop-offs and 1 shipment to zero, because the window had
 * already rolled to tomorrow and the whole business day fell out of it. The
 * identical code was correct on a Central-time dev machine, which is what made
 * it look like a live-site-only fault.
 *
 * Every boundary now comes from the store's own calendar via lib/localDate.ts.
 *
 * Returns a UTC ISO-8601 string, not a Date, because that is exactly what the
 * collections store and what the `{ timestamp: { $gte } }` lexical comparison
 * needs. Making the string the contract means no caller can re-localise it and
 * quietly reintroduce this bug.
 */
export function reportPeriodStartIso(
  period: ReportPeriod,
  now: Date = new Date()
): string {
  const today = localDateStamp(now); // YYYY-MM-DD, store-local
  const [year, month] = today.split('-');
  const stamp =
    period === 'today' ? today : period === 'mtd' ? `${year}-${month}-01` : `${year}-01-01`;
  return startOfLocalDayUtc(stamp).toISOString();
}

/**
 * The same, in the Shipments tab's vocabulary.
 *
 * `null` means "no lower bound" ('all') — the caller is expected to bound the
 * query some other way (readShipmentList applies a row limit).
 *
 * 'week' is anchored to store-local calendar days (today plus the previous
 * six), not a rolling 168 hours. BEHAVIOUR CHANGE, deliberate: the old rolling
 * window made a shipment drop out of "This Week" partway through the seventh
 * morning, which is not what the label promises.
 */
export function logPeriodStartIso(period: LogPeriod, now: Date = new Date()): string | null {
  if (period === 'all') return null;
  const today = localDateStamp(now);
  const [year, month] = today.split('-');
  if (period === 'month') return startOfLocalDayUtc(`${year}-${month}-01`).toISOString();
  if (period === 'day') return startOfLocalDayUtc(today).toISOString();
  // 'week' — step back six local days from local midnight, then re-resolve the
  // resulting local date. Going through localDateStamp rather than subtracting
  // raw milliseconds keeps the boundary on a local midnight even in the two
  // weeks that contain a DST transition (which are 167 and 169 hours long).
  const sixDaysBack = new Date(startOfLocalDayUtc(today).getTime() - 6 * 86_400_000);
  return startOfLocalDayUtc(localDateStamp(sixDaysBack)).toISOString();
}
