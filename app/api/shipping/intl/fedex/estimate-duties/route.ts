import { NextRequest, NextResponse } from 'next/server';
import { logAndRespond } from '@/lib/apiErrors';
import { getFedexToken } from '@/lib/carrierTokens';
import { normalizePostal } from '@/lib/postal';
import { fedexCustomsClearanceDetail, fedexTotalCustomsValue } from '@/lib/shippingIntl';
import type { IntlShipmentInput } from '@/app/admin/types/shippingIntl';

// FedEx Estimated Duties & Taxes (EDT). Used when the shipper prepays duties
// (DDP) to pre-fill the "duties to collect" amount. FedEx-only — UPS has no
// free duty estimate. Best-effort: returns { estimatedDutiesUSD: null } when
// EDT data isn't available for the lane.
export const runtime = 'nodejs';

const ROUTE = 'shipping/intl/fedex/estimate-duties';

const BASE = process.env.FEDEX_SANDBOX === 'false'
  ? 'https://apis.fedex.com'
  : 'https://apis-sandbox.fedex.com';

// EDT (Estimated Duties & Taxes) must be enabled on the FedEx account. Until
// then the API returns the fields as 0.0. Gate the estimate behind a flag so
// staff use manual entry (no misleading $0 estimate) until EDT is live.
const EDT_ENABLED = process.env.FEDEX_EDT_ENABLED === 'true';

/** Extract the EDT duties+taxes total for a service. The amount lives on each
 *  `ratedShipmentDetails[]` entry (totalDutiesAndTaxes / totalDutiesTaxesAndFees).
 *  Returns null when absent or zero (no usable estimate). */
function extractDuties(detail: Record<string, unknown>): number | null {
  const amt = (o: unknown): number | null => {
    const v = (o as Record<string, unknown> | undefined)?.amount;
    return v == null ? null : Number(v);
  };
  const rsdList = (detail?.ratedShipmentDetails as Record<string, unknown>[]) ?? [];
  for (const rsd of rsdList) {
    const val = amt(rsd?.totalDutiesAndTaxes) ?? amt(rsd?.totalDutiesTaxesAndFees);
    if (val != null && !Number.isNaN(val) && val > 0) return val;
  }
  return null;
}

export async function POST(req: NextRequest) {
  let requestSummary: Record<string, unknown> | undefined;
  try {
    if (!process.env.FEDEX_CLIENT_ID || !process.env.FEDEX_CLIENT_SECRET) {
      return await logAndRespond({ route: ROUTE, carrier: 'fedex', status: 503, message: 'FedEx credentials not configured' });
    }

    // EDT not enabled on the account → tell the client to use manual entry.
    if (!EDT_ENABLED) {
      return NextResponse.json({ estimatedDutiesUSD: null, currency: 'USD', enabled: false });
    }

    const { shipment, serviceCode } = await req.json() as { shipment: IntlShipmentInput; serviceCode?: string };
    const customs = shipment?.customs;
    if (!customs || !customs.commodities?.length) {
      return await logAndRespond({ route: ROUTE, carrier: 'fedex', status: 400, message: 'Customs commodities required for a duty estimate' });
    }
    requestSummary = { destCountry: shipment?.destCountry, serviceCode, commodities: customs.commodities.length };

    const token = await getFedexToken();
    const today = new Date().toISOString().split('T')[0];

    const payload = {
      accountNumber: { value: process.env.FEDEX_ACCOUNT_NUMBER ?? '' },
      requestedShipment: {
        shipper: { address: { postalCode: String(shipment.originZip || '50588'), countryCode: 'US' } },
        recipient: {
          address: {
            postalCode: normalizePostal(shipment.destZip, shipment.destCountry),
            countryCode: String(shipment.destCountry || 'US'),
            ...(shipment.residential ? { residential: true } : {}),
          },
        },
        pickupType: 'USE_SCHEDULED_PICKUP',
        shipDateStamp: today,
        rateRequestType: ['ACCOUNT'],
        // Request estimated duties & taxes.
        edtRequestType: 'ALL',
        customsClearanceDetail: fedexCustomsClearanceDetail(customs, process.env.FEDEX_ACCOUNT_NUMBER, { forRating: true }),
        totalCustomsValue: fedexTotalCustomsValue(customs),
        requestedPackageLineItems: [
          {
            weight: { units: 'LB', value: Number(shipment.weightLbs) },
            dimensions: { length: Number(shipment.lengthIn), width: Number(shipment.widthIn), height: Number(shipment.heightIn), units: 'IN' },
          },
        ],
      },
    };

    const rateRes = await fetch(`${BASE}/rate/v1/rates/quotes`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'x-customer-transaction-id': `slpack-edt-${Date.now()}`,
        'x-locale': 'en_US',
      },
      body: JSON.stringify(payload),
    });

    if (!rateRes.ok) {
      const body = await rateRes.text();
      return await logAndRespond({
        route: ROUTE, carrier: 'fedex', status: rateRes.status,
        message: `FedEx EDT error (${rateRes.status})`, upstreamStatus: rateRes.status, upstreamBody: body, requestSummary,
      });
    }

    const data = await rateRes.json();
    const details: Record<string, unknown>[] = data?.output?.rateReplyDetails ?? [];
    // Prefer the selected service; otherwise the first with duty data.
    const chosen =
      details.find((d) => String(d.serviceType) === String(serviceCode) && extractDuties(d) != null) ??
      details.find((d) => extractDuties(d) != null) ??
      details.find((d) => String(d.serviceType) === String(serviceCode)) ??
      details[0];

    const estimatedDutiesUSD = chosen ? extractDuties(chosen) : null;
    return NextResponse.json({
      estimatedDutiesUSD: estimatedDutiesUSD != null ? Number(estimatedDutiesUSD.toFixed(2)) : null,
      currency: 'USD',
      enabled: true,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return await logAndRespond({ route: ROUTE, carrier: 'fedex', status: 500, message, requestSummary, err });
  }
}
