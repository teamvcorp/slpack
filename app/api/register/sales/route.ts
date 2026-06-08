import { NextRequest, NextResponse } from 'next/server';
import { readSalesSince } from '@/lib/saleLog';
import { reportPeriodStart, type ReportPeriod } from '@/lib/reportPeriod';

const VALID: ReportPeriod[] = ['today', 'mtd', 'ytd'];

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const raw = searchParams.get('period') ?? 'today';
  const period: ReportPeriod = (VALID as string[]).includes(raw) ? (raw as ReportPeriod) : 'today';

  const since = reportPeriodStart(period).toISOString();
  const entries = await readSalesSince(since);

  const totalRevenue = entries.reduce((s, e) => s + e.totalUSD, 0);
  const totalTax = entries.reduce((s, e) => s + e.taxUSD, 0);
  const byPayment = entries.reduce<Record<string, { count: number; revenue: number }>>((acc, e) => {
    const k = e.paymentMethod;
    acc[k] = acc[k] ?? { count: 0, revenue: 0 };
    acc[k].count += 1;
    acc[k].revenue += e.totalUSD;
    return acc;
  }, {});

  return NextResponse.json({
    period,
    entries,
    total: entries.length,
    totalRevenue,
    totalTax,
    byPayment,
  });
}
