import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { appendLog } from '@/lib/shipmentLog';
import { logAndRespond } from '@/lib/apiErrors';
import { sanitizeEmail } from '@/lib/email';
import { INTERNAL_HEADER, internalApiToken } from '@/lib/internalAuth';
import { upsertContacts } from '@/lib/contacts';
import { buildShipmentReceiptHtml } from '@/lib/receipt';
import type { ShipmentLogEntry } from '@/app/admin/types/shipping';

const ROUTE = 'shipping/submit';

export async function POST(req: NextRequest) {
  try {
    const {
      carrier,
      serviceName,
      serviceCode,
      shipment,
      shippingUSD,
      insuranceUSD,
      packingFeeUSD,
      cardFeeUSD,
      totalUSD,
      insurance,
      paymentMethod,
      transactionId,
      suppressEmail,
    } = await req.json();

    // ── 1. Generate label via carrier API ───────────────────────────────────
    // Attempt twice: carrier label APIs occasionally throw transient errors, and
    // a one-off failure shouldn't leave a paid shipment without a label. Both
    // attempts happen before we log, so a retry never creates a duplicate entry.
    let trackingNumber = 'PENDING';
    let labelBase64: string | null = null;
    let labelMimeType: string | null = null;
    let labelError: string | null = null;

    for (let attempt = 1; attempt <= 2; attempt++) {
      labelError = null;
      try {
        const labelRes = await fetch(
          `${process.env.NEXT_PUBLIC_BASE_URL ?? 'http://localhost:3000'}/api/shipping/${carrier}/label`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', [INTERNAL_HEADER]: internalApiToken() },
            body: JSON.stringify({ shipment, serviceCode, insurance }),
          }
        );
        const labelData = await labelRes.json();
        if (labelRes.ok) {
          trackingNumber = labelData.trackingNumber ?? 'PENDING';
          labelBase64 = labelData.labelBase64 ?? null;
          labelMimeType = labelData.labelMimeType ?? null;
          break;
        }
        const detail = labelData.details ? ` — ${labelData.details}` : '';
        labelError = (labelData.error ?? `Label API error (${labelRes.status})`) + detail;
      } catch (err: unknown) {
        labelError = err instanceof Error ? err.message : 'Label generation failed';
      }
    }

    // ── 2. Append to shipment log ────────────────────────────────────────────
    const entry: ShipmentLogEntry = {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      carrier,
      serviceName,
      originZip: shipment.originZip,
      destZip: shipment.destZip,
      destCity: shipment.destCity ?? '',
      destState: shipment.destState ?? '',
      weightLbs: shipment.weightLbs,
      shippingUSD: Number(shippingUSD),
      insuranceUSD: Number(insuranceUSD),
      packingFeeUSD: Number(packingFeeUSD ?? 0),
      cardFeeUSD: Number(cardFeeUSD) > 0 ? Number(cardFeeUSD) : undefined,
      totalUSD: Number(totalUSD),
      trackingNumber,
      labelBase64,
      customerName: shipment.customerName ?? '',
      customerPhone: shipment.customerPhone ?? '',
      customerEmail: shipment.customerEmail ?? '',
      destAttention: shipment.destAttention?.trim() || undefined,
      insuranceDescription: insurance?.description?.trim() || undefined,
      paymentMethod: (paymentMethod === 'cash' ? 'cash' : 'card') as 'card' | 'cash',
      transactionId: typeof transactionId === 'string' ? transactionId : undefined,
    };

    await appendLog(entry);

    // ── 3. Save sender → recipient contacts (one-to-many) ────────────────────
    try {
      await upsertContacts({
        sender: {
          name: shipment.senderName ?? '',
          phone: shipment.senderPhone ?? '',
          email: shipment.senderEmail ?? '',
        },
        recipient: {
          name: shipment.customerName ?? '',
          phone: shipment.customerPhone ?? '',
          email: shipment.customerEmail ?? '',
          street: shipment.destStreet ?? '',
          street2: shipment.destStreet2 ?? '',
          city: shipment.destCity ?? '',
          state: shipment.destState ?? '',
          zip: shipment.destZip ?? '',
          country: shipment.destCountry ?? 'US',
        },
      });
    } catch {
      // non-fatal — contact save failure should not block the shipment
    }

    // ── 4. Send receipt email via Resend ─────────────────────────────────────
    // Combined register+shipping sales email one unified receipt from the
    // checkout flow, so the per-package email is suppressed here.
    const recipientEmail = sanitizeEmail(shipment.customerEmail);
    if (recipientEmail && suppressEmail !== true && process.env.RESEND_API_KEY) {
      try {
        const { Resend } = await import('resend');
        const resend = new Resend(process.env.RESEND_API_KEY);

        const carrierLabel = ({ fedex: 'FedEx', ups: 'UPS', usps: 'USPS', dhl: 'DHL Express' } as Record<string, string>)[carrier] ?? carrier.toUpperCase();
        const fromEmail = process.env.RESEND_FROM_EMAIL ?? 'shipping@stormlakepackandship.com';

        await resend.emails.send({
          from: `Storm Lake Pack & Ship <${fromEmail}>`,
          to: recipientEmail,
          subject: `Your Shipping Receipt — ${carrierLabel} ${trackingNumber}`,
          html: buildShipmentReceiptHtml(entry),
        });
      } catch {
        // Receipt send failure is non-fatal
      }
    }

    return NextResponse.json({ id: entry.id, trackingNumber, labelBase64, labelMimeType, labelError });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return await logAndRespond({
      route: ROUTE,
      status: 500,
      message,
      err,
    });
  }
}
