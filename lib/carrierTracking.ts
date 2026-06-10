import type { CarrierKey } from '@/app/admin/types/shipping';
import { getFedexToken, getUpsToken } from '@/lib/carrierTokens';

/**
 * Per-carrier tracking helpers. Each `check*` returns whether the carrier has
 * recorded any pickup / acceptance / origin scan event for the tracking number.
 *
 * "Accepted" semantics (= billable):
 *   - FedEx: any event other than "Label created" / "Shipment information sent"
 *   - UPS:   any activity status other than "M" (Manifest Pickup) without scans
 *   - USPS:  any event after "Pre-Shipment Info Sent / USPS Awaiting Item"
 *
 * On any error or unknown shape, returns `{ accepted: false }` and lets the
 * caller decide whether to retry. Callers should treat this as best-effort —
 * tracking lag of several hours is normal.
 */

export interface AcceptanceResult {
  accepted: boolean;
  acceptedAt?: string; // ISO
  reason?: string;     // human-readable when not accepted
}

const FEDEX_BASE = process.env.FEDEX_SANDBOX === 'false'
  ? 'https://apis.fedex.com'
  : 'https://apis-sandbox.fedex.com';

const UPS_BASE = process.env.UPS_SANDBOX === 'false'
  ? 'https://onlinetools.ups.com'
  : 'https://wwwcie.ups.com';

const USPS_BASE = process.env.USPS_SANDBOX === 'true'
  ? 'https://apis-tem.usps.com'
  : 'https://api.usps.com';

async function uspsToken(): Promise<string> {
  const res = await fetch(`${USPS_BASE}/oauth2/v3/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: process.env.USPS_CLIENT_ID!,
      client_secret: process.env.USPS_CLIENT_SECRET!,
    }),
  });
  if (!res.ok) throw new Error(`USPS auth failed: ${res.status}`);
  return (await res.json()).access_token as string;
}

async function checkFedex(trackingNumber: string): Promise<AcceptanceResult> {
  if (!process.env.FEDEX_CLIENT_ID || !process.env.FEDEX_CLIENT_SECRET) {
    return { accepted: false, reason: 'FedEx credentials not configured' };
  }
  try {
    const token = await getFedexToken();
    const res = await fetch(`${FEDEX_BASE}/track/v1/trackingnumbers`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-locale': 'en_US',
      },
      body: JSON.stringify({
        trackingInfo: [{ trackingNumberInfo: { trackingNumber } }],
        includeDetailedScans: true,
      }),
    });
    if (!res.ok) return { accepted: false, reason: `FedEx track ${res.status}` };
    const data = await res.json();
    const events: Array<{ eventType?: string; date?: string; derivedStatus?: string }> =
      data?.output?.completeTrackResults?.[0]?.trackResults?.[0]?.scanEvents ?? [];

    // Any event whose type isn't "OC" (Order Created / Label issued) means the
    // carrier has the package.
    const acceptScan = events.find((e) => e.eventType && e.eventType !== 'OC');
    if (acceptScan) {
      return { accepted: true, acceptedAt: acceptScan.date };
    }
    return { accepted: false, reason: 'Label only — no carrier scans yet' };
  } catch (err) {
    return { accepted: false, reason: err instanceof Error ? err.message : 'FedEx error' };
  }
}

async function checkUps(trackingNumber: string): Promise<AcceptanceResult> {
  if (!process.env.UPS_CLIENT_ID || !process.env.UPS_CLIENT_SECRET) {
    return { accepted: false, reason: 'UPS credentials not configured' };
  }
  try {
    const token = await getUpsToken();
    const res = await fetch(
      `${UPS_BASE}/api/track/v1/details/${encodeURIComponent(trackingNumber)}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          transId: `track-${Date.now()}`,
          transactionSrc: 'slpack',
          Accept: 'application/json',
        },
      }
    );
    if (!res.ok) return { accepted: false, reason: `UPS track ${res.status}` };
    const data = await res.json();
    const activities: Array<{ status?: { type?: string; description?: string }; date?: string; time?: string }> =
      data?.trackResponse?.shipment?.[0]?.package?.[0]?.activity ?? [];

    // UPS "M" = Manifest Pickup (label scanned at our store / shipper location).
    // Any activity present (other than empty) means the carrier has the package.
    const acceptScan = activities.find((a) => a.status?.type && a.status.type !== 'X');
    if (acceptScan) {
      const dateStr = acceptScan.date ? `${acceptScan.date}${acceptScan.time ?? ''}` : undefined;
      // UPS dates come as YYYYMMDD/HHmmss — best-effort parse
      let iso: string | undefined;
      if (dateStr && /^\d{8}/.test(dateStr)) {
        const y = dateStr.slice(0, 4);
        const m = dateStr.slice(4, 6);
        const d = dateStr.slice(6, 8);
        const hh = dateStr.slice(8, 10) || '00';
        const mm = dateStr.slice(10, 12) || '00';
        const ss = dateStr.slice(12, 14) || '00';
        iso = new Date(`${y}-${m}-${d}T${hh}:${mm}:${ss}Z`).toISOString();
      }
      return { accepted: true, acceptedAt: iso };
    }
    return { accepted: false, reason: 'No UPS scans yet' };
  } catch (err) {
    return { accepted: false, reason: err instanceof Error ? err.message : 'UPS error' };
  }
}

async function checkUsps(trackingNumber: string): Promise<AcceptanceResult> {
  if (!process.env.USPS_CLIENT_ID || !process.env.USPS_CLIENT_SECRET) {
    return { accepted: false, reason: 'USPS credentials not configured' };
  }
  try {
    const token = await uspsToken();
    const res = await fetch(
      `${USPS_BASE}/tracking/v3/tracking/${encodeURIComponent(trackingNumber)}?expand=DETAIL`,
      { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } }
    );
    if (!res.ok) return { accepted: false, reason: `USPS track ${res.status}` };
    const data = await res.json();
    const events: Array<{ eventType?: string; eventCode?: string; eventTimestamp?: string }> =
      data?.trackingEvents ?? data?.events ?? [];

    // USPS pre-shipment events that DO NOT count as accepted:
    //   "Shipping Label Created, USPS Awaiting Item", "Pre-Shipment Info Sent"
    const PRE_SHIPMENT = /awaiting item|pre-shipment|label created/i;
    const acceptScan = events.find((e) => e.eventType && !PRE_SHIPMENT.test(e.eventType));
    if (acceptScan) {
      return { accepted: true, acceptedAt: acceptScan.eventTimestamp };
    }
    return { accepted: false, reason: 'USPS awaiting item' };
  } catch (err) {
    return { accepted: false, reason: err instanceof Error ? err.message : 'USPS error' };
  }
}

export async function checkAcceptance(
  carrier: CarrierKey,
  trackingNumber: string
): Promise<AcceptanceResult> {
  if (carrier === 'fedex') return checkFedex(trackingNumber);
  if (carrier === 'ups') return checkUps(trackingNumber);
  if (carrier === 'usps') return checkUsps(trackingNumber);
  // DHL not implemented — treat as not accepted; operator can mark manually.
  return { accepted: false, reason: `Tracking not implemented for ${carrier}` };
}
