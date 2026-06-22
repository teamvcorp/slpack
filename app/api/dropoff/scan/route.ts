import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { appendDropoff } from '@/lib/dropoffLog';
import { detectCarrier, trackingUrl, DROPOFF_CARRIER_LABELS } from '@/lib/dropoff';
import { buildDropoffReceiptHtml } from '@/lib/receipt';
import { sanitizeEmail } from '@/lib/email';
import type { DropoffCarrier, DropoffRecord } from '@/app/admin/types/dropoff';

const VALID_CARRIERS: DropoffCarrier[] = ['fedex', 'ups', 'usps', 'dhl', 'other'];

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const trackingNumber = String(body.trackingNumber ?? '').replace(/\s+/g, '').trim();
    if (!trackingNumber) {
      return NextResponse.json({ error: 'Tracking number is required' }, { status: 400 });
    }

    const carrier: DropoffCarrier = VALID_CARRIERS.includes(body.carrier)
      ? body.carrier
      : detectCarrier(trackingNumber);

    const customerEmail = sanitizeEmail(body.customerEmail);
    const wantEmail = body.sendEmail !== false && !!customerEmail;

    const record: DropoffRecord = {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      trackingNumber,
      carrier,
      customerName: body.customerName ? String(body.customerName).trim() : undefined,
      customerEmail,
      customerPhone: body.customerPhone ? String(body.customerPhone).trim() : undefined,
      receiptEmailed: false,
      batchId: body.batchId ? String(body.batchId) : undefined,
    };

    // Email the receipt (preferred) when we have an address and Resend is set up.
    if (wantEmail && process.env.RESEND_API_KEY) {
      try {
        const { Resend } = await import('resend');
        const resend = new Resend(process.env.RESEND_API_KEY);
        const fromEmail = process.env.RESEND_FROM_EMAIL ?? 'shipping@stormlakepackandship.com';
        const carrierLabel = DROPOFF_CARRIER_LABELS[carrier] ?? carrier;
        await resend.emails.send({
          from: `Storm Lake Pack & Ship <${fromEmail}>`,
          to: customerEmail!,
          subject: `Drop-off Receipt — ${carrierLabel} ${trackingNumber}`,
          html: buildDropoffReceiptHtml(record),
        });
        record.receiptEmailed = true;
      } catch {
        // Email failure is non-fatal — the package is still recorded.
      }
    }

    await appendDropoff(record);

    return NextResponse.json({
      record,
      trackingUrl: trackingUrl(carrier, trackingNumber),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
