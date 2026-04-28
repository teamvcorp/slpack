import { NextRequest, NextResponse } from 'next/server';

const BASE = process.env.FEDEX_SANDBOX === 'false'
  ? 'https://apis.fedex.com'
  : 'https://apis-sandbox.fedex.com';

async function getToken(): Promise<string> {
  const res = await fetch(`${BASE}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: process.env.FEDEX_CLIENT_ID!,
      client_secret: process.env.FEDEX_CLIENT_SECRET!,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`FedEx auth failed (${res.status}): ${body}`);
  }
  const data = await res.json();
  return data.access_token as string;
}

export async function POST(req: NextRequest) {
  try {
    if (!process.env.FEDEX_CLIENT_ID || !process.env.FEDEX_CLIENT_SECRET || !process.env.FEDEX_ACCOUNT_NUMBER) {
      return NextResponse.json(
        { error: 'FedEx credentials not configured (FEDEX_CLIENT_ID / FEDEX_CLIENT_SECRET / FEDEX_ACCOUNT_NUMBER)' },
        { status: 503 }
      );
    }

    const { shipment, serviceCode, insurance } = await req.json();

    const token = await getToken();
    const accountNumber = process.env.FEDEX_ACCOUNT_NUMBER;
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

    // Build declared value object for insurance
    const declaredValue =
      insurance?.enabled && insurance?.valueUSD > 0
        ? {
            declaredValue: {
              amount: Number(insurance.valueUSD.toFixed(2)),
              currency: 'USD',
            },
          }
        : {};

    const payload = {
      labelResponseOptions: 'LABEL',
      accountNumber: { value: accountNumber },
      requestedShipment: {
        shipper: {
          contact: {
            personName: 'Storm Lake Pack and Ship',
            phoneNumber: '7122131234',
            companyName: 'Storm Lake Pack and Ship',
          },
          address: {
            streetLines: ['407 Lake Ave'],
            city: 'Storm Lake',
            stateOrProvinceCode: 'IA',
            postalCode: String(shipment.originZip),
            countryCode: 'US',
          },
        },
        recipients: [
          {
            contact: {
              personName: shipment.customerName || 'Customer',
              phoneNumber: shipment.customerPhone || '5555555555',
            },
            address: {
              streetLines: [shipment.destStreet || ''],
              city: shipment.destCity || '',
              stateOrProvinceCode: shipment.destState || '',
              postalCode: String(shipment.destZip),
              countryCode: String(shipment.destCountry || 'US'),
            },
          },
        ],
        shipDatestamp: today,
        serviceType: String(serviceCode),
        packagingType: 'YOUR_PACKAGING',
        pickupType: 'USE_SCHEDULED_PICKUP',
        shippingChargesPayment: {
          paymentType: 'SENDER',
          payor: {
            responsibleParty: {
              accountNumber: { value: accountNumber },
            },
          },
        },
        labelSpecification: {
          imageType: 'PDF',
          labelStockType: 'PAPER_LETTER',
        },
        requestedPackageLineItems: [
          {
            sequenceNumber: 1,
            weight: {
              units: 'LB',
              value: Number(shipment.weightLbs),
            },
            dimensions: {
              length: Number(shipment.lengthIn),
              width: Number(shipment.widthIn),
              height: Number(shipment.heightIn),
              units: 'IN',
            },
            ...declaredValue,
          },
        ],
      },
    };

    const shipRes = await fetch(`${BASE}/ship/v1/shipments`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'x-customer-transaction-id': `slpack-label-${Date.now()}`,
        'x-locale': 'en_US',
      },
      body: JSON.stringify(payload),
    });

    if (!shipRes.ok) {
      const body = await shipRes.text();
      let detail = body;
      try {
        const parsed = JSON.parse(body);
        const msg =
          parsed?.errors?.[0]?.message ??
          parsed?.output?.alerts?.[0]?.message ??
          null;
        if (msg) detail = msg;
      } catch { /* keep raw body */ }
      return NextResponse.json(
        { error: `FedEx ship error (${shipRes.status}): ${detail}` },
        { status: shipRes.status }
      );
    }

    const data = await shipRes.json();

    // Extract tracking number from response
    const completedShipment = data?.output?.transactionShipments?.[0];
    const trackingNumber: string =
      completedShipment?.masterTrackingNumber ??
      completedShipment?.completedPackageDetails?.[0]?.trackingIds?.[0]?.trackingNumber ??
      'PENDING';

    // Extract base64 label — FedEx returns it under pieceResponses[0].packageDocuments
    const pkgDetails = completedShipment?.completedPackageDetails?.[0];
    const labelBase64: string | null =
      completedShipment?.pieceResponses?.[0]?.packageDocuments?.find(
        (d: Record<string, unknown>) => d.contentType === 'LABEL'
      )?.encodedLabel ??
      pkgDetails?.label?.encodedLabel ??
      null;

    return NextResponse.json({ trackingNumber, labelBase64, labelMimeType: 'application/pdf' });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
