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
    if (!process.env.FEDEX_CLIENT_ID || !process.env.FEDEX_CLIENT_SECRET) {
      return NextResponse.json(
        { error: 'FedEx credentials not configured (FEDEX_CLIENT_ID / FEDEX_CLIENT_SECRET)' },
        { status: 503 }
      );
    }

    const {
      originZip, destZip, destCountry,
      weightLbs, lengthIn, widthIn, heightIn,
    } = await req.json();

    const token = await getToken();

    const payload = {
      accountNumber: { value: process.env.FEDEX_ACCOUNT_NUMBER ?? '' },
      requestedShipment: {
        shipper: { address: { postalCode: String(originZip), countryCode: 'US' } },
        recipient: {
          address: {
            postalCode: String(destZip),
            countryCode: String(destCountry || 'US'),
          },
        },
        pickupType: 'USE_SCHEDULED_PICKUP',
        rateRequestType: ['LIST'],
        requestedPackageLineItems: [
          {
            weight: { units: 'LB', value: Number(weightLbs) },
            dimensions: {
              length: Number(lengthIn),
              width: Number(widthIn),
              height: Number(heightIn),
              units: 'IN',
            },
          },
        ],
      },
    };

    const rateRes = await fetch(`${BASE}/rate/v1/rates/quotes`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'x-customer-transaction-id': `slpack-${Date.now()}`,
        'x-locale': 'en_US',
      },
      body: JSON.stringify(payload),
    });

    if (!rateRes.ok) {
      const body = await rateRes.text();
      return NextResponse.json(
        { error: `FedEx rate error (${rateRes.status})`, details: body },
        { status: rateRes.status }
      );
    }

    const data = await rateRes.json();
    const details: unknown[] = data?.output?.rateReplyDetails ?? [];

    const rates = (details as Record<string, unknown>[]).map((d) => {
      const shipDetail = (d.ratedShipmentDetails as Record<string, unknown>[])?.[0];
      const netCharge =
        (shipDetail?.totalNetFedExCharge as string) ??
        (shipDetail?.totalNetCharge as string) ??
        '0';
      const commit = d.commit as Record<string, unknown> | undefined;
      return {
        serviceCode: d.serviceType as string,
        serviceName: (d.serviceName as string) ?? (d.serviceType as string),
        totalChargeUSD: parseFloat(netCharge),
        estimatedDays: commit?.transitDays ? parseInt(commit.transitDays as string) : null,
        deliveryDate: (commit as Record<string, Record<string, string>> | undefined)
          ?.dateDetail?.dayFormat ?? null,
      };
    });

    return NextResponse.json({ rates });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
