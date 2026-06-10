import { NextRequest, NextResponse } from 'next/server';
import { logAndRespond } from '@/lib/apiErrors';
import { getFedexToken } from '@/lib/carrierTokens';

const ROUTE = 'shipping/fedex/pickup';

const BASE = process.env.FEDEX_SANDBOX === 'false'
  ? 'https://apis.fedex.com'
  : 'https://apis-sandbox.fedex.com';

export async function POST(req: NextRequest) {
  try {
    if (!process.env.FEDEX_CLIENT_ID || !process.env.FEDEX_CLIENT_SECRET || !process.env.FEDEX_ACCOUNT_NUMBER) {
      return await logAndRespond({
        route: ROUTE,
        carrier: 'fedex',
        status: 503,
        message: 'FedEx credentials not configured (FEDEX_CLIENT_ID / FEDEX_CLIENT_SECRET / FEDEX_ACCOUNT_NUMBER)',
      });
    }

    const body = await req.json();
    const {
      carrierCode = 'FDXG', // FDXG = Ground, FDXE = Express
      pickupDate, // YYYY-MM-DD
      readyTime = '09:00', // HH:MM (local)
      closeTime = '18:00', // HH:MM (latest courier access, local)
      packageCount = 1,
      totalWeightLbs = 1,
      packageLocation = 'FRONT', // FRONT | REAR | SIDE | NONE
      remarks,
      contact = {},
      address = {},
    } = body ?? {};

    const phone = String(contact.phoneNumber ?? '').replace(/\D/g, '').slice(0, 13);
    const street = String(address.streetLines ?? '').trim();
    const city = String(address.city ?? '').trim();
    const state = String(address.stateOrProvinceCode ?? '').trim();
    const postalCode = String(address.postalCode ?? '').trim();

    if (!pickupDate || !street || !city || !state || !postalCode || phone.length < 8) {
      return await logAndRespond({
        route: ROUTE,
        carrier: 'fedex',
        status: 400,
        message: 'Missing required pickup fields (date, full address, and a valid phone number).',
      });
    }
    if (carrierCode !== 'FDXG' && carrierCode !== 'FDXE') {
      return await logAndRespond({ route: ROUTE, carrier: 'fedex', status: 400, message: `Invalid carrierCode: ${carrierCode}` });
    }

    const today = new Date().toISOString().split('T')[0];
    const pickupDateType = pickupDate === today ? 'SAME_DAY' : 'FUTURE_DAY';

    const payload = {
      associatedAccountNumber: { value: process.env.FEDEX_ACCOUNT_NUMBER },
      originDetail: {
        pickupLocation: {
          contact: {
            companyName: String(contact.companyName ?? 'Storm Lake Pack and Ship').slice(0, 35),
            personName: String(contact.personName ?? '').slice(0, 70) || 'Storm Lake Pack and Ship',
            phoneNumber: phone,
          },
          address: {
            streetLines: [street],
            city,
            stateOrProvinceCode: state,
            postalCode,
            countryCode: String(address.countryCode ?? 'US'),
            residential: false,
          },
        },
        // FedEx wants local time with no real TZD; the trailing Z is ignored per spec.
        readyDateTimestamp: `${pickupDate}T${readyTime}:00Z`,
        customerCloseTime: `${closeTime}:00`,
        packageLocation,
        pickupDateType,
      },
      carrierCode,
      totalWeight: { units: 'LB', value: Math.max(0.1, Number(totalWeightLbs) || 1) },
      packageCount: Math.max(1, Math.floor(Number(packageCount) || 1)),
      ...(remarks ? { remarks: String(remarks).slice(0, 60) } : {}),
      countryRelationships: 'DOMESTIC',
    };

    const token = await getFedexToken();
    const res = await fetch(`${BASE}/pickup/v1/pickups`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'x-customer-transaction-id': `slpack-pickup-${Date.now()}`,
        'x-locale': 'en_US',
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const raw = await res.text();
      let detail = raw;
      try {
        const parsed = JSON.parse(raw);
        detail = parsed?.errors?.[0]?.message ?? parsed?.output?.alerts?.[0]?.message ?? raw;
      } catch { /* keep raw */ }
      return await logAndRespond({
        route: ROUTE,
        carrier: 'fedex',
        status: res.status,
        message: `FedEx pickup error (${res.status}): ${detail}`,
        upstreamStatus: res.status,
        upstreamBody: raw,
        requestSummary: { carrierCode, pickupDate, postalCode, packageLocation },
      });
    }

    const data = await res.json();
    const out = data?.output ?? {};
    return NextResponse.json({
      pickupConfirmationCode: out.pickupConfirmationCode ?? null,
      location: out.location ?? null,
      alerts: out.alerts ?? [],
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return await logAndRespond({ route: ROUTE, carrier: 'fedex', status: 500, message, err });
  }
}
