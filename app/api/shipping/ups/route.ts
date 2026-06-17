import { NextRequest, NextResponse } from 'next/server';
import { logAndRespond } from '@/lib/apiErrors';
import { getUpsToken } from '@/lib/carrierTokens';
import { SITE } from '@/lib/siteConfig';
import { formatDeliveryDate } from '@/lib/transit';

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
      originZip, destZip, destCountry, residential,
      weightLbs, lengthIn, widthIn, heightIn,
    } = await req.json();
    requestSummary = { originZip, destZip, destCountry, residential: Boolean(residential), weightLbs, lengthIn, widthIn, heightIn };

    const token = await getUpsToken();

    // Pickup date/time (today) — required for time-in-transit estimates.
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const pickupDate = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
    const pickupTime = `${pad(now.getHours())}${pad(now.getMinutes())}`;

    // Shoptimeintransit returns rates AND transit times for all available services.
    const payload = {
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
              PostalCode: String(destZip),
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
          Package: {
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
          },
        },
      },
    };

    const rateRes = await fetch(`${BASE}/api/rating/v2403/Shoptimeintransit`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

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

    const data = await rateRes.json();
    const raw = data?.RateResponse?.RatedShipment ?? [];
    const shipments: Record<string, unknown>[] = Array.isArray(raw) ? raw : [raw];

    const rates = shipments.map((s) => {
      const code = (s.Service as Record<string, string>)?.Code ?? '';
      const charges = s.TotalCharges as Record<string, string> | undefined;
      // Negotiated (account) total when available — our actual cost.
      const negotiated = (s.NegotiatedRateCharges as Record<string, Record<string, string>> | undefined)
        ?.TotalCharge?.MonetaryValue;

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
      const deliveryDate = formatDeliveryDate(
        estArrival?.Arrival?.Date ?? guarantee?.DeliveryByTime
      );

      return {
        serviceCode: code,
        serviceName: SERVICE_NAMES[code] ?? `UPS Service ${code}`,
        totalChargeUSD: parseFloat(negotiated ?? charges?.MonetaryValue ?? '0'),
        estimatedDays,
        deliveryDate,
      };
    });

    return NextResponse.json({ rates });
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
