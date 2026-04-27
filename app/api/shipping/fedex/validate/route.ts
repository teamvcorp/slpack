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

export interface AddressValidationResult {
  valid: boolean;
  /** 'VALIDATED' | 'STANDARDIZED' | 'UNRESOLVED' */
  status: string;
  /** Suggested corrected address fields from FedEx */
  suggested: {
    streetLine: string;
    city: string;
    state: string;
    zip: string;
    country: string;
  } | null;
  messages: string[];
}

export async function POST(req: NextRequest) {
  try {
    if (!process.env.FEDEX_CLIENT_ID || !process.env.FEDEX_CLIENT_SECRET) {
      return NextResponse.json(
        { error: 'FedEx credentials not configured' },
        { status: 503 }
      );
    }

    const { streetLine, city, state, zip, country } = await req.json();

    if (!zip) {
      return NextResponse.json({ error: 'ZIP/postal code is required' }, { status: 400 });
    }

    const token = await getToken();

    const payload = {
      addressesToValidate: [
        {
          address: {
            streetLines: streetLine ? [String(streetLine)] : [],
            city: city ? String(city) : undefined,
            stateOrProvinceCode: state ? String(state) : undefined,
            postalCode: String(zip),
            countryCode: String(country || 'US'),
          },
        },
      ],
    };

    const validateRes = await fetch(`${BASE}/address/v1/addresses/resolve`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'x-customer-transaction-id': `slpack-addr-${Date.now()}`,
        'x-locale': 'en_US',
      },
      body: JSON.stringify(payload),
    });

    if (!validateRes.ok) {
      const body = await validateRes.text();
      return NextResponse.json(
        { error: `FedEx address validation error (${validateRes.status})`, details: body },
        { status: validateRes.status }
      );
    }

    const data = await validateRes.json();
    const resolved = data?.output?.resolvedAddresses?.[0];

    if (!resolved) {
      const result: AddressValidationResult = {
        valid: false,
        status: 'UNRESOLVED',
        suggested: null,
        messages: ['No address match found'],
      };
      return NextResponse.json(result);
    }

    const classification: string = resolved?.classification ?? '';
    const attributes: Record<string, string> = resolved?.attributes ?? {};
    const isValid =
      classification === 'VALIDATED_STANDARDIZED_ADDRESS' ||
      classification === 'STANDARDIZED_ADDRESS' ||
      attributes['Resolved'] === 'true';

    // Extract suggested address from resolved response
    const suggestedStreet: string = resolved?.streetLinesToken?.[0] ?? '';
    const suggestedCity: string = resolved?.city ?? city ?? '';
    const suggestedState: string = resolved?.stateOrProvinceCode ?? state ?? '';
    const suggestedZip: string = resolved?.postalCode ?? zip;
    const suggestedCountry: string = resolved?.countryCode ?? country ?? 'US';

    // Build advisory messages from attributes
    const messages: string[] = [];
    if (attributes['DPV_Vacant'] === 'Y') messages.push('Address appears vacant');
    if (attributes['SuiteRequiredButMissing'] === 'true') messages.push('Suite/apt number may be required');
    if (attributes['AddressType'] === 'PO_BOX') messages.push('PO Box detected');
    if (!isValid) messages.push('Address could not be fully validated — verify before shipping');

    const result: AddressValidationResult = {
      valid: isValid,
      status: classification || (isValid ? 'VALIDATED' : 'UNRESOLVED'),
      suggested:
        suggestedStreet || suggestedCity || suggestedZip
          ? {
              streetLine: suggestedStreet,
              city: suggestedCity,
              state: suggestedState,
              zip: suggestedZip,
              country: suggestedCountry,
            }
          : null,
      messages,
    };

    return NextResponse.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
