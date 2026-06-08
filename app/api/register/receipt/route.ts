import { NextRequest, NextResponse } from 'next/server';
import { getSaleById } from '@/lib/saleLog';
import { buildSaleReceiptHtml } from '@/lib/receipt';
import { sanitizeEmail } from '@/lib/email';

/** Re-sends a register sale receipt by email (to the sale's customer, or an override address). */
export async function POST(req: NextRequest) {
  try {
    if (!process.env.RESEND_API_KEY) {
      return NextResponse.json({ error: 'Email not configured (RESEND_API_KEY missing)' }, { status: 503 });
    }

    const body = await req.json();
    const saleId = String(body.saleId ?? '').trim();
    if (!saleId) {
      return NextResponse.json({ error: 'saleId is required' }, { status: 400 });
    }

    const sale = await getSaleById(saleId);
    if (!sale) {
      return NextResponse.json({ error: 'Sale not found' }, { status: 404 });
    }

    const to = sanitizeEmail(body.to) ?? sale.customerEmail;
    if (!to) {
      return NextResponse.json({ error: 'No email address on this sale — provide one to resend' }, { status: 400 });
    }

    const { Resend } = await import('resend');
    const resend = new Resend(process.env.RESEND_API_KEY);
    const fromEmail = process.env.RESEND_FROM_EMAIL ?? 'shipping@stormlakepackandship.com';

    await resend.emails.send({
      from: `Storm Lake Pack & Ship <${fromEmail}>`,
      to,
      subject: `Your Receipt — $${sale.totalUSD.toFixed(2)}`,
      html: buildSaleReceiptHtml(sale),
    });

    return NextResponse.json({ ok: true, to });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
