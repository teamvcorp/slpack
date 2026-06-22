import { NextRequest, NextResponse } from 'next/server';
import { readDropoffsByBatch, markBatchEmailed } from '@/lib/dropoffLog';
import { buildDropoffReceiptHtml } from '@/lib/receipt';
import { sanitizeEmail } from '@/lib/email';

/**
 * Emails a single combined drop-off receipt covering every package in a batch.
 * Called once at finalize time, after the customer's packages have been scanned.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const batchId = String(body.batchId ?? '').trim();
    if (!batchId) {
      return NextResponse.json({ error: 'batchId is required' }, { status: 400 });
    }

    const customerEmail = sanitizeEmail(body.customerEmail);
    if (!customerEmail) {
      return NextResponse.json({ error: 'A valid customer email is required' }, { status: 400 });
    }

    const records = await readDropoffsByBatch(batchId);
    if (records.length === 0) {
      return NextResponse.json({ error: 'No packages found for this batch' }, { status: 404 });
    }

    if (!process.env.RESEND_API_KEY) {
      return NextResponse.json({ emailed: false });
    }

    try {
      const { Resend } = await import('resend');
      const resend = new Resend(process.env.RESEND_API_KEY);
      const fromEmail = process.env.RESEND_FROM_EMAIL ?? 'shipping@stormlakepackandship.com';
      const count = records.length;
      const subject =
        count > 1 ? `Drop-off Receipt — ${count} packages` : `Drop-off Receipt — 1 package`;
      await resend.emails.send({
        from: `Storm Lake Pack & Ship <${fromEmail}>`,
        to: customerEmail,
        subject,
        html: buildDropoffReceiptHtml(records),
      });
      await markBatchEmailed(batchId);
      return NextResponse.json({ emailed: true });
    } catch {
      // Email failure is non-fatal — the packages are still recorded.
      return NextResponse.json({ emailed: false });
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
