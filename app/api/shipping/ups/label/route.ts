import { NextRequest, NextResponse } from 'next/server';

const BASE = process.env.UPS_SANDBOX === 'false'
  ? 'https://onlinetools.ups.com'
  : 'https://wwwcie.ups.com';

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
      return NextResponse.json({ error: 'UPS credentials not configured' }, { status: 503 });
    }

    const { shipment, serviceCode, insurance } = await req.json();

    const token = await getToken();

    const packageWeight = {
      UnitOfMeasurement: { Code: 'LBS' },
      Weight: String(shipment.weightLbs),
    };

    const packageDims = {
      UnitOfMeasurement: { Code: 'IN' },
      Length: String(shipment.lengthIn),
      Width: String(shipment.widthIn),
      Height: String(shipment.heightIn),
    };

    const packageInsurance =
      insurance?.enabled && insurance?.valueUSD > 0
        ? {
            InsuredValue: {
              CurrencyCode: 'USD',
              MonetaryValue: String(insurance.valueUSD.toFixed(2)),
            },
          }
        : {};

    const payload = {
      ShipmentRequest: {
        Request: {
          RequestOption: 'nonvalidate',
          TransactionReference: { CustomerContext: 'slpack-label' },
        },
        Shipment: {
          Description: 'Package',
          Shipper: {
            Name: 'Storm Lake Pack and Ship',
            ShipperNumber: process.env.UPS_ACCOUNT_NUMBER ?? '',
            Address: {
              AddressLine: ['407 Lake Ave'],
              City: 'Storm Lake',
              StateProvinceCode: 'IA',
              PostalCode: shipment.originZip,
              CountryCode: 'US',
            },
          },
          ShipTo: {
            Name: shipment.customerName || 'Customer',
            Address: {
              City: shipment.destCity || '',
              StateProvinceCode: shipment.destState || '',
              PostalCode: String(shipment.destZip),
              CountryCode: String(shipment.destCountry || 'US'),
            },
          },
          ShipFrom: {
            Name: 'Storm Lake Pack and Ship',
            Address: {
              AddressLine: ['407 Lake Ave'],
              City: 'Storm Lake',
              StateProvinceCode: 'IA',
              PostalCode: shipment.originZip,
              CountryCode: 'US',
            },
          },
          PaymentInformation: {
            ShipmentCharge: {
              Type: '01',
              BillShipper: { AccountNumber: process.env.UPS_ACCOUNT_NUMBER ?? '' },
            },
          },
          Service: { Code: serviceCode ?? '03', Description: 'Service' },
          Package: {
            PackagingType: { Code: '02', Description: 'Package' },
            Dimensions: packageDims,
            PackageWeight: packageWeight,
            ...packageInsurance,
          },
        },
        LabelSpecification: {
          LabelImageFormat: { Code: 'PNG', Description: 'PNG' },
          HTTPUserAgent: 'Mozilla/4.5',
        },
      },
    };

    const labelRes = await fetch(`${BASE}/api/shipments/v2501/ship`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!labelRes.ok) {
      const body = await labelRes.text();
      return NextResponse.json(
        { error: `UPS label error (${labelRes.status})`, details: body },
        { status: labelRes.status }
      );
    }

    const data = await labelRes.json();
    const shipResponse = data?.ShipmentResponse?.ShipmentResults;
    const trackingNumber: string =
      shipResponse?.ShipmentIdentificationNumber ?? 'PENDING';
    const labelBase64: string | null =
      shipResponse?.PackageResults?.ShippingLabel?.GraphicImage ?? null;

    return NextResponse.json({ trackingNumber, labelBase64 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
