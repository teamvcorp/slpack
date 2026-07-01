import { NextRequest, NextResponse } from 'next/server';
import { logAndRespond } from '@/lib/apiErrors';
import { getUpsToken } from '@/lib/carrierTokens';
import { normalizePostal } from '@/lib/postal';

const ROUTE = 'shipping/ups/validate';

const BASE = process.env.UPS_SANDBOX === 'false'
  ? 'https://onlinetools.ups.com'
  : 'https://wwwcie.ups.com';

export async function POST(req: NextRequest) {
  let requestSummary: Record<string, unknown> | undefined;
  try {
    if (!process.env.UPS_CLIENT_ID || !process.env.UPS_CLIENT_SECRET) {
      return await logAndRespond({
        route: ROUTE,
        carrier: 'ups',
        status: 503,
        message: 'UPS credentials not configured',
      });
    }

    const { streetLine, city, state, zip, country } = await req.json();
    requestSummary = { zip, country, hasStreet: Boolean(streetLine), hasCity: Boolean(city), hasState: Boolean(state) };

    if (!zip) {
      return await logAndRespond({
        route: ROUTE,
        carrier: 'ups',
        status: 400,
        message: 'ZIP/postal code is required',
        requestSummary,
      });
    }

    // UPS Address Validation API only supports US addresses
    const countryCode = String(country || 'US').toUpperCase();
    if (countryCode !== 'US') {
      return NextResponse.json({
        valid: true,
        status: 'SKIPPED',
        addressType: 'unknown',
        suggested: null,
        messages: ['UPS address validation is only available for US addresses'],
      });
    }

    const token = await getUpsToken();

    // Use RequestOption 3 (street-level) when a street is provided, else 1 (ZIP/city lookup)
    const requestOption = streetLine ? '3' : '1';
    const addrKeyFormat: Record<string, unknown> = {
      PostcodePrimaryLow: normalizePostal(zip, countryCode),
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
      return await logAndRespond({
        route: ROUTE,
        carrier: 'ups',
        status: validateRes.status,
        message: `UPS address validation error (${validateRes.status})`,
        upstreamStatus: validateRes.status,
        upstreamBody: body,
        requestSummary,
      });
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
        addressType: 'unknown',
        suggested: null,
        messages: ['No address match found — verify street, city, and ZIP'],
      });
    }

    const isValidated = response?.ValidAddressIndicator !== undefined;
    const isAmbiguous = response?.AmbiguousAddressIndicator !== undefined;

    const best = candidateList[0];
    const addr = best?.AddressKeyFormat;

    // UPS AddressClassification: Code 1 = Commercial, 2 = Residential, 0/absent = unknown.
    // Only returned for street-level lookups (RequestOption 3, i.e. when a street is supplied).
    const upsClassCode = String(
      best?.AddressClassification?.Code ?? response?.AddressClassification?.Code ?? ''
    );
    const addressType: 'residential' | 'commercial' | 'unknown' =
      upsClassCode === '1' ? 'commercial' : upsClassCode === '2' ? 'residential' : 'unknown';

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
      addressType,
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
