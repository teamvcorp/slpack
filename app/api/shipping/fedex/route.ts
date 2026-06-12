import { NextRequest, NextResponse } from 'next/server';
import { logAndRespond } from '@/lib/apiErrors';
import { getFedexToken } from '@/lib/carrierTokens';

const ROUTE = 'shipping/fedex';

const BASE = process.env.FEDEX_SANDBOX === 'false'
  ? 'https://apis.fedex.com'
  : 'https://apis-sandbox.fedex.com';

export async function POST(req: NextRequest) {
  let requestSummary: Record<string, unknown> | undefined;
  try {
    if (!process.env.FEDEX_CLIENT_ID || !process.env.FEDEX_CLIENT_SECRET) {
      return await logAndRespond({
        route: ROUTE,
        carrier: 'fedex',
        status: 503,
        message: 'FedEx credentials not configured (FEDEX_CLIENT_ID / FEDEX_CLIENT_SECRET)',
      });
    }

    const {
      originZip, destZip, destCountry, residential,
      weightLbs, lengthIn, widthIn, heightIn,
    } = await req.json();
    requestSummary = { originZip, destZip, destCountry, residential: Boolean(residential), weightLbs, lengthIn, widthIn, heightIn };

    const token = await getFedexToken();

    const payload = {
      accountNumber: { value: process.env.FEDEX_ACCOUNT_NUMBER ?? '' },
      requestedShipment: {
        shipper: { address: { postalCode: String(originZip), countryCode: 'US' } },
        recipient: {
          address: {
            postalCode: String(destZip),
            countryCode: String(destCountry || 'US'),
            // Residential deliveries carry a surcharge; omit/false for commercial.
            ...(residential ? { residential: true } : {}),
          },
        },
        pickupType: 'USE_SCHEDULED_PICKUP',
        // ACCOUNT = our negotiated rate (actual cost). LIST would return the
        // higher published/retail price, not what we actually pay FedEx.
        rateRequestType: ['ACCOUNT'],
        requestedPackageLineItems: [
          {
            weight: { units: 'LB', value: Number(weightLbs) },
            dimensions: {
              length: Number(lengthIn),
              width: Number(widthIn),
              height: Number(heightIn),
              units: 'IN',
            },
          },
        ],
      },
    };

    const rateRes = await fetch(`${BASE}/rate/v1/rates/quotes`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'x-customer-transaction-id': `slpack-${Date.now()}`,
        'x-locale': 'en_US',
      },
      body: JSON.stringify(payload),
    });

    if (!rateRes.ok) {
      const body = await rateRes.text();
      return await logAndRespond({
        route: ROUTE,
        carrier: 'fedex',
        status: rateRes.status,
        message: `FedEx rate error (${rateRes.status})`,
        upstreamStatus: rateRes.status,
        upstreamBody: body,
        requestSummary,
      });
    }

    const data = await rateRes.json();
    const details: unknown[] = data?.output?.rateReplyDetails ?? [];

    const rates = (details as Record<string, unknown>[]).map((d) => {
      const detailsArr = (d.ratedShipmentDetails as Record<string, unknown>[]) ?? [];
      // Prefer the ACCOUNT (negotiated) rated detail; fall back to the first.
      const shipDetail =
        detailsArr.find(
          (x) => x.rateType === 'ACCOUNT' || x.rateType === 'PAYOR_ACCOUNT_PACKAGE'
        ) ?? detailsArr[0];
      const netCharge =
        (shipDetail?.totalNetFedExCharge as string) ??
        (shipDetail?.totalNetCharge as string) ??
        '0';
      const commit = d.commit as Record<string, unknown> | undefined;
      return {
        serviceCode: d.serviceType as string,
        serviceName: (d.serviceName as string) ?? (d.serviceType as string),
        totalChargeUSD: parseFloat(netCharge),
        estimatedDays: commit?.transitDays ? parseInt(commit.transitDays as string) : null,
        deliveryDate: (commit as Record<string, Record<string, string>> | undefined)
          ?.dateDetail?.dayFormat ?? null,
      };
    });

    return NextResponse.json({ rates });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return await logAndRespond({
      route: ROUTE,
      carrier: 'fedex',
      status: 500,
      message,
      requestSummary,
      err,
    });
  }
}
