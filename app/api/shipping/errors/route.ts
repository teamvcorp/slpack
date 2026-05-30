import { NextRequest, NextResponse } from 'next/server';
import { readErrors } from '@/lib/errorLog';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const period = searchParams.get('period') ?? 'week'; // day | week | month | all
  const limitParam = parseInt(searchParams.get('limit') ?? '200', 10);
  const limit = Number.isFinite(limitParam) ? limitParam : 200;

  const DAY = 24 * 60 * 60 * 1000;
  const sinceMs =
    period === 'day' ? DAY :
    period === 'week' ? 7 * DAY :
    period === 'month' ? 31 * DAY :
    365 * DAY; // 'all' — cap at 1 year so the query is still bounded

  try {
    const entries = await readErrors({ sinceMs, limit });
    const byRoute = entries.reduce<Record<string, number>>((acc, e) => {
      acc[e.route] = (acc[e.route] ?? 0) + 1;
      return acc;
    }, {});
    return NextResponse.json({
      entries,
      total: entries.length,
      byRoute,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to read error log';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
