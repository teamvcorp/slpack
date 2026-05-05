import { NextRequest, NextResponse } from 'next/server';
import { getUspsToken, BASE } from '@/lib/uspsToken';

// USPS Prices v3 does not accept 'ALL' — query each class individually.
// Note: the API enum uses FIRST-CLASS_PACKAGE_SERVICE (hyphen, not underscore).
// processingCategory valid values: LETTERS, FLATS, MACHINABLE, IRREGULAR, NON_MACHINABLE, NONSTANDARD
// All parcel/package mail classes use MACHINABLE.
//
// Per faq.usps.com/s/article/Parcel-Size-Weight-Fee-Standards (updated Mar 2026):
//   • Length = longest dimension. Girth = 2×(H+W) for rectangular packages.
//   • Universal max: 70 lb weight, 130" length+girth (>130" = non-mailable, $200 fee).
//   • Standard parcel classes cap at 108" combined (PME, PM, FCPS, Media, Library, BPM, PSL).
//   • USPS Ground Advantage & Parcel Select allow up to 130"; parcels 108–130" incur an
//     oversized surcharge but are still accepted.
//   • First-Class Package Service: max 13 oz (0.8125 lb).
//   • Parcel Select Lightweight: max 1 lb.
//   • Bound Printed Matter: max 15 lb.
interface MailClass {
  code: string;
  name: string;
  processingCategory: string;
  /** Hard weight ceiling for this mail class in pounds */
  maxWeightLbs: number;
  /** Hard combined length+girth ceiling in inches */
  maxLengthPlusGirth: number;
}

const MAIL_CLASSES: MailClass[] = [
  { code: 'PRIORITY_MAIL_EXPRESS',       name: 'Priority Mail Express',       processingCategory: 'MACHINABLE', maxWeightLbs: 70,     maxLengthPlusGirth: 108 },
  { code: 'PRIORITY_MAIL',               name: 'Priority Mail',               processingCategory: 'MACHINABLE', maxWeightLbs: 70,     maxLengthPlusGirth: 108 },
  { code: 'FIRST-CLASS_PACKAGE_SERVICE', name: 'First-Class Package Service', processingCategory: 'MACHINABLE', maxWeightLbs: 0.8125, maxLengthPlusGirth: 108 }, // 13 oz max
  { code: 'USPS_GROUND_ADVANTAGE',       name: 'USPS Ground Advantage',       processingCategory: 'MACHINABLE', maxWeightLbs: 70,     maxLengthPlusGirth: 130 }, // oversized 108–130"
  { code: 'PARCEL_SELECT',               name: 'Parcel Select Ground',        processingCategory: 'MACHINABLE', maxWeightLbs: 70,     maxLengthPlusGirth: 130 }, // oversized 108–130"
  { code: 'PARCEL_SELECT_LIGHTWEIGHT',   name: 'Parcel Select Lightweight',   processingCategory: 'MACHINABLE', maxWeightLbs: 1,      maxLengthPlusGirth: 108 }, // 1 lb max
  { code: 'MEDIA_MAIL',                  name: 'Media Mail',                  processingCategory: 'MACHINABLE', maxWeightLbs: 70,     maxLengthPlusGirth: 108 },
  { code: 'LIBRARY_MAIL',               name: 'Library Mail',                 processingCategory: 'MACHINABLE', maxWeightLbs: 70,     maxLengthPlusGirth: 108 },
  { code: 'BOUND_PRINTED_MATTER',        name: 'Bound Printed Matter',        processingCategory: 'MACHINABLE', maxWeightLbs: 15,     maxLengthPlusGirth: 108 }, // 15 lb max
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

    const w = Number(weightLbs);
    const l = Number(lengthIn) || 1;
    const wd = Number(widthIn) || 1;
    const h = Number(heightIn) || 1;

    // USPS: length = longest dimension; girth = 2×(H+W) for rectangular packages.
    const [length, side1, side2] = [l, wd, h].sort((a, b) => b - a);
    const girth = 2 * (side1 + side2);
    const lengthPlusGirth = length + girth;

    // Hard non-mailable limits — reject before any API call.
    if (w > 70) {
      return NextResponse.json(
        { error: `Package weight (${w} lb) exceeds the USPS maximum of 70 lb and cannot be shipped.` },
        { status: 422 }
      );
    }
    if (lengthPlusGirth > 130) {
      return NextResponse.json(
        { error: `Package combined length + girth (${lengthPlusGirth.toFixed(1)}") exceeds the USPS maximum of 130" and cannot be shipped.` },
        { status: 422 }
      );
    }

    // Pre-filter to only the classes this package qualifies for.
    const eligibleClasses = MAIL_CLASSES.filter(
      ({ maxWeightLbs, maxLengthPlusGirth }) =>
        w <= maxWeightLbs && lengthPlusGirth <= maxLengthPlusGirth
    );

    if (eligibleClasses.length === 0) {
      return NextResponse.json({ rates: [] });
    }

    // Oversized applies when length+girth is 108–130" (Ground Advantage / Parcel Select only).
    const isOversized = lengthPlusGirth > 108;

    const token = await getUspsToken();

    const basePayload = {
      originZIPCode: String(originZip),
      destinationZIPCode: String(destZip),
      weight: w,
      length,
      width: side2,
      height: side1,
      girth: 0,
      destinationEntryFacilityType: 'NONE',
      rateIndicator: 'SP',
      priceType: 'RETAIL',
    };

    // Query each eligible mail class in parallel; collect errors for diagnostics.
    const results = await Promise.allSettled(
      eligibleClasses.map(({ code, name, processingCategory }) =>
        fetch(`${BASE}/prices/v3/base-rates/search`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ ...basePayload, mailClass: code, processingCategory }),
        }).then(async (res) => {
          const body = await res.text();
          if (!res.ok) {
            // 400 with code 030002 = no SKU for this weight/class combo — expected, not an error
            if (body.includes('030002')) {
              console.warn(`USPS ${code} -> no rate available (030002)`);
            } else {
              console.error(`USPS ${code} -> ${res.status}: ${body}`);
            }
            return null;
          }
          let data: Record<string, unknown>;
          try { data = JSON.parse(body); } catch { return null; }
          // Log first successful response to verify structure
          if (code === 'PRIORITY_MAIL' || code === 'USPS_GROUND_ADVANTAGE') {
            console.log(`USPS ${code} response keys:`, Object.keys(data), '| sample:', body.substring(0, 300));
          }
          const pricePoints: Record<string, unknown>[] =
            (data?.pricePoints as Record<string, unknown>[] | undefined) ??
            (data?.rates as Record<string, unknown>[] | undefined) ??
            [];
          if (pricePoints.length === 0) {
            console.warn(`USPS ${code} -> 200 OK but no pricePoints. Keys: ${Object.keys(data).join(', ')}`);
            return null;
          }
          const best = pricePoints.reduce((a, b) =>
            parseFloat(String(a.price ?? a.totalBasePrice ?? '9999')) <=
            parseFloat(String(b.price ?? b.totalBasePrice ?? '9999')) ? a : b
          );
          const price = parseFloat(String(best.price ?? best.totalBasePrice ?? '0'));
          return {
            serviceCode: code,
            serviceName: name,
            totalChargeUSD: price,
            estimatedDays: best.commitmentDays ? parseInt(String(best.commitmentDays)) : null,
            deliveryDate: best.commitmentDate ? String(best.commitmentDate) : null,
            oversized: isOversized && (code === 'USPS_GROUND_ADVANTAGE' || code === 'PARCEL_SELECT'),
          };
        })
      )
    );

    type RateEntry = {
      serviceCode: string; serviceName: string; totalChargeUSD: number;
      estimatedDays: number | null; deliveryDate: string | null;
      oversized: boolean;
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
