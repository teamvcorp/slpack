import type { PartnerShipment } from '@/lib/partnerShipmentLog';
import { trackingUrl } from '@/lib/dropoff';
import type { DropoffCarrier } from '@/app/admin/types/dropoff';
import { SITE } from '@/lib/siteConfig';

/**
 * Partner-API email delivery (2026-09-10).
 *
 * Two net-new messages, both via Resend:
 *   • sendPartnerLabelEmail — self_ship: the shipping label as an ATTACHMENT to
 *     the partner's business email. Emailing the label is the delivery channel;
 *     the label bytes are never returned in the API response. This is the one
 *     new Resend capability (attachments) the counter never used.
 *   • sendPartnerPickupNotice — pickup_pack: tells the shop to collect and pack.
 *
 * Both are RETAIL-ONLY: they never show carrier cost, list price, or margin.
 * Both are best-effort helpers — the caller decides how a send failure affects
 * the request (a self_ship failure matters; a pickup notice does not).
 */

const CARRIER_LABEL: Record<string, string> = {
  ups: 'UPS',
  fedex: 'FedEx',
  usps: 'USPS',
  dhl: 'DHL Express',
};

function fromAddress(): string {
  const email = process.env.RESEND_FROM_EMAIL ?? 'shipping@stormlakepackandship.com';
  return `Storm Lake Pack & Ship <${email}>`;
}

function labelExtension(mime: string | undefined): string {
  if (mime === 'application/pdf') return 'pdf';
  if (mime === 'image/png') return 'png';
  return 'gif'; // UPS default
}

function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string)
  );
}

/** Email the label to the business. Returns true only on a confirmed send. */
export async function sendPartnerLabelEmail(
  to: string,
  shipment: PartnerShipment
): Promise<boolean> {
  if (!to || !process.env.RESEND_API_KEY) return false;
  if (!shipment.labelBase64) return false;

  const carrier = CARRIER_LABEL[shipment.carrier] ?? shipment.carrier.toUpperCase();
  const track = shipment.trackingNumber
    ? trackingUrl(shipment.carrier as DropoffCarrier, shipment.trackingNumber)
    : null;
  const r = shipment.recipient;

  const html = `
    <div style="font-family:system-ui,Segoe UI,Arial,sans-serif;max-width:560px;margin:0 auto;color:#111">
      <h2 style="margin:0 0 4px">Your shipping label is attached</h2>
      <p style="margin:0 0 16px;color:#555">${esc(SITE.name)}</p>
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        <tr><td style="padding:4px 0;color:#666">Carrier</td><td style="padding:4px 0;text-align:right">${esc(carrier)} — ${esc(shipment.serviceName)}</td></tr>
        ${shipment.trackingNumber ? `<tr><td style="padding:4px 0;color:#666">Tracking</td><td style="padding:4px 0;text-align:right">${esc(shipment.trackingNumber)}</td></tr>` : ''}
        <tr><td style="padding:4px 0;color:#666">Ship to</td><td style="padding:4px 0;text-align:right">${esc(r.name)}<br>${esc(r.city)}, ${esc(r.state)} ${esc(r.zip)}</td></tr>
        ${shipment.orderRef ? `<tr><td style="padding:4px 0;color:#666">Order</td><td style="padding:4px 0;text-align:right">${esc(shipment.orderRef)}</td></tr>` : ''}
        <tr><td style="padding:8px 0 0;color:#666">Shipping paid</td><td style="padding:8px 0 0;text-align:right;font-weight:600">$${shipment.retailUSD.toFixed(2)}</td></tr>
      </table>
      <p style="margin:16px 0 0;font-size:13px;color:#555">Print the attached label and affix it to the package.${track ? ` Track it any time at <a href="${esc(track)}">${esc(track)}</a>.` : ''}</p>
    </div>`;

  try {
    const { Resend } = await import('resend');
    const resend = new Resend(process.env.RESEND_API_KEY);
    await resend.emails.send({
      from: fromAddress(),
      to,
      subject: `Shipping label — ${carrier} ${shipment.trackingNumber ?? ''}`.trim(),
      html,
      attachments: [
        {
          filename: `label-${shipment.trackingNumber ?? shipment.id}.${labelExtension(shipment.labelMimeType)}`,
          content: shipment.labelBase64,
        },
      ],
    });
    return true;
  } catch (err) {
    console.error('[partnerEmail] label send failed', err instanceof Error ? err.message : err);
    return false;
  }
}

/** Notify the shop that a partner needs a pickup & pack. Best-effort. */
export async function sendPartnerPickupNotice(
  shipment: PartnerShipment,
  partnerName: string
): Promise<void> {
  const to = process.env.PARTNER_PICKUP_NOTIFY_EMAIL ?? SITE.email;
  if (!to || !process.env.RESEND_API_KEY) return;

  const r = shipment.recipient;
  const html = `
    <div style="font-family:system-ui,Segoe UI,Arial,sans-serif;max-width:560px;margin:0 auto;color:#111">
      <h2 style="margin:0 0 4px">Pickup &amp; pack request</h2>
      <p style="margin:0 0 16px;color:#555">From partner: <strong>${esc(partnerName)}</strong></p>
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        <tr><td style="padding:4px 0;color:#666">Ship to</td><td style="padding:4px 0;text-align:right">${esc(r.name)}<br>${esc(r.street)}${r.street2 ? '<br>' + esc(r.street2) : ''}<br>${esc(r.city)}, ${esc(r.state)} ${esc(r.zip)}</td></tr>
        <tr><td style="padding:4px 0;color:#666">Service (quoted)</td><td style="padding:4px 0;text-align:right">${esc(CARRIER_LABEL[shipment.carrier] ?? shipment.carrier)} — ${esc(shipment.serviceName)}</td></tr>
        <tr><td style="padding:4px 0;color:#666">Package (declared)</td><td style="padding:4px 0;text-align:right">${esc(shipment.freightRetailUSD.toFixed(2))} freight + ${esc(shipment.packingFeeUSD.toFixed(2))} packing</td></tr>
        ${shipment.orderRef ? `<tr><td style="padding:4px 0;color:#666">Order</td><td style="padding:4px 0;text-align:right">${esc(shipment.orderRef)}</td></tr>` : ''}
      </table>
      <p style="margin:16px 0 0;font-size:13px;color:#555">Collect the item, pack it, and create the label from the counter. Reconcile the box if it differs from the declared size. Ref: ${esc(shipment.id)}</p>
    </div>`;

  try {
    const { Resend } = await import('resend');
    const resend = new Resend(process.env.RESEND_API_KEY);
    await resend.emails.send({
      from: fromAddress(),
      to,
      subject: `Pickup & pack — ${partnerName} → ${r.city}, ${r.state}`,
      html,
    });
  } catch (err) {
    console.error('[partnerEmail] pickup notice failed', err instanceof Error ? err.message : err);
  }
}
