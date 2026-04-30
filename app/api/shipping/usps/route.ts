import { NextRequest, NextResponse } from 'next/server';
import { getUspsToken, BASE } from '@/lib/uspsToken';

// USPS Prices v3 does not accept 'ALL' — query each class individually.
// Note: the API enum uses FIRST-CLASS_PACKAGE_SERVICE (hyphen, not underscore).
// processingCategory must match each class — Express/PM/Media/Library/BPM use NON_PRESORTED.
const MAIL_CLASSES: { code: string; name: string; processingCategory: string }[] = [
  { code: 'PRIORITY_MAIL_EXPRESS',        name: 'Priority Mail Express',         processingCategory: 'NON_PRESORTED' },
  { code: 'PRIORITY_MAIL',                name: 'Priority Mail',                 processingCategory: 'NON_PRESORTED' },
  { code: 'FIRST-CLASS_PACKAGE_SERVICE',  name: 'First-Class Package Service',   processingCategory: 'MACHINABLE' },
  { code: 'USPS_GROUND_ADVANTAGE',        name: 'USPS Ground Advantage',         processingCategory: 'MACHINABLE' },
  { code: 'PARCEL_SELECT',                name: 'Parcel Select Ground',          processingCategory: 'MACHINABLE' },
  { code: 'PARCEL_SELECT_LIGHTWEIGHT',    name: 'Parcel Select Lightweight',     processingCategory: 'MACHINABLE' },
  { code: 'MEDIA_MAIL',                   name: 'Media Mail',                    processingCategory: 'NON_PRESORTED' },
  { code: 'LIBRARY_MAIL',                 name: 'Library Mail',                  processingCategory: 'NON_PRESORTED' },
  { code: 'BOUND_PRINTED_MATTER',         name: 'Bound Printed Matter',          processingCategory: 'NON_PRESORTED' },
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

    if (!originZip || !destZip || !weightLbs) {
      return NextResponse.json(
        { error: 'Missing required fields: originZip, destZip, weightLbs' },
        { status: 400 }
      );
    }

    const token = await getUspsToken();

    const basePayload = {
      originZIPCode: String(originZip),
      destinationZIPCode: String(destZip),
      weight: Number(weightLbs),
      length: Number(lengthIn),
      width: Number(widthIn),
      height: Number(heightIn),
      girth: 0,
      destinationEntryFacilityType: 'NONE',
      rateIndicator: 'SP',
      priceType: 'RETAIL',
    };

    // Query each mail class in parallel; collect errors for diagnostics.
    const results = await Promise.allSettled(
      MAIL_CLASSES.map(({ code, name, processingCategory }) =>
        fetch(`${BASE}/prices/v3/base-rates/search`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ ...basePayload, mailClass: code, processingCategory }),
        }).then(async (res) => {
          if (!res.ok) {
            const body = await res.text();
            console.error(`USPS ${code} -> ${res.status}: ${body}`);
            return null;
          }
          const data = await res.json();
          const pricePoints: Record<string, unknown>[] = data?.pricePoints ?? [];
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
