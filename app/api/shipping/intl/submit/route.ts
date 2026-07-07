import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { appendLog } from '@/lib/shipmentLog';
import { logAndRespond } from '@/lib/apiErrors';
import { sanitizeEmail } from '@/lib/email';
import { INTERNAL_HEADER, internalApiToken } from '@/lib/internalAuth';
import { upsertContacts } from '@/lib/contacts';
import { buildShipmentReceiptHtml } from '@/lib/receipt';
import type { ShipmentLogEntry } from '@/app/admin/types/shipping';
import type { IntlDocument } from '@/app/admin/types/shippingIntl';

// International submit — mirrors the domestic /api/shipping/submit but fans out
// to the intl label routes and returns the full document set (label + invoice).
// Kept separate so domestic submit is untouched.
const ROUTE = 'shipping/intl/submit';

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
      dutiesUSD,
      totalUSD,
      insurance,
      paymentMethod,
      transactionId,
      suppressEmail,
    } = await req.json();

    // ── 1. Generate label + customs docs via intl carrier API (retry once) ───
    let trackingNumber = 'PENDING';
    let labelBase64: string | null = null;
    let labelMimeType: string | null = null;
    let labelError: string | null = null;
    let documents: IntlDocument[] = [];

    for (let attempt = 1; attempt <= 2; attempt++) {
      labelError = null;
      try {
        const labelRes = await fetch(
          `${process.env.NEXT_PUBLIC_BASE_URL ?? 'http://localhost:3000'}/api/shipping/intl/${carrier}/label`,
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
          documents = Array.isArray(labelData.documents) ? labelData.documents : [];
          break;
        }
        const detail = labelData.details ? ` — ${labelData.details}` : '';
        labelError = (labelData.error ?? `Label API error (${labelRes.status})`) + detail;
      } catch (err: unknown) {
        labelError = err instanceof Error ? err.message : 'Label generation failed';
      }
    }

    // ── 2. Append to shipment log (shared collection) ────────────────────────
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
      dutiesUSD: Number(dutiesUSD ?? 0),
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

    // ── 3. Save sender → recipient contacts ──────────────────────────────────
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
          country: shipment.destCountry ?? '',
        },
      });
    } catch {
      // non-fatal
    }

    // ── 4. Receipt email ─────────────────────────────────────────────────────
    const recipientEmail = sanitizeEmail(shipment.customerEmail);
    if (recipientEmail && suppressEmail !== true && process.env.RESEND_API_KEY) {
      try {
        const { Resend } = await import('resend');
        const resend = new Resend(process.env.RESEND_API_KEY);
        const carrierLabel = ({ fedex: 'FedEx', ups: 'UPS' } as Record<string, string>)[carrier] ?? carrier.toUpperCase();
        const fromEmail = process.env.RESEND_FROM_EMAIL ?? 'shipping@stormlakepackandship.com';
        await resend.emails.send({
          from: `Storm Lake Pack & Ship <${fromEmail}>`,
          to: recipientEmail,
          subject: `Your International Shipping Receipt — ${carrierLabel} ${trackingNumber}`,
          html: buildShipmentReceiptHtml(entry),
        });
      } catch {
        // non-fatal
      }
    }

    return NextResponse.json({ trackingNumber, labelBase64, labelMimeType, labelError, documents });
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
