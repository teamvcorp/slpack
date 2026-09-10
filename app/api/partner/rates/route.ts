import { NextResponse } from 'next/server';
import { withPartnerAuth } from '@/lib/partnerAuth';
import { logPartnerEvent } from '@/lib/partnerApiLog';
import { quotePartnerRates } from '@/lib/partnerRates';
import { PARTNER_QUOTE_TTL_MS, type PartnerMode } from '@/lib/partnerQuoteStore';

/**
 * POST /api/partner/rates — quote a shipment for a partner (retail only).
 *
 * The origin is always the shop (forced server-side in lib/partnerRates.ts); the
 * caller sends only destination + package + mode. Every rate carries a single-use
 * quoteId the caller pays against; NO cost, list price, rate source, or margin is
 * ever in the response. Contract: PARTNER_API.md §4.
 */
export const runtime = 'nodejs';

const ROUTE = 'partner/rates';

/** A 422 with the offending field, per the documented error shape. */
function invalid(field: string, message: string): NextResponse {
  return NextResponse.json({ error: message, field }, { status: 422 });
}

const isPosNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;

export const POST = withPartnerAuth(ROUTE, async (req, { partner, ip, keyId }) => {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return invalid('body', 'Request body must be JSON.');
  }

  const destination = (body as Record<string, unknown>).destination as Record<string, unknown> | undefined;
  const pkg = (body as Record<string, unknown>).package as Record<string, unknown> | undefined;
  const mode = (body as Record<string, unknown>).mode;

  if (mode !== 'self_ship' && mode !== 'pickup_pack') {
    return invalid('mode', 'mode must be "self_ship" or "pickup_pack".');
  }
  if (!destination || typeof destination !== 'object') {
    return invalid('destination', 'destination is required.');
  }
  if (!pkg || typeof pkg !== 'object') {
    return invalid('package', 'package is required.');
  }

  // Destination — US domestic only in v1. ZIP required; city/state recommended.
  const zip = String(destination.zip ?? '').trim();
  if (!/^\d{5}(-\d{4})?$/.test(zip)) {
    return invalid('destination.zip', 'destination.zip must be a 5-digit US ZIP (ZIP+4 allowed).');
  }
  const country = String(destination.country ?? 'US').trim().toUpperCase() || 'US';
  if (country !== 'US') {
    return invalid('destination.country', 'Only US domestic shipments are supported in v1.');
  }

  // Package — all four measurements required and positive.
  const weightLbs = Number(pkg.weightLbs);
  const lengthIn = Number(pkg.lengthIn);
  const widthIn = Number(pkg.widthIn);
  const heightIn = Number(pkg.heightIn);
  if (!isPosNum(weightLbs)) return invalid('package.weightLbs', 'package.weightLbs must be a number greater than 0.');
  if (!isPosNum(lengthIn)) return invalid('package.lengthIn', 'package.lengthIn must be a number greater than 0.');
  if (!isPosNum(widthIn)) return invalid('package.widthIn', 'package.widthIn must be a number greater than 0.');
  if (!isPosNum(heightIn)) return invalid('package.heightIn', 'package.heightIn must be a number greater than 0.');

  const dest = {
    zip,
    city: destination.city ? String(destination.city).trim().slice(0, 60) : undefined,
    state: destination.state ? String(destination.state).trim().slice(0, 2).toUpperCase() : undefined,
    country,
    residential: destination.residential === true,
  };
  const parcel = { weightLbs, lengthIn, widthIn, heightIn };

  const rates = await quotePartnerRates({
    partnerId: partner.partnerId,
    dest,
    pkg: parcel,
    mode: mode as PartnerMode,
  });

  if (rates.length === 0) {
    // No carrier could price this parcel/lane — a retryable upstream condition.
    await logPartnerEvent({
      ok: false, route: ROUTE, ip, keyId, partnerId: partner.partnerId, status: 502,
      reason: 'no_rates', meta: { zip, mode },
    });
    return NextResponse.json(
      { error: 'No carrier could rate this shipment right now. Please retry.' },
      { status: 502 }
    );
  }

  await logPartnerEvent({
    ok: true, route: ROUTE, ip, keyId, partnerId: partner.partnerId, status: 200,
    meta: { zip, mode, count: rates.length },
  });

  return NextResponse.json({
    quoteExpiresInSeconds: Math.floor(PARTNER_QUOTE_TTL_MS / 1000),
    rates,
  });
});
