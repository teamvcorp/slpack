import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { logAndRespond } from '@/lib/apiErrors';
import { appendError } from '@/lib/errorLog';
import { getFedexToken } from '@/lib/carrierTokens';
import { normalizePostal } from '@/lib/postal';

const ROUTE = 'shipping/fedex/validate';

const BASE = process.env.FEDEX_SANDBOX === 'false'
  ? 'https://apis.fedex.com'
  : 'https://apis-sandbox.fedex.com';

/**
 * FedEx caps stateOrProvinceCode at 2 characters (US/CA/MX/PR state codes), and
 * rejects anything longer with STATEORPROVINCECODE.TOO.LONG (400) — e.g. a
 * customer typing "Quintana Roo" instead of "QR". The field is optional for
 * address resolution (postal + country + city carry it), so send it only when it
 * is a plausible 2-letter code and omit it otherwise rather than failing the
 * whole validation. (fix 2026-09-10)
 */
function fedexStateCode(state: unknown): string | undefined {
  const s = String(state ?? '').trim().toUpperCase();
  return /^[A-Z]{2}$/.test(s) ? s : undefined;
}

export interface AddressValidationResult {
  valid: boolean;
  /** 'VALIDATED' | 'STANDARDIZED' | 'UNRESOLVED' */
  status: string;
  /** Business/residential classification (drives the residential surcharge). */
  addressType?: 'residential' | 'commercial' | 'unknown';
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
  let requestSummary: Record<string, unknown> | undefined;
  try {
    if (!process.env.FEDEX_CLIENT_ID || !process.env.FEDEX_CLIENT_SECRET) {
      return await logAndRespond({
        route: ROUTE,
        carrier: 'fedex',
        status: 503,
        message: 'FedEx credentials not configured',
      });
    }

    const { streetLine, city, state, zip, country } = await req.json();
    requestSummary = { zip, country, hasStreet: Boolean(streetLine), hasCity: Boolean(city), hasState: Boolean(state) };

    // FedEx sandbox always returns a hardcoded dummy address regardless of input.
    // Skip the API call in sandbox mode and validate locally instead.
    if (process.env.FEDEX_SANDBOX !== 'false') {
      const messages: string[] = [];
      if (!city) messages.push('City is recommended for accurate delivery');
      if (!state && (country === 'US' || !country)) messages.push('State/province is recommended');
      const valid = Boolean(zip && (streetLine || city));
      const result: AddressValidationResult = {
        valid,
        status: valid ? 'VALIDATED' : 'UNRESOLVED',
        suggested: null,
        messages,
      };
      return NextResponse.json(result);
    }

    if (!zip) {
      return await logAndRespond({
        route: ROUTE,
        carrier: 'fedex',
        status: 400,
        message: 'ZIP/postal code is required',
        requestSummary,
      });
    }

    const token = await getFedexToken();

    const payload = {
      addressesToValidate: [
        {
          address: {
            streetLines: streetLine ? [String(streetLine)] : [],
            city: city ? String(city) : undefined,
            stateOrProvinceCode: fedexStateCode(state),
            postalCode: normalizePostal(zip, country),
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
      // A 4xx here is bad ADDRESS INPUT (e.g. an unsupported/too-long state code
      // on an international address), not an outage. Don't hard-fail the counter
      // over it — record it for visibility and return a soft "unvalidated"
      // result so staff can verify and still ship. A 5xx (FedEx down) stays a
      // real, retryable error. (fix 2026-09-10)
      if (validateRes.status >= 400 && validateRes.status < 500) {
        try {
          await appendError({
            id: randomUUID(),
            timestamp: new Date().toISOString(),
            route: ROUTE,
            carrier: 'fedex',
            status: validateRes.status,
            message: `FedEx address validation could not process the address (${validateRes.status})`,
            upstreamStatus: validateRes.status,
            upstreamBody: body,
            requestSummary,
          });
        } catch {
          /* logging must never block the counter */
        }
        const soft: AddressValidationResult = {
          valid: false,
          status: 'UNRESOLVED',
          suggested: null,
          messages: ['Address could not be validated automatically — verify it before shipping.'],
        };
        return NextResponse.json(soft);
      }
      return await logAndRespond({
        route: ROUTE,
        carrier: 'fedex',
        status: validateRes.status,
        message: `FedEx address validation error (${validateRes.status})`,
        upstreamStatus: validateRes.status,
        upstreamBody: body,
        requestSummary,
      });
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

    // FedEx classification enum: BUSINESS | RESIDENTIAL | MIXED | UNKNOWN.
    // Map to our residential-surcharge flag; MIXED/UNKNOWN stay 'unknown' (user decides).
    const classUpper = classification.toUpperCase();
    const addressType: 'residential' | 'commercial' | 'unknown' =
      classUpper === 'BUSINESS' ? 'commercial' : classUpper === 'RESIDENTIAL' ? 'residential' : 'unknown';
    // Deliverability signals. FedEx returns attribute values as "true"/"false" strings.
    // (The old code compared `classification` to address-status strings, but that field
    //  actually holds BUSINESS/RESIDENTIAL — see addressType above — so validity now reads
    //  the real resolution attributes instead.)
    const attrTrue = (k: string) => String(attributes[k] ?? '').toLowerCase() === 'true';
    const resolvedOk = attrTrue('Resolved');
    const dpvRaw = attributes['DPV']; // Delivery Point Valid — the deliverability signal
    const dpvOk = dpvRaw === undefined || String(dpvRaw).toLowerCase() === 'true'; // absent ⇒ don't over-reject
    const interpolated = attrTrue('InterpolatedStreetAddress'); // street number estimated — may be wrong
    const suiteMissing = attrTrue('SuiteRequiredButMissing');
    const invalidSuite = attrTrue('InvalidSuiteNumber');

    // Fully deliverable only when resolved, delivery-point-valid, exact (not interpolated),
    // and free of suite problems. Flagging the rest here lets staff fix the address before
    // it ships — avoiding carrier address-correction fees and delivery delays downstream.
    const isValid = resolvedOk && dpvOk && !interpolated && !suiteMissing && !invalidSuite;

    // Extract suggested address from resolved response
    const suggestedStreet: string = resolved?.streetLinesToken?.[0] ?? '';
    const suggestedCity: string = resolved?.city ?? city ?? '';
    const suggestedState: string = resolved?.stateOrProvinceCode ?? state ?? '';
    const suggestedZip: string = resolved?.postalCode ?? zip;
    const suggestedCountry: string = resolved?.countryCode ?? country ?? 'US';

    // Build advisory messages from attributes
    const messages: string[] = [];
    if (attributes['DPV_Vacant'] === 'Y') messages.push('Address appears vacant');
    if (suiteMissing) messages.push('Suite/apt number may be required');
    if (invalidSuite) messages.push('Suite/apt number appears invalid');
    if (interpolated) messages.push('Street number is approximate — verify it before shipping');
    if (dpvRaw !== undefined && !dpvOk) messages.push('Not confirmed as a deliverable address');
    if (attributes['AddressType'] === 'PO_BOX') messages.push('PO Box detected');
    if (!isValid) messages.push('Address could not be fully validated — verify before shipping');

    const result: AddressValidationResult = {
      valid: isValid,
      status: isValid ? 'VALIDATED' : 'UNRESOLVED',
      addressType,
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
    return await logAndRespond({
      route: ROUTE,
      carrier: 'fedex',
      status: 500,
      message,
      requestSummary,
      err,
    });
  }
}
