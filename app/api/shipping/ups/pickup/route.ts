import { NextRequest, NextResponse } from 'next/server';
import { logAndRespond } from '@/lib/apiErrors';
import { getUpsToken } from '@/lib/carrierTokens';

const ROUTE = 'shipping/ups/pickup';

const BASE = process.env.UPS_SANDBOX === 'false'
  ? 'https://onlinetools.ups.com'
  : 'https://wwwcie.ups.com';

export async function POST(req: NextRequest) {
  try {
    if (!process.env.UPS_CLIENT_ID || !process.env.UPS_CLIENT_SECRET || !process.env.UPS_ACCOUNT_NUMBER) {
      return await logAndRespond({
        route: ROUTE,
        carrier: 'ups',
        status: 503,
        message: 'UPS credentials not configured (UPS_CLIENT_ID / UPS_CLIENT_SECRET / UPS_ACCOUNT_NUMBER)',
      });
    }

    const body = await req.json();
    const {
      pickupDate, // YYYY-MM-DD
      readyTime = '09:00', // HH:MM
      closeTime = '18:00', // HH:MM
      packageCount = 1,
      totalWeightLbs = 1,
      contact = {},
      address = {},
    } = body ?? {};

    const phone = String(contact.phoneNumber ?? '').replace(/\D/g, '').slice(0, 15);
    const street = String(address.streetLines ?? '').trim();
    const city = String(address.city ?? '').trim();
    const state = String(address.stateOrProvinceCode ?? '').trim();
    const postalCode = String(address.postalCode ?? '').trim();

    if (!pickupDate || !street || !city || !state || !postalCode || phone.length < 8) {
      return await logAndRespond({
        route: ROUTE,
        carrier: 'ups',
        status: 400,
        message: 'Missing required pickup fields (date, full address, and a valid phone number).',
      });
    }

    // UPS wants yyyyMMdd dates and HHmm times.
    const pickupDateCompact = String(pickupDate).replace(/-/g, '');
    const readyCompact = String(readyTime).replace(':', '');
    const closeCompact = String(closeTime).replace(':', '');

    const payload = {
      PickupCreationRequest: {
        RatePickupIndicator: 'N',
        Shipper: {
          Account: {
            AccountNumber: process.env.UPS_ACCOUNT_NUMBER,
            AccountCountryCode: 'US',
          },
        },
        PickupDateInfo: {
          CloseTime: closeCompact,
          ReadyTime: readyCompact,
          PickupDate: pickupDateCompact,
        },
        PickupAddress: {
          CompanyName: String(contact.companyName ?? 'Storm Lake Pack and Ship').slice(0, 35),
          ContactName: String(contact.personName ?? '').slice(0, 35) || 'Storm Lake Pack and Ship',
          AddressLine: street,
          City: city,
          StateProvince: state,
          PostalCode: postalCode,
          CountryCode: String(address.countryCode ?? 'US'),
          ResidentialIndicator: 'N',
          Phone: { Number: phone },
        },
        AlternateAddressIndicator: 'N',
        PickupPiece: [
          {
            ServiceCode: '001',
            Quantity: String(Math.max(1, Math.floor(Number(packageCount) || 1))),
            DestinationCountryCode: 'US',
            ContainerCode: '01', // 01 = PACKAGE
          },
        ],
        TotalWeight: {
          Weight: String(Math.max(0.1, Number(totalWeightLbs) || 1)),
          UnitOfMeasurement: 'LBS',
        },
        OverweightIndicator: 'N',
        PaymentMethod: '01',
      },
    };

    const token = await getUpsToken();
    const res = await fetch(`${BASE}/api/pickupcreation/v2409/pickup`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        transId: `slpack-pickup-${Date.now()}`,
        transactionSrc: 'slpack',
      },
      body: JSON.stringify(payload),
    });

    const raw = await res.text();
    if (!res.ok) {
      let detail = raw;
      try {
        const parsed = JSON.parse(raw);
        detail = parsed?.response?.errors?.[0]?.message ?? parsed?.errors?.[0]?.message ?? raw;
      } catch { /* keep raw */ }
      return await logAndRespond({
        route: ROUTE,
        carrier: 'ups',
        status: res.status,
        message: `UPS pickup error (${res.status}): ${detail}`,
        upstreamStatus: res.status,
        upstreamBody: raw,
        requestSummary: { pickupDate, postalCode, packageCount },
      });
    }

    const data = JSON.parse(raw);
    const out = data?.PickupCreationResponse ?? {};
    return NextResponse.json({
      pickupConfirmationCode: out.PRN ?? null,
      location: null,
      alerts: [],
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return await logAndRespond({ route: ROUTE, carrier: 'ups', status: 500, message, err });
  }
}
