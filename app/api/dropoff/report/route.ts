import { NextRequest, NextResponse } from 'next/server';
import { readDropoffsSince } from '@/lib/dropoffLog';
import { reportPeriodStart } from '@/lib/reportPeriod';
import type { DropoffPeriod } from '@/app/admin/types/dropoff';

const VALID: DropoffPeriod[] = ['today', 'mtd', 'ytd'];

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const raw = searchParams.get('period') ?? 'mtd';
  const period: DropoffPeriod = (VALID as string[]).includes(raw) ? (raw as DropoffPeriod) : 'mtd';

  const since = reportPeriodStart(period).toISOString();
  const entries = await readDropoffsSince(since);

  const byCarrier = entries.reduce<Record<string, number>>((acc, e) => {
    acc[e.carrier] = (acc[e.carrier] ?? 0) + 1;
    return acc;
  }, {});

  return NextResponse.json({ period, entries, total: entries.length, byCarrier });
}
