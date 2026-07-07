import { NextRequest, NextResponse } from 'next/server';
import { logAndRespond } from '@/lib/apiErrors';
import { getFedexToken } from '@/lib/carrierTokens';
import { fedexTransitToDays, formatDeliveryDate } from '@/lib/transit';
import { normalizePostal } from '@/lib/postal';
import { fedexCustomsClearanceDetail, fedexTotalCustomsValue } from '@/lib/shippingIntl';
import type { CustomsInfo } from '@/app/admin/types/shippingIntl';

// International FedEx rate quote. Separate from the domestic route so a change
// here can never affect domestic rating.
const ROUTE = 'shipping/intl/fedex';

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
      declaredValueUSD,
      customs,
    } = await req.json() as {
      originZip: string; destZip: string; destCountry: string; residential?: boolean;
      weightLbs: number; lengthIn: number; widthIn: number; heightIn: number;
      declaredValueUSD?: number;
      customs?: CustomsInfo;
    };
    requestSummary = { originZip, destZip, destCountry, residential: Boolean(residential), weightLbs, lengthIn, widthIn, heightIn };

    const token = await getFedexToken();
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

    // FedEx REQUIRES customsClearanceDetail for international rating. The customs
    // step happens after rate selection, so synthesize a minimal declaration
    // from the declared value when full commodities aren't entered yet — the
    // real commodities are sent on the label.
    const effectiveCustoms: CustomsInfo =
      customs && customs.commodities?.length
        ? customs
        : {
            commodities: [
              {
                description: 'Merchandise',
                hsCode: '',
                quantity: 1,
                unitValueUSD: Number(declaredValueUSD) > 0 ? Number(declaredValueUSD) : 1,
                countryOfManufacture: 'US',
                weightLbs: Number(weightLbs) || 1,
              },
            ],
            reasonForExport: 'SALE',
            incoterm: 'DAP',
            dutiesPayer: 'recipient',
            currency: 'USD',
          };
    const customsBlock = {
      customsClearanceDetail: fedexCustomsClearanceDetail(effectiveCustoms, process.env.FEDEX_ACCOUNT_NUMBER, { forRating: true }),
      totalCustomsValue: fedexTotalCustomsValue(effectiveCustoms),
    };

    const payload = {
      accountNumber: { value: process.env.FEDEX_ACCOUNT_NUMBER ?? '' },
      rateRequestControlParameters: { returnTransitTimes: true },
      requestedShipment: {
        shipper: { address: { postalCode: String(originZip), countryCode: 'US' } },
        recipient: {
          address: {
            postalCode: normalizePostal(destZip, destCountry),
            countryCode: String(destCountry || 'US'),
            ...(residential ? { residential: true } : {}),
          },
        },
        pickupType: 'USE_SCHEDULED_PICKUP',
        shipDateStamp: today,
        rateRequestType: ['ACCOUNT'],
        ...customsBlock,
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
        'x-customer-transaction-id': `slpack-intl-${Date.now()}`,
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
        message: `FedEx intl rate error (${rateRes.status})`,
        upstreamStatus: rateRes.status,
        upstreamBody: body,
        requestSummary,
      });
    }

    const data = await rateRes.json();
    const details: unknown[] = data?.output?.rateReplyDetails ?? [];

    const rates = (details as Record<string, unknown>[]).map((d) => {
      const detailsArr = (d.ratedShipmentDetails as Record<string, unknown>[]) ?? [];
      const shipDetail =
        detailsArr.find(
          (x) => x.rateType === 'ACCOUNT' || x.rateType === 'PAYOR_ACCOUNT_PACKAGE'
        ) ?? detailsArr[0];
      const netCharge =
        (shipDetail?.totalNetFedExCharge as string) ??
        (shipDetail?.totalNetCharge as string) ??
        '0';
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
