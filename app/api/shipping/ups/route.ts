import { NextRequest, NextResponse } from 'next/server';

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

async function getToken(): Promise<string> {
  const credentials = Buffer.from(
    `${process.env.UPS_CLIENT_ID}:${process.env.UPS_CLIENT_SECRET}`
  ).toString('base64');

  const res = await fetch(`${BASE}/security/v1/oauth/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ grant_type: 'client_credentials' }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`UPS auth failed (${res.status}): ${body}`);
  }
  const data = await res.json();
  return data.access_token as string;
}

export async function POST(req: NextRequest) {
  try {
    if (!process.env.UPS_CLIENT_ID || !process.env.UPS_CLIENT_SECRET) {
      return NextResponse.json(
        { error: 'UPS credentials not configured (UPS_CLIENT_ID / UPS_CLIENT_SECRET)' },
        { status: 503 }
      );
    }

    const {
      originZip, destZip, destCountry,
      weightLbs, lengthIn, widthIn, heightIn,
    } = await req.json();

    const token = await getToken();

    // "Shop" RequestOption returns rates for all available services
    const payload = {
      RateRequest: {
        Request: {
          RequestOption: 'Shop',
          TransactionReference: { CustomerContext: 'slpack-rate-compare' },
        },
        Shipment: {
          Shipper: {
            Name: 'Storm Lake Pack and Ship',
            ShipperNumber: process.env.UPS_ACCOUNT_NUMBER ?? '',
            Address: { PostalCode: String(originZip), CountryCode: 'US' },
          },
          ShipTo: {
            Name: 'Customer',
            Address: {
              PostalCode: String(destZip),
              CountryCode: String(destCountry || 'US'),
            },
          },
          ShipFrom: {
            Name: 'Storm Lake Pack and Ship',
            Address: { PostalCode: String(originZip), CountryCode: 'US' },
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

    const rateRes = await fetch(`${BASE}/api/rating/v2403/Rate`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!rateRes.ok) {
      const body = await rateRes.text();
      return NextResponse.json(
        { error: `UPS rate error (${rateRes.status})`, details: body },
        { status: rateRes.status }
      );
    }

    const data = await rateRes.json();
    const raw = data?.RateResponse?.RatedShipment ?? [];
    const shipments: Record<string, unknown>[] = Array.isArray(raw) ? raw : [raw];

    const rates = shipments.map((s) => {
      const code = (s.Service as Record<string, string>)?.Code ?? '';
      const charges = s.TotalCharges as Record<string, string> | undefined;
      const guarantee = s.GuaranteedDelivery as Record<string, string> | undefined;
      return {
        serviceCode: code,
        serviceName: SERVICE_NAMES[code] ?? `UPS Service ${code}`,
        totalChargeUSD: parseFloat(charges?.MonetaryValue ?? '0'),
        estimatedDays: guarantee?.BusinessDaysInTransit
          ? parseInt(guarantee.BusinessDaysInTransit)
          : null,
        deliveryDate: guarantee?.DeliveryByTime ?? null,
      };
    });

    return NextResponse.json({ rates });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
