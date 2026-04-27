import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { appendLog } from '@/lib/shipmentLog';
import type { ShipmentLogEntry } from '@/app/admin/types/shipping';

export async function POST(req: NextRequest) {
  try {
    const {
      carrier,
      serviceName,
      serviceCode,
      shipment,
      shippingUSD,
      insuranceUSD,
      totalUSD,
      insurance,
    } = await req.json();

    // ── 1. Generate label via carrier API ───────────────────────────────────
    let trackingNumber = 'PENDING';
    let labelBase64: string | null = null;

    try {
      const labelRes = await fetch(
        `${process.env.NEXT_PUBLIC_BASE_URL ?? 'http://localhost:3000'}/api/shipping/${carrier}/label`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ shipment, serviceCode, insurance }),
        }
      );
      if (labelRes.ok) {
        const labelData = await labelRes.json();
        trackingNumber = labelData.trackingNumber ?? 'PENDING';
        labelBase64 = labelData.labelBase64 ?? null;
      }
    } catch {
      // Label generation failed — log and continue; tracking = PENDING
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
      totalUSD: Number(totalUSD),
      trackingNumber,
      labelBase64,
      customerName: shipment.customerName ?? '',
      customerEmail: shipment.customerEmail ?? '',
    };

    appendLog(entry);

    // ── 3. Send receipt email via Resend ─────────────────────────────────────
    if (shipment.customerEmail && process.env.RESEND_API_KEY) {
      try {
        const { Resend } = await import('resend');
        const resend = new Resend(process.env.RESEND_API_KEY);

        const carrierLabel = ({ fedex: 'FedEx', ups: 'UPS', usps: 'USPS', dhl: 'DHL Express' } as Record<string, string>)[carrier] ?? carrier.toUpperCase();
        const fromEmail = process.env.RESEND_FROM_EMAIL ?? 'shipping@stormlakepackandship.com';
        const shopName = 'Storm Lake Pack & Ship';

        await resend.emails.send({
          from: `${shopName} <${fromEmail}>`,
          to: shipment.customerEmail,
          subject: `Your Shipping Receipt — ${carrierLabel} ${trackingNumber}`,
          html: buildReceiptHtml({
            customerName: shipment.customerName,
            carrierLabel,
            serviceName,
            trackingNumber,
            originZip: shipment.originZip,
            destZip: shipment.destZip,
            destCity: shipment.destCity,
            destState: shipment.destState,
            weightLbs: shipment.weightLbs,
            shippingUSD: Number(shippingUSD),
            insuranceUSD: Number(insuranceUSD),
            totalUSD: Number(totalUSD),
            declaredValueUSD: insurance?.valueUSD ?? 0,
            shopName,
          }),
        });
      } catch {
        // Receipt send failure is non-fatal
      }
    }

    return NextResponse.json({ trackingNumber, labelBase64 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

interface ReceiptParams {
  customerName: string;
  carrierLabel: string;
  serviceName: string;
  trackingNumber: string;
  originZip: string;
  destZip: string;
  destCity: string;
  destState: string;
  weightLbs: number;
  shippingUSD: number;
  insuranceUSD: number;
  totalUSD: number;
  declaredValueUSD: number;
  shopName: string;
}

function buildReceiptHtml(p: ReceiptParams): string {
  const insRow =
    p.insuranceUSD > 0
      ? `<tr><td style="padding:4px 0;color:#666;">Insurance (declared $${p.declaredValueUSD.toFixed(2)})</td><td style="padding:4px 0;text-align:right;">$${p.insuranceUSD.toFixed(2)}</td></tr>`
      : '';

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Shipping Receipt</title></head>
<body style="font-family:Arial,sans-serif;background:#f5f0e8;margin:0;padding:24px;">
  <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
    <div style="background:#1a2744;padding:24px 32px;">
      <h1 style="color:#fff;margin:0;font-size:20px;">${p.shopName}</h1>
      <p style="color:rgba(255,255,255,0.6);margin:4px 0 0;font-size:13px;">Shipping Receipt</p>
    </div>
    <div style="padding:24px 32px;">
      <p style="color:#1a2744;font-size:15px;">Hi ${p.customerName || 'there'},</p>
      <p style="color:#555;font-size:14px;line-height:1.6;">
        Your shipment has been processed and is on its way. Here are your details:
      </p>

      <div style="background:#f5f0e8;border-radius:8px;padding:16px;margin:16px 0;">
        <p style="margin:0 0 4px;font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:#999;">Tracking Number</p>
        <p style="margin:0;font-size:22px;font-weight:bold;letter-spacing:0.12em;color:#1a2744;">${p.trackingNumber}</p>
      </div>

      <table style="width:100%;border-collapse:collapse;font-size:14px;margin:16px 0;">
        <tr><td style="padding:4px 0;color:#666;">Carrier</td><td style="padding:4px 0;text-align:right;font-weight:600;color:#1a2744;">${p.carrierLabel}</td></tr>
        <tr><td style="padding:4px 0;color:#666;">Service</td><td style="padding:4px 0;text-align:right;color:#1a2744;">${p.serviceName}</td></tr>
        <tr><td style="padding:4px 0;color:#666;">From</td><td style="padding:4px 0;text-align:right;color:#1a2744;">${p.originZip}</td></tr>
        <tr><td style="padding:4px 0;color:#666;">To</td><td style="padding:4px 0;text-align:right;color:#1a2744;">${p.destCity ? `${p.destCity}, ${p.destState} ` : ''}${p.destZip}</td></tr>
        <tr><td style="padding:4px 0;color:#666;">Weight</td><td style="padding:4px 0;text-align:right;color:#1a2744;">${p.weightLbs} lbs</td></tr>
        <tr style="border-top:1px solid #eee;"><td style="padding:8px 0 4px;color:#666;">Shipping</td><td style="padding:8px 0 4px;text-align:right;">$${p.shippingUSD.toFixed(2)}</td></tr>
        ${insRow}
        <tr style="border-top:2px solid #1a2744;"><td style="padding:8px 0 0;font-weight:bold;color:#1a2744;">Total Charged</td><td style="padding:8px 0 0;text-align:right;font-weight:bold;font-size:18px;color:#1a2744;">$${p.totalUSD.toFixed(2)}</td></tr>
      </table>

      <p style="color:#888;font-size:12px;margin-top:24px;">
        Questions? Contact us at Storm Lake Pack &amp; Ship.<br>
        Thank you for your business!
      </p>
    </div>
  </div>
</body>
</html>`;
}
