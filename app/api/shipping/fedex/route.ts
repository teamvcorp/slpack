import { NextRequest, NextResponse } from 'next/server';
import { logAndRespond } from '@/lib/apiErrors';
import { getFedexToken } from '@/lib/carrierTokens';
import { fedexTransitToDays, formatDeliveryDate } from '@/lib/transit';

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

    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

    const payload = {
      accountNumber: { value: process.env.FEDEX_ACCOUNT_NUMBER ?? '' },
      // Ask FedEx to return commit/transit-time details with the rates.
      rateRequestControlParameters: { returnTransitTimes: true },
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
        shipDateStamp: today, // lets FedEx compute committed delivery dates
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
      // FedEx returns transit time as an enum ("TWO_DAYS"), under either
      // commit.transitDays or commit.transitTime depending on the service.
      const commit = d.commit as Record<string, unknown> | undefined;
      const dateDetail = commit?.dateDetail as Record<string, string> | undefined;
      const estimatedDays =
        fedexTransitToDays(commit?.transitDays) ?? fedexTransitToDays(commit?.transitTime);
      const deliveryDate = formatDeliveryDate(
        dateDetail?.dayFormat ?? dateDetail?.dayCxsFormat
      );
      return {
        serviceCode: d.serviceType as string,
        serviceName: (d.serviceName as string) ?? (d.serviceType as string),
        totalChargeUSD: parseFloat(netCharge),
        estimatedDays,
        deliveryDate,
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
