import { NextRequest, NextResponse } from 'next/server';
import { getUspsToken, BASE } from '@/lib/uspsToken';

const MAIL_CLASS_NAMES: Record<string, string> = {
  PRIORITY_MAIL_EXPRESS: 'Priority Mail Express',
  PRIORITY_MAIL: 'Priority Mail',
  FIRST_CLASS_PACKAGE_SERVICES: 'First-Class Package',
  PARCEL_SELECT: 'Parcel Select Ground',
  PARCEL_SELECT_LIGHTWEIGHT: 'Parcel Select Lightweight',
  MEDIA_MAIL: 'Media Mail',
  LIBRARY_MAIL: 'Library Mail',
  BOUND_PRINTED_MATTER: 'Bound Printed Matter',
};

export async function POST(req: NextRequest) {
  try {
    if (!process.env.USPS_CLIENT_ID || !process.env.USPS_CLIENT_SECRET) {
      return NextResponse.json(
        { error: 'USPS credentials not configured (USPS_CLIENT_ID / USPS_CLIENT_SECRET)' },
        { status: 503 }
      );
    }

    const {
      originZip, destZip,
      weightLbs, lengthIn, widthIn, heightIn,
    } = await req.json();

    const token = await getUspsToken();

    const payload = {
      originZIPCode: String(originZip),
      destinationZIPCode: String(destZip),
      weight: Number(weightLbs),
      length: Number(lengthIn),
      width: Number(widthIn),
      height: Number(heightIn),
      girth: 0,
      mailClass: 'ALL',
      processingCategory: 'MACHINABLE',
      destinationEntryFacilityType: 'NONE',
      rateIndicator: 'SP',
      priceType: 'RETAIL',
    };

    const rateRes = await fetch(`${BASE}/prices/v3/base-rates/search`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!rateRes.ok) {
      const body = await rateRes.text();
      let detail = body;
      try {
        const parsed = JSON.parse(body);
        const msg =
          parsed?.apiError?.message ??
          parsed?.errors?.[0]?.message ??
          parsed?.message ??
          null;
        if (msg) detail = msg;
      } catch { /* keep raw body */ }
      return NextResponse.json(
        { error: `USPS rate error (${rateRes.status}): ${detail}` },
        { status: rateRes.status }
      );
    }

    const data = await rateRes.json();
    const pricePoints: Record<string, unknown>[] = data?.pricePoints ?? [];

    const rates = pricePoints.map((p) => {
      const mailClass = String(p.mailClass ?? '');
      return {
        serviceCode: mailClass,
        serviceName: MAIL_CLASS_NAMES[mailClass] ?? mailClass.replace(/_/g, ' '),
        totalChargeUSD: parseFloat(String(p.price ?? '0')),
        estimatedDays: p.commitmentDays ? parseInt(String(p.commitmentDays)) : null,
        deliveryDate: p.commitmentDate ? String(p.commitmentDate) : null,
      };
    });

    return NextResponse.json({ rates });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
