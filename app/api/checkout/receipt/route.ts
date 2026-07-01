import { NextRequest, NextResponse } from 'next/server';
import { getSaleByTransaction } from '@/lib/saleLog';
import { readShipmentsByTransaction } from '@/lib/shipmentLog';
import { buildCombinedReceiptHtml, type CombinedPackageLine } from '@/lib/receipt';
import { sanitizeEmail } from '@/lib/email';

/**
 * Emails ONE unified receipt for a combined register + shipping transaction.
 * Rebuilt server-side from the stored sale + shipment records (linked by
 * transactionId) so the emailed copy is authoritative and matches the charge.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const transactionId = String(body.transactionId ?? '').trim();
    if (!transactionId) {
      return NextResponse.json({ error: 'transactionId is required' }, { status: 400 });
    }

    const email = sanitizeEmail(body.email);
    if (!email) {
      return NextResponse.json({ error: 'A valid email is required' }, { status: 400 });
    }

    const [sale, shipments] = await Promise.all([
      getSaleByTransaction(transactionId),
      readShipmentsByTransaction(transactionId),
    ]);

    if (!sale && shipments.length === 0) {
      return NextResponse.json({ error: 'No records found for this transaction' }, { status: 404 });
    }

    if (!process.env.RESEND_API_KEY) {
      return NextResponse.json({ emailed: false });
    }

    const packages: CombinedPackageLine[] = shipments.map((s) => ({
      carrier: s.carrier,
      serviceName: s.serviceName,
      trackingNumber: s.trackingNumber,
      amountUSD: s.totalUSD,
    }));

    const html = buildCombinedReceiptHtml({
      timestamp: sale?.timestamp ?? shipments[0]?.timestamp ?? new Date().toISOString(),
      paymentMethod: sale?.paymentMethod ?? shipments[0]?.paymentMethod ?? 'card',
      sale,
      packages,
      cashTenderedUSD: sale?.cashTenderedUSD,
      changeDueUSD: sale?.changeDueUSD,
    });

    const goodsTotal = sale?.totalUSD ?? 0;
    const shipTotal = packages.reduce((s, p) => s + p.amountUSD, 0);
    const grandTotal = (goodsTotal + shipTotal).toFixed(2);

    try {
      const { Resend } = await import('resend');
      const resend = new Resend(process.env.RESEND_API_KEY);
      const fromEmail = process.env.RESEND_FROM_EMAIL ?? 'shipping@stormlakepackandship.com';
      await resend.emails.send({
        from: `Storm Lake Pack & Ship <${fromEmail}>`,
        to: email,
        subject: `Your Receipt — $${grandTotal}`,
        html,
      });
      return NextResponse.json({ emailed: true });
    } catch {
      // Email failure is non-fatal — the sale is already recorded.
      return NextResponse.json({ emailed: false });
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
