import { NextRequest, NextResponse } from 'next/server';
import { logAndRespond } from '@/lib/apiErrors';

const ROUTE = 'shipping/dhl';

const BASE = 'https://express.api.dhl.com/mydhlapi';

function daysUntil(dateString: string): number | null {
  try {
    const delivery = new Date(dateString);
    const now = new Date();
    const diff = Math.ceil((delivery.getTime() - now.getTime()) / 86_400_000);
    return diff > 0 ? diff : null;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  let requestSummary: Record<string, unknown> | undefined;
  try {
    if (!process.env.DHL_API_KEY || process.env.DHL_API_KEY === 'your_dhl_api_key' ||
        !process.env.DHL_API_SECRET || process.env.DHL_API_SECRET === 'your_dhl_api_secret') {
      return NextResponse.json({ rates: [] });
    }

    const {
      originZip, destZip, destCity, destCountry,
      weightLbs, lengthIn, widthIn, heightIn,
    } = await req.json();
    requestSummary = { originZip, destZip, destCountry, weightLbs, lengthIn, widthIn, heightIn };

    const credentials = Buffer.from(
      `${process.env.DHL_API_KEY}:${process.env.DHL_API_SECRET}`
    ).toString('base64');

    // DHL uses metric — convert from US customary
    const weightKg = (Number(weightLbs) * 0.453592).toFixed(3);
    const lengthCm = Math.ceil(Number(lengthIn) * 2.54);
    const widthCm = Math.ceil(Number(widthIn) * 2.54);
    const heightCm = Math.ceil(Number(heightIn) * 2.54);

    // Ship tomorrow (next business day)
    const shipDate = new Date();
    shipDate.setDate(shipDate.getDate() + 1);
    const plannedDate = shipDate.toISOString().split('T')[0];

    const isInternational = destCountry && destCountry !== 'US';

    const params = new URLSearchParams({
      accountNumber: process.env.DHL_ACCOUNT_NUMBER ?? '',
      originCountryCode: 'US',
      originPostalCode: String(originZip),
      destinationCountryCode: String(destCountry || 'US'),
      destinationPostalCode: String(destZip),
      destinationCityName: String(destCity || ''),
      weight: weightKg,
      length: String(lengthCm),
      width: String(widthCm),
      height: String(heightCm),
      plannedShippingDate: plannedDate,
      isCustomsDeclarable: isInternational ? 'true' : 'false',
      unitOfMeasurement: 'metric',
      nextBusinessDay: 'false',
    });

    const rateRes = await fetch(`${BASE}/rates?${params.toString()}`, {
      method: 'GET',
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/json',
      },
    });

    if (!rateRes.ok) {
      const body = await rateRes.text();
      return await logAndRespond({
        route: ROUTE,
        carrier: 'dhl',
        status: rateRes.status,
        message: `DHL rate error (${rateRes.status})`,
        upstreamStatus: rateRes.status,
        upstreamBody: body,
        requestSummary,
      });
    }

    const data = await rateRes.json();
    const products: Record<string, unknown>[] = data?.products ?? [];

    const rates = products.map((p) => {
      const prices = p.totalPrice as Record<string, unknown>[] | undefined;
      // Prefer the USD-denominated total (our billed cost) over the first entry,
      // which may be in a base or local currency.
      const priceEntry =
        (prices?.find((pr) => pr.priceCurrency === 'USD') ??
          prices?.[0]) as Record<string, unknown> | undefined;
      const deliveryTs = (
        p.deliveryCapabilities as Record<string, string> | undefined
      )?.estimatedDeliveryDateAndTime ?? null;

      return {
        serviceCode: String(p.productCode ?? ''),
        serviceName: String(p.productName ?? p.productCode ?? ''),
        totalChargeUSD: parseFloat(String(priceEntry?.price ?? '0')),
        estimatedDays: deliveryTs ? daysUntil(deliveryTs) : null,
        deliveryDate: deliveryTs,
      };
    });

    return NextResponse.json({ rates });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return await logAndRespond({
      route: ROUTE,
      carrier: 'dhl',
      status: 500,
      message,
      requestSummary,
      err,
    });
  }
}
