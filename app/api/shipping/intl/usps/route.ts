import { NextRequest, NextResponse } from 'next/server';
import { serverBuildId } from '@/lib/appVersion';
import { getUspsToken, BASE } from '@/lib/uspsToken';
import { logAndRespond } from '@/lib/apiErrors';
import { SITE } from '@/lib/siteConfig';
import { nextPickupDateStamp } from '@/lib/localDate';

/**
 * USPS INTERNATIONAL rate quote (2026-09-10) — the third intl carrier alongside
 * UPS and FedEx.
 *
 * Deliberately isolated, mirroring app/api/shipping/intl/{ups,fedex}/route.ts and
 * the domestic app/api/shipping/usps/route.ts. Reuses the same USPS OAuth
 * (getUspsToken / BASE from lib/uspsToken) — no new credentials.
 *
 * International uses the "International Prices" API, which (unlike domestic
 * base-rates/search) is base-rates-LIST/search and is keyed by
 * destinationCountryCode + foreignPostalCode. Like domestic, mailClass is
 * REQUIRED per call (the schema says optional but the API 400s without it — see
 * usps_intl_notes.md), so we fan out one call per service.
 *
 * Returns the shared ShippingRate shape so USPS flows through the same retail
 * pricing the intl UPS/FedEx panels use. USPS publishes no negotiated/list split,
 * so there is no rateSource/listPriceUSD — totalChargeUSD is the COMMERCIAL
 * (account) price, i.e. our cost basis.
 *
 * v1 offers FCPIS / PMI / PMEI (Global Express Guaranteed is intentionally
 * excluded — it is FedEx-carried and heavily restricted).
 */
const ROUTE = 'shipping/intl/usps';

interface IntlMailClass {
  code: string;
  name: string;
  /** Hard weight ceiling in pounds for this class. */
  maxWeightLbs: number;
}

// Ordered cheapest-tier first. FCPIS is light-parcel only (~4 lb / 64 oz).
const MAIL_CLASSES: IntlMailClass[] = [
  { code: 'FIRST-CLASS_PACKAGE_INTERNATIONAL_SERVICE', name: 'First-Class Package International', maxWeightLbs: 4 },
  { code: 'PRIORITY_MAIL_INTERNATIONAL', name: 'Priority Mail International', maxWeightLbs: 70 },
  { code: 'PRIORITY_MAIL_EXPRESS_INTERNATIONAL', name: 'Priority Mail Express International', maxWeightLbs: 70 },
];

export async function POST(req: NextRequest) {
  let requestSummary: Record<string, unknown> | undefined;
  try {
    if (!process.env.USPS_CLIENT_ID || !process.env.USPS_CLIENT_SECRET) {
      return await logAndRespond({
        route: ROUTE,
        carrier: 'usps',
        status: 503,
        message: 'USPS credentials not configured (USPS_CLIENT_ID / USPS_CLIENT_SECRET)',
      });
    }

    const { originZip, destZip, destCountry, weightLbs, lengthIn, widthIn, heightIn } = await req.json();
    requestSummary = { originZip, destZip, destCountry, weightLbs, lengthIn, widthIn, heightIn };

    // This is the INTERNATIONAL route — a US destination isn't ours to quote.
    const country = String(destCountry || '').toUpperCase();
    if (!country || country === 'US') {
      return NextResponse.json({ rates: [] });
    }
    if (!weightLbs) {
      return await logAndRespond({
        route: ROUTE,
        carrier: 'usps',
        status: 400,
        message: 'Missing required field: weightLbs',
        requestSummary,
      });
    }

    const w = Number(weightLbs);
    const l = Number(lengthIn) || 1;
    const wd = Number(widthIn) || 1;
    const h = Number(heightIn) || 1;

    // USPS caps international parcels at 70 lb; reject before any API call.
    if (w > 70) {
      return await logAndRespond({
        route: ROUTE,
        carrier: 'usps',
        status: 422,
        message: `Package weight (${w} lb) exceeds the USPS international maximum of 70 lb.`,
        requestSummary,
      });
    }

    const eligible = MAIL_CLASSES.filter(({ maxWeightLbs }) => w <= maxWeightLbs);
    if (eligible.length === 0) {
      return NextResponse.json({ rates: [] });
    }

    const token = await getUspsToken();

    const basePayload = {
      originZIPCode: String(originZip || SITE.address.postalCode),
      foreignPostalCode: String(destZip || ''),
      destinationCountryCode: country, // ISO alpha-2 (e.g. MX)
      weight: w,
      length: l,
      width: wd,
      height: h,
      mailingDate: nextPickupDateStamp(), // YYYY-MM-DD, store-local ship day
      // COMMERCIAL = our account cost (mirrors the domestic route).
      priceType: 'COMMERCIAL',
    };

    const results = await Promise.allSettled(
      eligible.map(({ code, name }) =>
        fetch(`${BASE}/international-prices/v3/base-rates-list/search`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ ...basePayload, mailClass: code }),
        }).then(async (res) => {
          const body = await res.text();
          if (!res.ok) {
            // 400 with 030002 = no SKU for this weight/class/lane — expected, not an error.
            if (body.includes('030002')) {
              console.warn(`USPS intl ${code} -> no rate available (030002)`);
            } else {
              console.error(`USPS intl ${code} -> ${res.status}: ${body.slice(0, 500)}`);
            }
            return null;
          }
          let data: Record<string, unknown>;
          try {
            data = JSON.parse(body);
          } catch {
            return null;
          }
          // base-rates-LIST returns a collection; accept the shapes USPS uses.
          const pricePoints =
            (data?.rates as Record<string, unknown>[] | undefined) ??
            (data?.pricePoints as Record<string, unknown>[] | undefined) ??
            (data?.rateOptions as Record<string, unknown>[] | undefined) ??
            [];
          if (!Array.isArray(pricePoints) || pricePoints.length === 0) {
            console.warn(`USPS intl ${code} -> 200 OK but no price points. Keys: ${Object.keys(data).join(', ')}`);
            return null;
          }
          const priceOf = (p: Record<string, unknown>): number =>
            parseFloat(String(p.price ?? p.totalBasePrice ?? p.totalPrice ?? '9999'));
          const best = pricePoints.reduce((a, b) => (priceOf(a) <= priceOf(b) ? a : b));
          const price = priceOf(best);
          if (!(price > 0) || price >= 9999) return null;
          return {
            serviceCode: code,
            serviceName: name,
            totalChargeUSD: price,
            estimatedDays: best.commitmentDays ? parseInt(String(best.commitmentDays)) || null : null,
            deliveryDate: best.commitmentDate ? String(best.commitmentDate) : null,
          };
        })
      )
    );

    type RateEntry = {
      serviceCode: string;
      serviceName: string;
      totalChargeUSD: number;
      estimatedDays: number | null;
      deliveryDate: string | null;
    };
    const rates = results
      .filter((r): r is PromiseFulfilledResult<RateEntry> => r.status === 'fulfilled' && r.value !== null)
      .map((r) => r.value);

    return NextResponse.json({ rates, buildId: serverBuildId() });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return await logAndRespond({
      route: ROUTE,
      carrier: 'usps',
      status: 500,
      message,
      requestSummary,
      err,
    });
  }
}
