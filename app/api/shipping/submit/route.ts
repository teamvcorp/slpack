import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { appendLog } from '@/lib/shipmentLog';
import { appendError } from '@/lib/errorLog';
import { logAndRespond } from '@/lib/apiErrors';
import { sanitizeEmail } from '@/lib/email';
import { INTERNAL_HEADER, internalApiToken } from '@/lib/internalAuth';
import { upsertContacts } from '@/lib/contacts';
import { buildShipmentReceiptHtml } from '@/lib/receipt';
import { priceInsurance } from '@/lib/shippingPricing';
import type { ShipmentLogEntry } from '@/app/admin/types/shipping';

const ROUTE = 'shipping/submit';

export async function POST(req: NextRequest) {
  try {
    const {
      carrier,
      serviceName,
      serviceCode,
      saturdayDelivery,
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

    // ── 0. Re-price insurance server-side ────────────────────────────────────
    // The browser picks the declared value, so it is an untrusted input: derive
    // the premium here from valueUSD instead of accepting the client's figure,
    // and clamp the value to the carrier cap before it reaches the label call.
    const pricedInsurance = priceInsurance(insurance, carrier, serviceName, shipment?.packaging);
    const insuranceChargeUSD = pricedInsurance.premiumUSD;

    // What the server says the premium *should* have been, for comparison below.
    const expectedTotalUSD =
      Math.round(
        (Number(shippingUSD) +
          insuranceChargeUSD +
          Number(packingFeeUSD ?? 0) +
          Number(cardFeeUSD ?? 0)) *
          100
      ) / 100;

    // The shipment log is the revenue book (/api/reports/sales sums totalUSD), so
    // it records MONEY COLLECTED, not a recomputed price. Payment is captured
    // before this route runs: writing the server's figure here when the two
    // disagree would overstate revenue and break reconciliation against the
    // Stripe payout. The server's price goes in the error log instead, so the
    // gap is visible and chaseable without corrupting the books.
    const num = (v: unknown, fallback: number) =>
      Number.isFinite(Number(v)) ? Number(v) : fallback;
    const collectedInsuranceUSD = num(insuranceUSD, insuranceChargeUSD);
    const collectedTotalUSD = num(totalUSD, expectedTotalUSD);

    if (Math.abs(collectedInsuranceUSD - insuranceChargeUSD) > 0.01) {
      await appendError({
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        route: ROUTE,
        carrier,
        status: 200,
        message:
          `Insurance underpriced by the client — collected $${collectedInsuranceUSD.toFixed(2)}, ` +
          `should have been $${insuranceChargeUSD.toFixed(2)}. Most likely a browser tab left ` +
          `open across a deploy; the customer was charged the lower amount.`,
        requestSummary: {
          serviceName,
          declaredValueUSD: pricedInsurance.valueUSD,
          collectedInsuranceUSD,
          expectedInsuranceUSD: insuranceChargeUSD,
          collectedTotalUSD,
          expectedTotalUSD,
          shortfallUSD: Math.round((expectedTotalUSD - collectedTotalUSD) * 100) / 100,
        },
      });
    }

    // ── 1. Generate label via carrier API ───────────────────────────────────
    // Attempt twice: carrier label APIs occasionally throw transient errors, and
    // a one-off failure shouldn't leave a paid shipment without a label. Both
    // attempts happen before we log, so a retry never creates a duplicate entry.
    let trackingNumber = 'PENDING';
    let labelBase64: string | null = null;
    let labelMimeType: string | null = null;
    let labelError: string | null = null;
    // Actual carrier charge for the label, when the carrier reports one.
    let carrierCostUSD: number | null = null;

    for (let attempt = 1; attempt <= 2; attempt++) {
      labelError = null;
      try {
        const labelRes = await fetch(
          `${process.env.NEXT_PUBLIC_BASE_URL ?? 'http://localhost:3000'}/api/shipping/${carrier}/label`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', [INTERNAL_HEADER]: internalApiToken() },
            // saturdayDelivery must be forwarded or the label books standard
            // Mon–Fri delivery even though a Saturday rate was quoted/charged.
            // (serviceName already carries the "— Saturday Delivery" suffix from
            // the rate route — never re-append it here.)
            body: JSON.stringify({
              shipment,
              serviceCode,
              // Normalized/capped, never the raw client object.
              insurance: pricedInsurance,
              saturdayDelivery: saturdayDelivery === true,
            }),
          }
        );
        const labelData = await labelRes.json();
        if (labelRes.ok) {
          trackingNumber = labelData.trackingNumber ?? 'PENDING';
          labelBase64 = labelData.labelBase64 ?? null;
          labelMimeType = labelData.labelMimeType ?? null;
          carrierCostUSD = Number.isFinite(Number(labelData.carrierCostUSD))
            ? Number(labelData.carrierCostUSD)
            : null;
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
      insuranceUSD: collectedInsuranceUSD,
      packingFeeUSD: Number(packingFeeUSD ?? 0),
      cardFeeUSD: Number(cardFeeUSD) > 0 ? Number(cardFeeUSD) : undefined,
      totalUSD: collectedTotalUSD,
      carrierCostUSD: carrierCostUSD ?? undefined,
      trackingNumber,
      labelBase64,
      customerName: shipment.customerName ?? '',
      customerPhone: shipment.customerPhone ?? '',
      customerEmail: shipment.customerEmail ?? '',
      destAttention: shipment.destAttention?.trim() || undefined,
      insuranceDescription: pricedInsurance.description,
      paymentMethod: (paymentMethod === 'cash' ? 'cash' : 'card') as 'card' | 'cash',
      saturdayDelivery: saturdayDelivery === true ? true : undefined,
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
