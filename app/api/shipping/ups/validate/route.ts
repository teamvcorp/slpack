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
      return NextResponse.json(
        { error: 'UPS credentials not configured' },
        { status: 503 }
      );
    }

    const { streetLine, city, state, zip, country } = await req.json();

    if (!zip) {
      return NextResponse.json({ error: 'ZIP/postal code is required' }, { status: 400 });
    }

    // UPS Address Validation API only supports US addresses
    const countryCode = String(country || 'US').toUpperCase();
    if (countryCode !== 'US') {
      return NextResponse.json({
        valid: true,
        status: 'SKIPPED',
        suggested: null,
        messages: ['UPS address validation is only available for US addresses'],
      });
    }

    const token = await getToken();

    // Use RequestOption 3 (street-level) when a street is provided, else 1 (ZIP/city lookup)
    const requestOption = streetLine ? '3' : '1';
    const addrKeyFormat: Record<string, unknown> = {
      PostcodePrimaryLow: String(zip),
      CountryCode: countryCode,
    };
    if (streetLine) addrKeyFormat.AddressLine = [String(streetLine)];
    if (city) addrKeyFormat.PoliticalDivision2 = String(city);
    if (state) addrKeyFormat.PoliticalDivision1 = String(state);

    const payload = {
      XAVRequest: {
        Request: {
          RequestOption: requestOption,
          TransactionReference: { CustomerContext: 'slpack-addr-validate' },
        },
        AddressKeyFormat: addrKeyFormat,
      },
    };

    const validateRes = await fetch(`${BASE}/api/addressvalidation/v2/${requestOption}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        transId: `slpack-${Date.now()}`,
        transactionSrc: 'slpack',
      },
      body: JSON.stringify(payload),
    });

    if (!validateRes.ok) {
      const body = await validateRes.text();
      return NextResponse.json(
        { error: `UPS address validation error (${validateRes.status})`, details: body },
        { status: validateRes.status }
      );
    }

    const data = await validateRes.json();
    const response = data?.XAVResponse;
    const candidates = response?.Candidate ?? [];
    const candidateList = Array.isArray(candidates) ? candidates : [candidates];

    // NoCandidatesIndicator means no match found
    if (response?.NoCandidatesIndicator !== undefined) {
      return NextResponse.json({
        valid: false,
        status: 'UNRESOLVED',
        suggested: null,
        messages: ['No address match found — verify street, city, and ZIP'],
      });
    }

    const isValidated = response?.ValidAddressIndicator !== undefined;
    const isAmbiguous = response?.AmbiguousAddressIndicator !== undefined;

    const best = candidateList[0];
    const addr = best?.AddressKeyFormat;

    const suggestedStreet: string = Array.isArray(addr?.AddressLine)
      ? addr.AddressLine[0]
      : (addr?.AddressLine ?? '');
    const suggestedCity: string = addr?.PoliticalDivision2 ?? city ?? '';
    const suggestedState: string = addr?.PoliticalDivision1 ?? state ?? '';
    const suggestedZip: string = addr?.PostcodePrimaryLow ?? zip;
    const suggestedCountry: string = addr?.CountryCode ?? countryCode;

    const messages: string[] = [];
    if (isAmbiguous) messages.push(`${candidateList.length} possible matches — review suggestion`);
    if (!isValidated && !isAmbiguous) messages.push('Address could not be fully validated — verify before shipping');

    // Only show suggested if it differs from what was entered
    const hasSuggestion =
      suggestedStreet || suggestedCity !== city || suggestedState !== state || suggestedZip !== zip;

    return NextResponse.json({
      valid: isValidated,
      status: isValidated ? 'VALIDATED' : isAmbiguous ? 'AMBIGUOUS' : 'UNRESOLVED',
      suggested: hasSuggestion
        ? {
            streetLine: suggestedStreet,
            city: suggestedCity,
            state: suggestedState,
            zip: suggestedZip,
            country: suggestedCountry,
          }
        : null,
      messages,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
