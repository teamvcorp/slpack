import { NextRequest, NextResponse } from 'next/server';
import { logAndRespond } from '@/lib/apiErrors';
import { getUpsToken } from '@/lib/carrierTokens';
import { SITE } from '@/lib/siteConfig';
import { formatDeliveryDate } from '@/lib/transit';
import { normalizePostal } from '@/lib/postal';

// International UPS rate quote. Separate from the domestic route. UPS
// Shoptimeintransit returns whatever services the lane supports (the intl
// service codes below already appear for cross-border destinations).
const ROUTE = 'shipping/intl/ups';

const ORIGIN_STATE = SITE.address.region;

const BASE = process.env.UPS_SANDBOX === 'false'
  ? 'https://onlinetools.ups.com'
  : 'https://wwwcie.ups.com';

const SERVICE_NAMES: Record<string, string> = {
  '07': 'UPS Worldwide Express',
  '08': 'UPS Worldwide Expedited',
  '11': 'UPS Standard',
  '54': 'UPS Worldwide Express Plus',
  '65': 'UPS Worldwide Saver',
  // Domestic codes kept for completeness (unlikely on intl lanes).
  '01': 'UPS Next Day Air',
  '02': 'UPS 2nd Day Air',
  '03': 'UPS Ground',
  '12': 'UPS 3 Day Select',
  '13': 'UPS Next Day Air Saver',
  '14': 'UPS Next Day Air Early AM',
  '59': 'UPS 2nd Day Air AM',
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
      declaredValueUSD,
    } = await req.json();
    requestSummary = { originZip, destZip, destCountry, residential: Boolean(residential), weightLbs, lengthIn, widthIn, heightIn };

    // International rating requires a shipment contents value (customs value).
    const contentsValue = Number(declaredValueUSD) > 0 ? Number(declaredValueUSD) : 1;

    const token = await getUpsToken();

    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const pickupDate = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
    const pickupTime = `${pad(now.getHours())}${pad(now.getMinutes())}`;

    const payload = {
      RateRequest: {
        Request: {
          RequestOption: 'Shoptimeintransit',
          TransactionReference: { CustomerContext: 'slpack-intl-rate' },
        },
        Shipment: {
          Shipper: {
            Name: 'Storm Lake Pack and Ship',
            ShipperNumber: process.env.UPS_ACCOUNT_NUMBER ?? '',
            Address: {
              AddressLine: [SITE.address.street],
              City: SITE.address.city,
              PostalCode: String(originZip),
              StateProvinceCode: ORIGIN_STATE,
              CountryCode: SITE.address.country,
            },
          },
          ShipTo: {
            Name: 'Customer',
            Address: {
              PostalCode: normalizePostal(destZip, destCountry),
              CountryCode: String(destCountry || 'US'),
              ...(residential ? { ResidentialAddressIndicator: '' } : {}),
            },
          },
          ShipFrom: {
            Name: 'Storm Lake Pack and Ship',
            Address: {
              AddressLine: [SITE.address.street],
              City: SITE.address.city,
              PostalCode: String(originZip),
              StateProvinceCode: ORIGIN_STATE,
              CountryCode: SITE.address.country,
            },
          },
          // Required for international rating (customs value of the goods).
          InvoiceLineTotal: {
            CurrencyCode: 'USD',
            MonetaryValue: String(contentsValue.toFixed(2)),
          },
          ShipmentRatingOptions: { NegotiatedRatesIndicator: 'Y' },
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
        message: `UPS intl rate error (${rateRes.status})`,
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
      const negotiated = (s.NegotiatedRateCharges as Record<string, Record<string, string>> | undefined)
        ?.TotalCharge?.MonetaryValue;

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
