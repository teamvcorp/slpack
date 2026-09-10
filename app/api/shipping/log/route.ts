import { NextRequest, NextResponse } from 'next/server';
import { readShipmentList, SHIPMENT_LIST_LIMIT } from '@/lib/shipmentLog';
import { logPeriodStartIso, type LogPeriod } from '@/lib/reportPeriod';

const VALID: LogPeriod[] = ['day', 'week', 'month', 'all'];

/**
 * Shipping-log feed for the Reports → Shipments tab.
 *
 * Two things changed here on 2026-09-09, both of which had teeth:
 *
 * 1. Filtering happens in MONGO against a store-local window. This route used
 *    to load the ENTIRE collection — label images and all — and then filter it
 *    in JS with server-local Date getters. On a UTC host that made "Today"
 *    begin at 19:00 CT the previous day, so the whole business day dropped out
 *    of the report every evening. See lib/reportPeriod.ts.
 *
 * 2. Rows come back through a field whitelist, so a response no longer carries
 *    every stored label. See ShipmentListEntry in app/admin/types/shipping.ts.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const raw = searchParams.get('period') ?? 'day';
  const period: LogPeriod = (VALID as string[]).includes(raw) ? (raw as LogPeriod) : 'day';

  const entries = await readShipmentList({ sinceIso: logPeriodStartIso(period) });

  // Coerce every row's totalUSD to a FINITE number: a single NaN/null (from a
  // malformed shipment) would otherwise make totalRevenue NaN -> JSON null ->
  // the client's total.toFixed() crash, blanking the page. (fix 2026-09-10)
  for (const e of entries) {
    if (!Number.isFinite(Number(e.totalUSD))) e.totalUSD = 0;
  }

  // Voided shipments were refunded and their labels cancelled — they stay in
  // the list (staff need to see them) but they are not revenue.
  const live = entries.filter((e) => !e.voided);

  return NextResponse.json({
    entries,
    totalRevenue: live.reduce((sum, e) => sum + Number(e.totalUSD), 0),
    totalShipments: live.length,
    byCarrier: live.reduce<Record<string, number>>((acc, e) => {
      acc[e.carrier] = (acc[e.carrier] ?? 0) + 1;
      return acc;
    }, {}),
    /** Row cap hit — the totals above cover only the rows returned. */
    truncated: entries.length >= SHIPMENT_LIST_LIMIT,
  });
}
