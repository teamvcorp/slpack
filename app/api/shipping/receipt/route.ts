import { NextRequest, NextResponse } from 'next/server';
import { getShipmentById } from '@/lib/shipmentLog';
import { buildShipmentReceiptHtml } from '@/lib/receipt';
import { sanitizeEmail } from '@/lib/email';

const CARRIER_LABELS: Record<string, string> = {
  fedex: 'FedEx',
  ups: 'UPS',
  usps: 'USPS',
  dhl: 'DHL Express',
};

/** Re-sends a shipping sale receipt by email (to the shipment's customer, or an override address). */
export async function POST(req: NextRequest) {
  try {
    if (!process.env.RESEND_API_KEY) {
      return NextResponse.json({ error: 'Email not configured (RESEND_API_KEY missing)' }, { status: 503 });
    }

    const body = await req.json();
    const id = String(body.id ?? '').trim();
    if (!id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }

    const entry = await getShipmentById(id);
    if (!entry) {
      return NextResponse.json({ error: 'Shipment not found' }, { status: 404 });
    }

    const to = sanitizeEmail(body.to) ?? entry.customerEmail;
    if (!to) {
      return NextResponse.json({ error: 'No email address on this shipment — provide one to resend' }, { status: 400 });
    }

    const { Resend } = await import('resend');
    const resend = new Resend(process.env.RESEND_API_KEY);
    const fromEmail = process.env.RESEND_FROM_EMAIL ?? 'shipping@stormlakepackandship.com';
    const carrierLabel = CARRIER_LABELS[entry.carrier] ?? entry.carrier.toUpperCase();

    await resend.emails.send({
      from: `Storm Lake Pack & Ship <${fromEmail}>`,
      to,
      subject: `Your Shipping Receipt — ${carrierLabel} ${entry.trackingNumber ?? ''}`.trim(),
      html: buildShipmentReceiptHtml(entry),
    });

    return NextResponse.json({ ok: true, to });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
