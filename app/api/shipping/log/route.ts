import { NextRequest, NextResponse } from 'next/server';
import { readLog } from '@/lib/shipmentLog';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const period = searchParams.get('period') ?? 'day'; // day | week | month | all

  const entries = await readLog();
  const now = new Date();

  const filtered = entries.filter((e) => {
    const ts = new Date(e.timestamp);
    if (period === 'day') {
      return ts.toDateString() === now.toDateString();
    }
    if (period === 'week') {
      const msAgo = now.getTime() - ts.getTime();
      return msAgo <= 7 * 24 * 60 * 60 * 1000;
    }
    if (period === 'month') {
      return ts.getFullYear() === now.getFullYear() && ts.getMonth() === now.getMonth();
    }
    return true; // 'all'
  });

  const totalRevenue = filtered.reduce((sum, e) => sum + e.totalUSD, 0);
  const totalShipments = filtered.length;
  const byCarrier = filtered.reduce<Record<string, number>>((acc, e) => {
    acc[e.carrier] = (acc[e.carrier] ?? 0) + 1;
    return acc;
  }, {});

  return NextResponse.json({ entries: filtered, totalRevenue, totalShipments, byCarrier });
}
