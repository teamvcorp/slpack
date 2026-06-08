/** Shared reporting periods used by the drop-off and sales reports. */
export type ReportPeriod = 'today' | 'mtd' | 'ytd';

/** Local-time start of a report period (today / month-to-date / year-to-date). */
export function reportPeriodStart(period: ReportPeriod, now: Date = new Date()): Date {
  if (period === 'today') return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (period === 'mtd') return new Date(now.getFullYear(), now.getMonth(), 1);
  return new Date(now.getFullYear(), 0, 1); // ytd
}
