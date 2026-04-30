import { NextRequest, NextResponse } from 'next/server';
import { getUspsToken, BASE } from '@/lib/uspsToken';

// USPS Prices v3 does not accept 'ALL' — query each class individually.
// Note: the API enum uses FIRST-CLASS_PACKAGE_SERVICE (hyphen, not underscore).
const MAIL_CLASSES: { code: string; name: string }[] = [
  { code: 'PRIORITY_MAIL_EXPRESS',        name: 'Priority Mail Express' },
  { code: 'PRIORITY_MAIL',                name: 'Priority Mail' },
  { code: 'FIRST-CLASS_PACKAGE_SERVICE',  name: 'First-Class Package Service' },
  { code: 'USPS_GROUND_ADVANTAGE',        name: 'USPS Ground Advantage' },
  { code: 'PARCEL_SELECT',                name: 'Parcel Select Ground' },
  { code: 'PARCEL_SELECT_LIGHTWEIGHT',    name: 'Parcel Select Lightweight' },
  { code: 'MEDIA_MAIL',                   name: 'Media Mail' },
  { code: 'LIBRARY_MAIL',                 name: 'Library Mail' },
  { code: 'BOUND_PRINTED_MATTER',         name: 'Bound Printed Matter' },
];

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

    const basePayload = {
      originZIPCode: String(originZip),
      destinationZIPCode: String(destZip),
      weight: Number(weightLbs),
      length: Number(lengthIn),
      width: Number(widthIn),
      height: Number(heightIn),
      girth: 0,
      processingCategory: 'MACHINABLE',
      destinationEntryFacilityType: 'NONE',
      rateIndicator: 'SP',
      priceType: 'RETAIL',
    };

    // Query each mail class in parallel; skip classes that return an error.
    const results = await Promise.allSettled(
      MAIL_CLASSES.map(({ code, name }) =>
        fetch(`${BASE}/prices/v3/base-rates/search`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ ...basePayload, mailClass: code }),
        }).then(async (res) => {
          if (!res.ok) return null; // service unavailable for this class/weight combo
          const data = await res.json();
          const pricePoints: Record<string, unknown>[] = data?.pricePoints ?? [];
          // Take the lowest retail price for this mail class.
          if (pricePoints.length === 0) return null;
          const best = pricePoints.reduce((a, b) =>
            parseFloat(String(a.price ?? '9999')) <= parseFloat(String(b.price ?? '9999')) ? a : b
          );
          return {
            serviceCode: code,
            serviceName: name,
            totalChargeUSD: parseFloat(String(best.price ?? '0')),
            estimatedDays: best.commitmentDays ? parseInt(String(best.commitmentDays)) : null,
            deliveryDate: best.commitmentDate ? String(best.commitmentDate) : null,
          };
        })
      )
    );

    type RateEntry = {
      serviceCode: string; serviceName: string; totalChargeUSD: number;
      estimatedDays: number | null; deliveryDate: string | null;
    };
    const rates = results
      .filter((r): r is PromiseFulfilledResult<RateEntry> =>
        r.status === 'fulfilled' && r.value !== null
      )
      .map((r) => r.value);

    return NextResponse.json({ rates });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
