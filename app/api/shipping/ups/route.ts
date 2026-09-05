import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { appendError } from '@/lib/errorLog';
import { hit } from '@/lib/rateLimit';
import { serverBuildId } from '@/lib/appVersion';
import { logAndRespond } from '@/lib/apiErrors';
import { getUpsToken } from '@/lib/carrierTokens';
import { SITE } from '@/lib/siteConfig';
import { formatDeliveryDate, isSaturdayDate } from '@/lib/transit';
import { normalizePostal } from '@/lib/postal';
import { normalizeSignature, upsDeliveryConfirmation } from '@/lib/signatureOption';
import {
  simpleRateEligibility,
  isSimpleRateService,
  type SimpleRateTier,
} from '@/lib/upsSimpleRate';

const ROUTE = 'shipping/ups';

const ORIGIN_STATE = SITE.address.region;

const BASE = process.env.UPS_SANDBOX === 'false'
  ? 'https://onlinetools.ups.com'
  : 'https://wwwcie.ups.com';

const SERVICE_NAMES: Record<string, string> = {
  '01': 'UPS Next Day Air',
  '02': 'UPS 2nd Day Air',
  '03': 'UPS Ground',
  '07': 'UPS Worldwide Express',
  '08': 'UPS Worldwide Expedited',
  '11': 'UPS Standard',
  '12': 'UPS 3 Day Select',
  '13': 'UPS Next Day Air Saver',
  '14': 'UPS Next Day Air Early AM',
  '54': 'UPS Worldwide Express Plus',
  '59': 'UPS 2nd Day Air AM',
  '65': 'UPS Worldwide Saver',
};

export async function POST(req: NextRequest) {
  let requestSummary: Record<string, unknown> | undefined;
  try {
    if (!process.env.UPS_CLIENT_ID || !process.env.UPS_CLIENT_SECRET) {
      return await logAndRespond({
        route: ROUTE,
        carrier: 'ups',
        status: 503,
        message: 'UPS credentials not configured (UPS_CLIENT_ID / UPS_CLIENT_SECRET)',
      });
    }

    const {
      originZip, destZip, destCity, destState, destCountry, residential,
      weightLbs, lengthIn, widthIn, heightIn, signature,
    } = await req.json();
    // Signature carries a carrier surcharge, so it must be priced HERE and not
    // only on the label — otherwise the fee lands on the invoice uncollected.
    const signatureOption = normalizeSignature(signature);
    requestSummary = { originZip, destZip, destCountry, residential: Boolean(residential), weightLbs, lengthIn, widthIn, heightIn, signature: signatureOption };

    const token = await getUpsToken();

    // Pickup date/time (today) — required for time-in-transit estimates.
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const pickupDate = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
    const pickupTime = `${pad(now.getHours())}${pad(now.getMinutes())}`;

    const upsDCISInner = upsDeliveryConfirmation(signatureOption);
    const upsDCIS = Object.keys(upsDCISInner).length > 0 ? upsDCISInner : null;

    // Shoptimeintransit returns rates AND transit times for all available
    // services — INCLUDING Saturday-delivery variants as DUPLICATE service
    // rows (verified in sandbox 2026-08-07): the Saturday row carries
    // TimeInTransit.ServiceSummary.SaturdayDelivery === '1', a Saturday
    // arrival date, and the Saturday surcharge already inside the rated total
    // (ServiceOptionsCharges). No SaturdayDeliveryIndicator is needed when
    // RATING — the indicator IS required on the LABEL request or UPS books
    // Mon–Fri delivery. See saturday_delivery_notes.md.
    //
    // Simple Rate is a flat price by cubic-volume tier, EXEMPT from residential,
    // delivery-area and fuel surcharges — often cheaper on a small, heavy,
    // residential parcel and often DEARER on a light short-zone one. It is
    // therefore quoted alongside the standard rates and used only where it wins.
    const simple = simpleRateEligibility({
      weightLbs, lengthIn, widthIn, heightIn, destCountry,
    });

    const buildPayload = (simpleRateTier: SimpleRateTier | null) => ({
      RateRequest: {
        Request: {
          RequestOption: 'Shoptimeintransit',
          TransactionReference: { CustomerContext: 'slpack-rate-compare' },
        },
        Shipment: {
          Shipper: {
            Name: 'Storm Lake Pack and Ship',
            ShipperNumber: process.env.UPS_ACCOUNT_NUMBER ?? '',
            Address: {
              PostalCode: String(originZip),
              StateProvinceCode: ORIGIN_STATE,
              CountryCode: 'US',
            },
          },
          ShipTo: {
            Name: 'Customer',
            Address: {
              // City/State included because some ZIPs (e.g. 78133) can't be
              // resolved by UPS from postal code alone → 111542 Invalid Destination.
              ...(destCity ? { City: String(destCity) } : {}),
              ...(destState ? { StateProvinceCode: String(destState) } : {}),
              PostalCode: normalizePostal(destZip, destCountry),
              CountryCode: String(destCountry || 'US'),
              // Presence of this element marks a residential delivery (surcharge applies);
              // omit it entirely for commercial.
              ...(residential ? { ResidentialAddressIndicator: '' } : {}),
            },
          },
          ShipFrom: {
            Name: 'Storm Lake Pack and Ship',
            Address: {
              PostalCode: String(originZip),
              StateProvinceCode: ORIGIN_STATE,
              CountryCode: 'US',
            },
          },
          // Request our negotiated (account) rates — actual cost, not published.
          ShipmentRatingOptions: { NegotiatedRatesIndicator: 'Y' },
          // Required for time-in-transit estimates under Shoptimeintransit.
          DeliveryTimeInformation: {
            PackageBillType: '03', // non-document
            Pickup: { Date: pickupDate, Time: pickupTime },
          },
          ShipmentTotalWeight: {
            UnitOfMeasurement: { Code: 'LBS', Description: 'Pounds' },
            Weight: String(weightLbs),
          },
          // Simple Rate needs NumOfPieces at shipment level alongside
          // Package.SimpleRate — per the official Rating.yaml example. Omitted
          // entirely on the standard call so that quote is byte-identical to
          // what it has always been.
          ...(simpleRateTier ? { NumOfPieces: '1' } : {}),
          Package: {
            ...(simpleRateTier
              ? { SimpleRate: { Code: simpleRateTier, Description: 'Simple Rate' } }
              : {}),
            PackagingType: { Code: '02', Description: 'Package' },
            Dimensions: {
              UnitOfMeasurement: { Code: 'IN', Description: 'Inches' },
              Length: String(lengthIn),
              Width: String(widthIn),
              Height: String(heightIn),
            },
            PackageWeight: {
              UnitOfMeasurement: { Code: 'LBS', Description: 'Pounds' },
              Weight: String(weightLbs),
            },
            // Domestic US signature is PACKAGE level (DCISType 2 = signature,
            // 3 = adult), unlike the shipment-level Saturday indicator. Omitted
            // entirely when no signature is wanted so the quote is unchanged.
            ...(upsDCIS ? { PackageServiceOptions: upsDCIS } : {}),
          },
        },
      },
    });

    const callUps = (simpleRateTier: SimpleRateTier | null) =>
      fetch(`${BASE}/api/rating/v2403/Shoptimeintransit`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(buildPayload(simpleRateTier)),
      });

    // Two calls: the standard quote we have always made, plus a Simple Rate one
    // when the parcel qualifies. allSettled, because a Simple Rate failure must
    // degrade to today's behaviour rather than blanking the whole panel.
    const [standardRes, simpleRes] = await Promise.allSettled([
      callUps(null),
      simple.eligible ? callUps(simple.tier) : Promise.reject(new Error('not eligible')),
    ]);

    if (standardRes.status !== 'fulfilled') {
      return await logAndRespond({
        route: ROUTE,
        carrier: 'ups',
        status: 502,
        message: 'UPS rate request failed',
        upstreamBody: String(standardRes.reason),
        requestSummary,
      });
    }
    const rateRes = standardRes.value;

    if (!rateRes.ok) {
      const body = await rateRes.text();
      return await logAndRespond({
        route: ROUTE,
        carrier: 'ups',
        status: rateRes.status,
        message: `UPS rate error (${rateRes.status})`,
        upstreamStatus: rateRes.status,
        upstreamBody: body,
        requestSummary,
      });
    }

    // Simple Rate cost per service code. Empty whenever the parcel doesn't
    // qualify or UPS refused — the merge below then simply finds nothing.
    const simpleCostByService = new Map<string, number>();

    /**
     * Record a Simple Rate problem without disturbing the quote.
     *
     * The Simple Rate call is deliberately allowed to fail — it must never blank
     * the UPS panel — but that made "UPS refused the request" look identical to
     * "the flat rate simply wasn't cheaper", so a shop could lose the saving on
     * every parcel and never know.
     *
     * Throttled to the FIRST occurrence per hour: when Simple Rate is
     * unavailable it fails on every eligible quote, and an error log flooded
     * with one repeated entry is as useless as no entry at all.
     */
    async function noteSimpleRateProblem(
      message: string,
      upstreamStatus?: number,
      upstreamBody?: string
    ): Promise<void> {
      try {
        if ((await hit('ups-simple-rate-unavailable', 60 * 60 * 1000)) !== 1) return;
        await appendError({
          id: randomUUID(),
          timestamp: new Date().toISOString(),
          route: `${ROUTE}/simple-rate`,
          carrier: 'ups',
          status: 200, // the quote itself succeeded
          message,
          ...(upstreamStatus ? { upstreamStatus } : {}),
          ...(upstreamBody ? { upstreamBody: upstreamBody.slice(0, 2000) } : {}),
          requestSummary: {
            simpleRateTier: simple.tier,
            cubicIn: simple.cubicIn,
            weightLbs,
            destZip,
            note: 'Quote unaffected — the standard UPS rates returned normally.',
          },
        });
      } catch {
        // Diagnostics must never break a counter quote.
      }
    }

    if (simple.eligible) {
      if (simpleRes.status !== 'fulfilled') {
        await noteSimpleRateProblem(
          `UPS Simple Rate request did not complete (${String(simpleRes.reason)}). ` +
            'No shipment can earn the flat-rate saving until this clears.'
        );
      } else if (!simpleRes.value.ok) {
        const body = await simpleRes.value.text().catch(() => '');
        await noteSimpleRateProblem(
          `UPS REFUSED the Simple Rate request (${simpleRes.value.status}). Simple Rate needs no ` +
            'enrollment, so this is usually the request shape, the declared tier, or the lane — ' +
            'see the upstream body. Standard rates are unaffected, but every eligible parcel is ' +
            'being booked at the dearer standard rate.',
          simpleRes.value.status,
          body
        );
      } else {
        try {
          const simpleData = await simpleRes.value.json();
          const simpleRaw = simpleData?.RateResponse?.RatedShipment ?? [];
          for (const sr of (Array.isArray(simpleRaw) ? simpleRaw : [simpleRaw]) as Record<string, unknown>[]) {
            const code = (sr.Service as Record<string, string>)?.Code ?? '';
            if (!isSimpleRateService(code)) continue;
            const negotiated = (sr.NegotiatedRateCharges as Record<string, Record<string, string>> | undefined)
              ?.TotalCharge?.MonetaryValue;
            const total = (sr.TotalCharges as Record<string, string> | undefined)?.MonetaryValue;
            const cost = parseFloat(negotiated ?? total ?? '');
            if (Number.isFinite(cost) && cost > 0) simpleCostByService.set(code, cost);
          }
          if (simpleCostByService.size === 0) {
            await noteSimpleRateProblem(
              'UPS accepted the Simple Rate request but returned no priced eligible service ' +
                '(Ground / 2nd Day Air / 3 Day Select / Next Day Air Saver). Either the lane does ' +
                'not support it or the account cannot see Simple Rate pricing.'
            );
          }
        } catch (err: unknown) {
          await noteSimpleRateProblem(
            `Could not read the UPS Simple Rate reply (${err instanceof Error ? err.message : 'parse error'}).`
          );
        }
      }
    }

    const data = await rateRes.json();
    const raw = data?.RateResponse?.RatedShipment ?? [];
    const shipments: Record<string, unknown>[] = Array.isArray(raw) ? raw : [raw];

    const rates = shipments.map((s) => {
      const code = (s.Service as Record<string, string>)?.Code ?? '';
      const charges = s.TotalCharges as Record<string, string> | undefined;
      // Negotiated (account) total when available — our actual cost.
      const negotiated = (s.NegotiatedRateCharges as Record<string, Record<string, string>> | undefined)
        ?.TotalCharge?.MonetaryValue;
      // Falling back to TotalCharges means quoting the PUBLISHED list price. UPS
      // omits NegotiatedRateCharges when the account has no rate on file for the
      // service (common on express while ground is discounted), and the label
      // response still bills the negotiated figure — so retail would be marked up
      // off a price we never pay. Flag it rather than letting it pass silently.
      const rateSource = negotiated ? 'negotiated' : 'published';
      // TotalCharges is UPS's PUBLISHED price — what they'd charge a walk-in
      // customer. Keep it even when a negotiated rate exists: it bounds what the
      // shipment is really worth and is the fallback cost basis when it doesn't.
      // When no negotiated rate came back this is the same figure as
      // totalChargeUSD, which is precisely the case worth seeing.
      const listPrice = parseFloat(charges?.MonetaryValue ?? '');

      // Prefer time-in-transit data; fall back to GuaranteedDelivery (guaranteed
      // services only). ServiceSummary may be an array or a single object.
      const guarantee = s.GuaranteedDelivery as Record<string, string> | undefined;
      const tit = s.TimeInTransit as Record<string, unknown> | undefined;
      const summaryRaw = (tit?.ServiceSummary ?? []) as unknown;
      const summary = (Array.isArray(summaryRaw) ? summaryRaw[0] : summaryRaw) as
        | Record<string, Record<string, Record<string, string>> & Record<string, string>>
        | undefined;
      const estArrival = summary?.EstimatedArrival as
        | { BusinessDaysInTransit?: string; Arrival?: { Date?: string } }
        | undefined;

      const daysStr = estArrival?.BusinessDaysInTransit ?? guarantee?.BusinessDaysInTransit;
      const estimatedDays = daysStr ? parseInt(daysStr) || null : null;
      const arrivalRaw = estArrival?.Arrival?.Date ?? null;
      const deliveryDate = formatDeliveryDate(arrivalRaw ?? guarantee?.DeliveryByTime);

      // Saturday-delivery variant? UPS marks the duplicate row explicitly;
      // the arrival-weekday check is belt-and-braces so a mislabeled row can
      // never charge a Saturday surcharge for a weekday arrival.
      const saturdayDelivery =
        (summary?.SaturdayDelivery as unknown) === '1' && isSaturdayDate(arrivalRaw);
      const baseName = SERVICE_NAMES[code] ?? `UPS Service ${code}`;

      // Attach Simple Rate ONLY where it actually beats the standard cost.
      // Saturday rows are excluded: Simple Rate has no Saturday variant, and the
      // quoted Saturday surcharge would be lost if we booked one flat.
      const stdCost = parseFloat(negotiated ?? charges?.MonetaryValue ?? '0');
      const simpleCost = simpleCostByService.get(code);
      const simpleWins =
        simple.eligible &&
        simple.tier !== null &&
        !saturdayDelivery &&
        simpleCost !== undefined &&
        Number.isFinite(stdCost) &&
        stdCost > 0 &&
        simpleCost < stdCost;

      return {
        serviceCode: code,
        // Suffix appended HERE ONLY — cart, receipts, and the shipment log all
        // display serviceName, so they inherit it. Don't re-append downstream.
        serviceName: saturdayDelivery ? `${baseName} — Saturday Delivery` : baseName,
        totalChargeUSD: parseFloat(negotiated ?? charges?.MonetaryValue ?? '0'),
        estimatedDays,
        deliveryDate,
        rateSource,
        ...(Number.isFinite(listPrice) && listPrice > 0 ? { listPriceUSD: listPrice } : {}),
        // NOTE the Simple Rate cost is reported SEPARATELY and never folded into
        // totalChargeUSD or listPriceUSD. It is a shipper-program cost, not a
        // retail counter price, so using it as the pricing anchor would collapse
        // the customer's charge to about cost + the margin floor.
        ...(simpleWins
          ? {
              simpleRate: {
                tier: simple.tier as SimpleRateTier,
                costUSD: simpleCost as number,
                nearBoundary: simple.nearBoundary,
              },
            }
          : {}),
        // The Saturday surcharge is already inside the rated total.
        ...(saturdayDelivery ? { saturdayDelivery: true } : {}),
      };
    });

    // buildId lets the page detect a tab left open across a deploy.
    return NextResponse.json({ rates, buildId: serverBuildId() });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return await logAndRespond({
      route: ROUTE,
      carrier: 'ups',
      status: 500,
      message,
      requestSummary,
      err,
    });
  }
}
