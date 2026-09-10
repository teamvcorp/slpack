import { NextRequest, NextResponse } from 'next/server';
import { getUspsToken, BASE } from '@/lib/uspsToken';
import { logAndRespond } from '@/lib/apiErrors';
import { SITE } from '@/lib/siteConfig';
import { nextPickupDateStamp } from '@/lib/localDate';
import { uspsInternationalCustoms } from '@/lib/shippingIntl';
import { totalCustomsValue, EEI_FILING_THRESHOLD_USD } from '@/app/admin/types/shippingIntl';
import type { IntlShipmentInput, IntlDocument } from '@/app/admin/types/shippingIntl';

/**
 * USPS INTERNATIONAL label + customs (2026-09-10) — Stage B of the USPS intl
 * carrier. Isolated, mirroring the FedEx/UPS intl label routes and the DOMESTIC
 * USPS label route (app/api/shipping/usps/label/route.ts). Reuses the same USPS
 * OAuth + EPS payment authorization; the only new pieces are the international
 * label endpoint and the customs form.
 *
 * USPS integrates the customs declaration (CN22/CN23) INTO the label, so unlike
 * FedEx/UPS there is no separate commercial-invoice document — the returned
 * label PDF carries the customs form.
 *
 * Two-step, exactly like the domestic label route:
 *   1. POST /payments/v3/payment-authorization  → X-Payment-Authorization-Token
 *   2. POST /international-labels/v3/international-label  (with that token)
 */
const ROUTE = 'shipping/intl/usps/label';

/** ISO alpha-2 → USPS country name for the destinations the shop serves. USPS
 *  international addresses identify the country by name. Falls back to the code. */
const COUNTRY_NAMES: Record<string, string> = {
  MX: 'Mexico', BR: 'Brazil', CO: 'Colombia', AR: 'Argentina', CL: 'Chile',
  PE: 'Peru', EC: 'Ecuador', BO: 'Bolivia', PY: 'Paraguay', UY: 'Uruguay',
  VE: 'Venezuela', CA: 'Canada', GB: 'United Kingdom', DE: 'Germany',
  FR: 'France', AU: 'Australia', JP: 'Japan',
};

/**
 * Minimal multipart/form-data parser for the USPS label response. USPS base64-
 * encodes the PDF into the `labelImage` part, so reading the body as text and
 * stripping whitespace yields clean base64 (no binary corruption). Splits on the
 * boundary, then separates each part's headers from its body at the blank line.
 */
function parseMultipart(
  raw: string,
  boundary: string
): Array<{ name: string; contentType: string; body: string }> {
  if (!boundary) return [];
  return raw
    .split(`--${boundary}`)
    .map((seg) => seg.replace(/^\r?\n/, ''))
    .filter((seg) => seg.trim() && seg.trim() !== '--')
    .map((seg) => {
      const sep = seg.search(/\r?\n\r?\n/);
      const headerText = sep >= 0 ? seg.slice(0, sep) : '';
      const body = sep >= 0 ? seg.slice(sep).replace(/^\r?\n\r?\n/, '') : seg;
      return {
        name: headerText.match(/name="([^"]+)"/i)?.[1] ?? '',
        contentType: headerText.match(/Content-Type:\s*([^\r\n;]+)/i)?.[1]?.trim().toLowerCase() ?? '',
        body: body.replace(/\r?\n--$/, ''),
      };
    });
}

function splitName(full: string | undefined, fallback: string): { firstName: string; lastName: string } {
  const parts = String(full || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: fallback, lastName: fallback };
  const firstName = parts[0];
  const lastName = parts.slice(1).join(' ') || firstName;
  return { firstName, lastName };
}

export async function POST(req: NextRequest) {
  let requestSummary: Record<string, unknown> | undefined;
  try {
    if (!process.env.USPS_CLIENT_ID || !process.env.USPS_CLIENT_SECRET) {
      return await logAndRespond({ route: ROUTE, carrier: 'usps', status: 503, message: 'USPS credentials not configured' });
    }
    if (!process.env.USPS_CRID || !process.env.USPS_MID) {
      return await logAndRespond({ route: ROUTE, carrier: 'usps', status: 503, message: 'USPS_CRID and USPS_MID are required for label printing' });
    }

    const { shipment, serviceCode } = (await req.json()) as {
      shipment: IntlShipmentInput;
      serviceCode: string;
      insurance?: { enabled?: boolean; valueUSD?: number };
    };

    const customs = shipment?.customs;
    if (!customs?.commodities?.length) {
      return await logAndRespond({
        route: ROUTE,
        carrier: 'usps',
        status: 400,
        message: 'Customs commodities are required for an international USPS label',
      });
    }

    // AES/EEI: at/over $2,500 per shipment, USPS international legally requires a
    // filed AES ITN, which the counter can't produce — the standard exemption
    // legend we send is only valid below the threshold. Block with a clear
    // message so staff route it via UPS/FedEx (or file AES) instead of minting a
    // non-compliant label.
    if (totalCustomsValue(customs) >= EEI_FILING_THRESHOLD_USD) {
      return await logAndRespond({
        route: ROUTE,
        carrier: 'usps',
        status: 422,
        message: `USPS international requires an AES/EEI filing for shipments of $${EEI_FILING_THRESHOLD_USD.toLocaleString()} or more. Use UPS or FedEx for this shipment, or file AES and enter the ITN.`,
      });
    }

    const country = String(shipment.destCountry || '').toUpperCase();
    requestSummary = {
      mailClass: serviceCode,
      originZip: shipment.originZip,
      destCountry: country,
      destZip: shipment.destZip,
      weight: shipment.weightLbs,
      items: customs.commodities.length,
    };

    const token = await getUspsToken('labels');

    // ── 1. Payment authorization (EPS), identical to the domestic label route ──
    const effectiveCrid = process.env.USPS_CRID;
    const effectiveMid = process.env.USPS_MID;
    const effectiveManifestMid = process.env.USPS_MANIFEST_MID ?? effectiveMid;
    const effectiveAccountNumber = process.env.USPS_EPS_ACCOUNT_NUMBER;
    const effectiveAccountType = process.env.USPS_ACCOUNT_TYPE ?? 'EPS';
    const pcPostageFlow = !effectiveAccountNumber || process.env.USPS_PC_POSTAGE === 'true';

    const payAuthRoles: object[] = [
      { roleName: 'LABEL_OWNER', CRID: effectiveCrid, MID: effectiveMid, manifestMID: effectiveManifestMid },
    ];
    if (!pcPostageFlow) {
      payAuthRoles.push({ roleName: 'PAYER', CRID: effectiveCrid, accountType: effectiveAccountType, accountNumber: effectiveAccountNumber });
    }
    // Never log this payload — it carries the EPS account number.
    const payAuthRes = await fetch(`${BASE}/payments/v3/payment-authorization`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ roles: payAuthRoles }),
    });
    if (!payAuthRes.ok) {
      const body = await payAuthRes.text();
      return await logAndRespond({
        route: ROUTE,
        carrier: 'usps',
        status: payAuthRes.status,
        message: `USPS payment auth error (${payAuthRes.status}) — ${body}`,
        upstreamStatus: payAuthRes.status,
        upstreamBody: body,
        requestSummary,
      });
    }
    const paymentToken: string = (await payAuthRes.json()).paymentAuthorizationToken;

    // ── 2. International label request ─────────────────────────────────────────
    const to = splitName(shipment.customerName, 'Customer');
    const from = splitName(shipment.senderName || SITE.name, SITE.name);
    const originZip = String(shipment.originZip || SITE.address.postalCode).replace(/\D/g, '').slice(0, 5);

    const payload = {
      imageInfo: { imageType: 'PDF', labelType: '4X6LABEL' },
      toAddress: {
        firstName: to.firstName,
        lastName: to.lastName,
        ...(shipment.destAttention?.trim() ? { firm: `ATTN: ${shipment.destAttention.trim()}`.slice(0, 50) } : {}),
        streetAddress: shipment.destStreet || '',
        ...(shipment.destStreet2?.trim() ? { secondaryAddress: shipment.destStreet2.trim() } : {}),
        city: shipment.destCity || '',
        ...(shipment.destState?.trim() ? { province: shipment.destState.trim() } : {}),
        // Foreign postal code is free-form (some countries have none).
        ...(shipment.destZip?.trim() ? { postalCode: shipment.destZip.trim() } : {}),
        // USPS requires BOTH the country name and the ISO-2 code (verified in sandbox).
        country: COUNTRY_NAMES[country] ?? country,
        countryISOAlpha2Code: country,
        ...(shipment.customerPhone ? { phone: String(shipment.customerPhone).replace(/\D/g, '') } : {}),
      },
      fromAddress: {
        firstName: from.firstName,
        lastName: from.lastName,
        streetAddress: SITE.address.street,
        city: SITE.address.city,
        state: SITE.address.region,
        ZIPCode: originZip,
        ...(shipment.senderPhone ? { phone: String(shipment.senderPhone).replace(/\D/g, '') } : {}),
      },
      packageDescription: {
        weight: Number(shipment.weightLbs) || 0,
        weightUOM: 'lb',
        length: Number(shipment.lengthIn) || 1,
        width: Number(shipment.widthIn) || 1,
        height: Number(shipment.heightIn) || 1,
        dimensionsUOM: 'in',
        mailClass: String(serviceCode),
        rateIndicator: 'SP',
        processingCategory: 'MACHINABLE',
        destinationEntryFacilityType: 'NONE',
        priceType: 'COMMERCIAL',
        mailingDate: nextPickupDateStamp(),
      },
      // USPS integrates the customs declaration into the label.
      customsForm: uspsInternationalCustoms(customs),
    };

    const labelRes = await fetch(`${BASE}/international-labels/v3/international-label`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Payment-Authorization-Token': paymentToken,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!labelRes.ok) {
      const body = await labelRes.text();
      return await logAndRespond({
        route: ROUTE,
        carrier: 'usps',
        status: labelRes.status,
        message: `USPS international label error (${labelRes.status})`,
        upstreamStatus: labelRes.status,
        upstreamBody: body,
        requestSummary,
      });
    }

    // The International Labels API returns MULTIPART form-data (verified in
    // sandbox): a `labelMetadata` JSON part (tracking + postage) and a
    // `labelImage` part carrying the label PDF as base64. Parse both; fall back
    // to JSON in case a future/config variant returns a single JSON body.
    const contentType = labelRes.headers.get('content-type') ?? '';
    let meta: Record<string, unknown> = {};
    let labelBase64: string | null = null;

    if (contentType.toLowerCase().includes('multipart')) {
      const boundary = contentType.split(/boundary=/i)[1]?.split(';')[0]?.trim().replace(/^"|"$/g, '') ?? '';
      const raw = await labelRes.text();
      for (const part of parseMultipart(raw, boundary)) {
        if (part.name === 'labelMetadata' || part.contentType.includes('json')) {
          try { meta = JSON.parse(part.body); } catch { /* leave meta empty */ }
        } else if (part.name === 'labelImage' || part.contentType.includes('pdf') || part.contentType.includes('image')) {
          labelBase64 = part.body.replace(/\s+/g, '') || null;
        }
      }
    } else {
      try {
        meta = await labelRes.json();
        labelBase64 = (meta.labelImage as string) ?? (meta.labelBase64 as string) ?? null;
      } catch { /* leave defaults */ }
    }

    const trackingNumber: string = String(
      meta.internationalTrackingNumber ?? meta.trackingNumber ?? meta.barcode ?? 'PENDING'
    );
    const rawCost = meta.postage ?? meta.totalPrice ?? null;
    const carrierCostUSD =
      rawCost != null && Number.isFinite(parseFloat(String(rawCost))) ? parseFloat(String(rawCost)) : null;

    const documents: IntlDocument[] = [];
    if (labelBase64) documents.push({ type: 'LABEL', base64: labelBase64, mimeType: 'application/pdf' });

    return NextResponse.json({
      trackingNumber,
      labelBase64,
      labelMimeType: labelBase64 ? 'application/pdf' : null,
      documents,
      carrierCostUSD,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return await logAndRespond({ route: ROUTE, carrier: 'usps', status: 500, message, requestSummary, err });
  }
}
