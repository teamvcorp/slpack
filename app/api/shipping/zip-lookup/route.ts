import { NextRequest, NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import path from 'path';
import { logAndRespond } from '@/lib/apiErrors';
import { getUspsToken, BASE } from '@/lib/uspsToken';

/**
 * ZIP → city/state lookup.
 *
 * WHY: UPS cannot resolve every destination from the postal code alone and
 * answers 111539 / 111542 "Invalid Destination" (see the note in
 * app/api/shipping/ups/route.ts — 78133 Canyon Lake TX is the known example).
 * Supplying City + StateProvinceCode fixes it, but the box-size calculator only
 * asks the operator for a ZIP. This route fills the gap so counter staff never
 * have to know that.
 *
 * OFFLINE FIRST, deliberately. Both carrier-provided alternatives are dead ends
 * for this shop today:
 *   - USPS Addresses API returns 403 "Addresses API Access Controls" — USPS
 *     gated it on 2026-08-01 and the account has no Addresses licence yet.
 *   - FedEx address resolve is unusable in sandbox: fedex/validate short-
 *     circuits because the sandbox returns a hardcoded dummy address.
 * A local table also means no per-quote latency, no rate limit, and no
 * dependency on a carrier being reachable while a customer waits at the counter.
 *
 * The USPS call is kept as an upgrade path: it runs only for ZIPs missing from
 * the local table, and starts working automatically if the shop adds the
 * Addresses API licence (Business Portal → My Account → API Licences).
 *
 * Dataset: data/zipCityState.json — 40,979 US ZIPs, built from the GeoNames
 * US postal-code export (CC BY 4.0), generated 2026-08-13. Server-side only;
 * never shipped to the client. Refresh yearly — ZIP assignments change slowly.
 *
 * Auth: /api/* is session-gated by proxy.ts, so this inherits admin auth.
 */

export const runtime = 'nodejs';

const ROUTE = 'shipping/zip-lookup';

type ZipTable = Record<string, [city: string, state: string]>;

let CACHE: ZipTable | null = null;

async function loadTable(): Promise<ZipTable> {
  if (CACHE) return CACHE;
  const file = path.join(process.cwd(), 'data', 'zipCityState.json');
  CACHE = JSON.parse(await readFile(file, 'utf8')) as ZipTable;
  return CACHE;
}

/** Last-resort USPS lookup for ZIPs the local table doesn't carry. */
async function uspsCityState(zip: string): Promise<{ city: string; state: string } | null> {
  if (!process.env.USPS_CLIENT_ID || !process.env.USPS_CLIENT_SECRET) return null;
  try {
    const token = await getUspsToken('addresses');
    const res = await fetch(`${BASE}/addresses/v3/city-state?ZIPCode=${encodeURIComponent(zip)}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { city?: string; state?: string };
    return data.city && data.state ? { city: data.city, state: data.state } : null;
  } catch {
    // Never let an optional enrichment break the lookup.
    return null;
  }
}

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get('zip') ?? '';
  // Accept ZIP or ZIP+4, use the 5-digit base. Strict allowlist — this value is
  // interpolated into an upstream URL, so never pass arbitrary input through.
  const zip = raw.trim().slice(0, 5);
  if (!/^\d{5}$/.test(zip)) {
    return NextResponse.json({ error: 'Enter a 5-digit ZIP code.' }, { status: 400 });
  }

  try {
    const table = await loadTable();
    const local = table[zip];
    if (local) {
      return NextResponse.json({ zip, city: local[0], state: local[1], source: 'local' });
    }

    const usps = await uspsCityState(zip);
    if (usps) {
      return NextResponse.json({ zip, city: usps.city, state: usps.state, source: 'usps' });
    }

    // An unknown ZIP is a normal outcome, not a server fault — the caller
    // degrades to manual entry rather than showing a red error.
    return NextResponse.json({ error: 'No city found for that ZIP.' }, { status: 404 });
  } catch (err: unknown) {
    return await logAndRespond({
      route: ROUTE,
      status: 500,
      message: 'ZIP lookup failed',
      err,
      requestSummary: { zip },
    });
  }
}
