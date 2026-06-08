import { NextRequest, NextResponse } from 'next/server';
import { readDropoffsSince } from '@/lib/dropoffLog';
import { reportPeriodStart } from '@/lib/reportPeriod';
import { buildDropoffReportHtml } from '@/lib/receipt';
import { sanitizeEmail } from '@/lib/email';
import type { DropoffPeriod } from '@/app/admin/types/dropoff';

const VALID: DropoffPeriod[] = ['today', 'mtd', 'ytd'];
const PERIOD_LABELS: Record<DropoffPeriod, string> = {
  today: 'Today',
  mtd: 'Month to Date',
  ytd: 'Year to Date',
};

export async function POST(req: NextRequest) {
  try {
    if (!process.env.RESEND_API_KEY) {
      return NextResponse.json({ error: 'Email not configured (RESEND_API_KEY missing)' }, { status: 503 });
    }

    const body = await req.json();
    const to = sanitizeEmail(body.to);
    if (!to) {
      return NextResponse.json({ error: 'A valid recipient email is required' }, { status: 400 });
    }

    const raw = String(body.period ?? 'mtd');
    const period: DropoffPeriod = (VALID as string[]).includes(raw) ? (raw as DropoffPeriod) : 'mtd';

    const since = reportPeriodStart(period).toISOString();
    const entries = await readDropoffsSince(since);
    const byCarrier = entries.reduce<Record<string, number>>((acc, e) => {
      acc[e.carrier] = (acc[e.carrier] ?? 0) + 1;
      return acc;
    }, {});

    const { Resend } = await import('resend');
    const resend = new Resend(process.env.RESEND_API_KEY);
    const fromEmail = process.env.RESEND_FROM_EMAIL ?? 'shipping@stormlakepackandship.com';

    await resend.emails.send({
      from: `Storm Lake Pack & Ship <${fromEmail}>`,
      to,
      subject: `Drop-off Report — ${PERIOD_LABELS[period]} (${entries.length} packages)`,
      html: buildDropoffReportHtml(entries, period, byCarrier),
    });

    return NextResponse.json({ ok: true, total: entries.length });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
