import { NextResponse } from 'next/server';
import { withPartnerAuth } from '@/lib/partnerAuth';
import { logPartnerEvent } from '@/lib/partnerApiLog';
import { INTERNAL_HEADER, internalApiToken } from '@/lib/internalAuth';
import { SITE } from '@/lib/siteConfig';
import {
  getValidPartnerQuote,
  consumePartnerQuote,
  type PartnerQuote,
} from '@/lib/partnerQuoteStore';
import {
  appendPartnerShipment,
  getPartnerShipmentByQuote,
  getPartnerShipmentByPaymentIntent,
  listPartnerShipments,
  type PartnerShipment,
  type PartnerShipmentRecipient,
} from '@/lib/partnerShipmentLog';
import { sendPartnerLabelEmail, sendPartnerPickupNotice } from '@/lib/partnerEmail';
import { randomUUID } from 'crypto';

/**
 * /api/partner/shipments
 *   POST — create a shipment for a PAID quote (self_ship or pickup_pack).
 *   GET  — the partner's own history (retail only, scoped to them).
 *
 * A label is only ever produced after the Stripe PaymentIntent is verified
 * (succeeded, on the shared account, covering the quote's retail, and — when
 * present — its metadata.quoteId matching). Origin/carrier-account/price are all
 * server-forced; the caller supplies only destination + recipient. Contract:
 * PARTNER_API.md §5–6.
 */
export const runtime = 'nodejs';

const ROUTE = 'partner/shipments';
const VALID_CARRIERS = new Set(['ups', 'fedex', 'usps']);

function baseUrl(): string {
  return process.env.NEXT_PUBLIC_BASE_URL ?? 'http://localhost:3000';
}

const zip5 = (z: unknown) => String(z ?? '').trim().slice(0, 5);

function invalid(field: string, message: string): NextResponse {
  return NextResponse.json({ error: message, field }, { status: 422 });
}

/** The API response for a completed shipment — also used for idempotent replay. */
function shipmentResponse(s: PartnerShipment): Record<string, unknown> {
  if (s.status === 'shipped') {
    return {
      id: s.id,
      status: 'shipped',
      carrier: s.carrier,
      serviceName: s.serviceName,
      trackingNumber: s.trackingNumber,
      labelEmailedTo: s.businessEmail,
    };
  }
  if (s.status === 'awaiting_pack') {
    return { id: s.id, status: 'awaiting_pack' };
  }
  // needs_review — label failed after payment; the shop was notified.
  return {
    id: s.id,
    status: 'needs_review',
    message: 'The label could not be created automatically. The shop has been notified and will complete this shipment.',
  };
}

export const POST = withPartnerAuth(ROUTE, async (req, { partner, ip, keyId }) => {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') return invalid('body', 'Request body must be JSON.');
  const b = body as Record<string, unknown>;

  const quoteId = String(b.quoteId ?? '').trim();
  const paymentIntentId = String(b.paymentIntentId ?? '').trim();
  const mode = b.mode;
  const orderRef = b.orderRef ? String(b.orderRef).trim().slice(0, 120) : undefined;
  const recipientRaw = b.recipient as Record<string, unknown> | undefined;

  if (!quoteId) return invalid('quoteId', 'quoteId is required.');
  if (!paymentIntentId) return invalid('paymentIntentId', 'paymentIntentId is required.');
  if (mode !== 'self_ship' && mode !== 'pickup_pack') {
    return invalid('mode', 'mode must be "self_ship" or "pickup_pack".');
  }

  // ── Idempotent replay ────────────────────────────────────────────────────
  // A retry (including a lost-response retry) of a quote that already produced a
  // shipment returns the SAME result — never a second label.
  const existing = await getPartnerShipmentByQuote(partner.partnerId, quoteId);
  if (existing) {
    await logPartnerEvent({
      ok: true, route: ROUTE, ip, keyId, partnerId: partner.partnerId, status: 200,
      reason: 'idempotent_replay', meta: { quoteId, status: existing.status },
    });
    const status = existing.status === 'needs_review' ? 502 : 200;
    return NextResponse.json(shipmentResponse(existing), { status });
  }

  // ── Validate the quote ───────────────────────────────────────────────────
  const quote = await getValidPartnerQuote(partner.partnerId, quoteId);
  if (!quote) {
    await logPartnerEvent({
      ok: false, route: ROUTE, ip, keyId, partnerId: partner.partnerId, status: 409,
      reason: 'quote_invalid', meta: { quoteId },
    });
    return NextResponse.json(
      { error: 'Quote is expired, already used, or unknown. Request a fresh quote.' },
      { status: 409 }
    );
  }
  if (mode !== quote.mode) {
    return invalid('mode', `mode must match the quote (${quote.mode}).`);
  }

  // ── Validate the recipient ───────────────────────────────────────────────
  if (!recipientRaw || typeof recipientRaw !== 'object') {
    return invalid('recipient', 'recipient is required.');
  }
  const name = String(recipientRaw.name ?? '').trim();
  const street = String(recipientRaw.street ?? '').trim();
  const city = String(recipientRaw.city ?? '').trim();
  const state = String(recipientRaw.state ?? '').trim().toUpperCase();
  const rzip = String(recipientRaw.zip ?? '').trim();
  if (!name) return invalid('recipient.name', 'recipient.name is required.');
  if (!street) return invalid('recipient.street', 'recipient.street is required.');
  if (!city) return invalid('recipient.city', 'recipient.city is required.');
  if (!/^[A-Z]{2}$/.test(state)) return invalid('recipient.state', 'recipient.state must be a 2-letter state.');
  if (zip5(rzip) !== zip5(quote.dest.zip)) {
    return invalid('recipient.zip', 'recipient.zip must match the ZIP that was quoted.');
  }

  const recipient: PartnerShipmentRecipient = {
    name: name.slice(0, 80),
    phone: recipientRaw.phone ? String(recipientRaw.phone).trim().slice(0, 30) : undefined,
    email: recipientRaw.email ? String(recipientRaw.email).trim().slice(0, 200) : undefined,
    street: street.slice(0, 100),
    street2: recipientRaw.street2 ? String(recipientRaw.street2).trim().slice(0, 100) : undefined,
    city: city.slice(0, 60),
    state,
    zip: rzip.slice(0, 10),
    country: 'US',
  };

  // self_ship needs a destination for the label email; fall back to the
  // partner's registered business email.
  const businessEmail =
    (b.businessEmail ? String(b.businessEmail).trim().slice(0, 200) : '') || partner.businessEmail;
  if (mode === 'self_ship' && !businessEmail) {
    return invalid('businessEmail', 'businessEmail is required for self_ship (the label is emailed there).');
  }

  // ── Verify payment ───────────────────────────────────────────────────────
  // One PaymentIntent binds to one shipment: a PI already spent on another quote
  // cannot be replayed to mint more labels off a single charge.
  const piReuse = await getPartnerShipmentByPaymentIntent(partner.partnerId, paymentIntentId);
  if (piReuse) {
    await logPartnerEvent({
      ok: false, route: ROUTE, ip, keyId, partnerId: partner.partnerId, status: 402,
      reason: 'pi_reused', meta: { quoteId, paymentIntentId },
    });
    return NextResponse.json(
      { error: 'This payment has already been used for another shipment.' },
      { status: 402 }
    );
  }

  const paymentError = await verifyPayment(paymentIntentId, quote);
  if (paymentError) {
    await logPartnerEvent({
      ok: false, route: ROUTE, ip, keyId, partnerId: partner.partnerId, status: 402,
      reason: paymentError, meta: { quoteId, paymentIntentId },
    });
    return NextResponse.json(
      { error: 'Payment could not be verified for this shipment.' },
      { status: 402 }
    );
  }

  // ── Claim the quote atomically (single-mint guard) ───────────────────────
  const claimed = await consumePartnerQuote(partner.partnerId, quoteId);
  if (!claimed) {
    // Lost a concurrent race; the winner may have just written the shipment.
    const winner = await getPartnerShipmentByQuote(partner.partnerId, quoteId);
    if (winner) return NextResponse.json(shipmentResponse(winner), { status: winner.status === 'needs_review' ? 502 : 200 });
    return NextResponse.json(
      { error: 'Quote is expired or already used. Request a fresh quote.' },
      { status: 409 }
    );
  }

  const id = `shp_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
  const baseRecord: PartnerShipment = {
    id,
    partnerId: partner.partnerId,
    createdAt: new Date(),
    mode: quote.mode,
    status: 'awaiting_pack', // overwritten per branch below
    carrier: quote.carrier,
    serviceName: quote.serviceName,
    serviceCode: quote.serviceCode,
    retailUSD: quote.retailUSD,
    freightRetailUSD: quote.freightRetailUSD,
    packingFeeUSD: quote.packingFeeUSD,
    paymentIntentId,
    quoteId,
    orderRef,
    businessEmail: mode === 'self_ship' ? businessEmail : undefined,
    recipient,
  };

  // ── pickup_pack: no label; notify the shop ───────────────────────────────
  if (quote.mode === 'pickup_pack') {
    const record: PartnerShipment = { ...baseRecord, status: 'awaiting_pack' };
    await appendPartnerShipment(record);
    void sendPartnerPickupNotice(record, partner.displayName);
    await logPartnerEvent({
      ok: true, route: ROUTE, ip, keyId, partnerId: partner.partnerId, status: 200,
      reason: 'awaiting_pack', meta: { id, quoteId },
    });
    return NextResponse.json(shipmentResponse(record));
  }

  // ── self_ship: mint the label on the shop's carrier account ──────────────
  if (!VALID_CARRIERS.has(quote.carrier)) {
    // Should never happen (quotes are created only for these carriers).
    const record: PartnerShipment = { ...baseRecord, status: 'needs_review' };
    await appendPartnerShipment(record);
    return NextResponse.json(shipmentResponse(record), { status: 502 });
  }

  const label = await mintLabel(quote, recipient);
  if (label.ok) {
    const record: PartnerShipment = {
      ...baseRecord,
      status: 'shipped',
      trackingNumber: label.trackingNumber,
      labelBase64: label.labelBase64 ?? undefined,
      labelMimeType: label.labelMimeType ?? undefined,
      carrierCostUSD: label.carrierCostUSD ?? undefined,
    };
    await appendPartnerShipment(record);
    const emailed = await sendPartnerLabelEmail(businessEmail, record);
    await logPartnerEvent({
      ok: true, route: ROUTE, ip, keyId, partnerId: partner.partnerId, status: 200,
      reason: emailed ? 'shipped' : 'shipped_email_failed',
      meta: { id, quoteId, trackingNumber: label.trackingNumber },
    });
    return NextResponse.json(shipmentResponse(record));
  }

  // Label failed after a verified payment. Do NOT release the quote (that would
  // risk an automated double-mint on a lost-response retry). Record for manual
  // completion and notify the shop; the consumer is never left paid with nothing.
  const record: PartnerShipment = { ...baseRecord, status: 'needs_review' };
  await appendPartnerShipment(record);
  void sendPartnerPickupNotice(record, partner.displayName);
  await logPartnerEvent({
    ok: false, route: ROUTE, ip, keyId, partnerId: partner.partnerId, status: 502,
    reason: 'label_failed', meta: { id, quoteId, detail: label.error?.slice(0, 200) },
  });
  return NextResponse.json(shipmentResponse(record), { status: 502 });
});

export const GET = withPartnerAuth(ROUTE, async (req, { partner }) => {
  const url = new URL(req.url);
  const limit = Number(url.searchParams.get('limit') ?? '50');
  const shipments = await listPartnerShipments(partner.partnerId, limit);
  return NextResponse.json({ shipments });
});

/**
 * Verify the PaymentIntent covers this quote. Returns a short reason string on
 * failure, or null when the payment is good. Retrieving with the shared account
 * key means a PI created on another Stripe account simply isn't found → failure.
 */
async function verifyPayment(paymentIntentId: string, quote: PartnerQuote): Promise<string | null> {
  try {
    const Stripe = (await import('stripe')).default;
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? '', {
      apiVersion: '2025-02-24.acacia',
    });
    const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
    if (pi.status !== 'succeeded') return 'not_succeeded';
    if (pi.currency && pi.currency.toLowerCase() !== 'usd') return 'wrong_currency';
    const requiredCents = Math.round(quote.retailUSD * 100);
    const paidCents = Number(pi.amount_received ?? 0);
    if (paidCents + 1 < requiredCents) return 'underpaid';
    // metadata.quoteId is recommended, not required: enforce it only if present.
    const stamped = typeof pi.metadata?.quoteId === 'string' ? pi.metadata.quoteId : '';
    if (stamped && stamped !== quote.quoteId) return 'quote_mismatch';
    return null;
  } catch {
    return 'retrieve_failed';
  }
}

interface LabelResult {
  ok: boolean;
  trackingNumber?: string;
  labelBase64?: string | null;
  labelMimeType?: string | null;
  carrierCostUSD?: number | null;
  error?: string;
}

/** Mint the label via the existing carrier label route (origin forced to shop). */
async function mintLabel(quote: PartnerQuote, recipient: PartnerShipmentRecipient): Promise<LabelResult> {
  const shipment = {
    // Shipper = the shop; origin forced. senderName omitted → route defaults it.
    originZip: SITE.address.postalCode,
    customerName: recipient.name,
    customerPhone: recipient.phone ?? '',
    customerEmail: recipient.email ?? '',
    destStreet: recipient.street,
    destStreet2: recipient.street2 ?? '',
    destCity: recipient.city,
    destState: recipient.state,
    destZip: recipient.zip,
    destCountry: 'US',
    residential: quote.dest.residential,
    weightLbs: quote.pkg.weightLbs,
    lengthIn: quote.pkg.lengthIn,
    widthIn: quote.pkg.widthIn,
    heightIn: quote.pkg.heightIn,
  };

  let lastError = 'Label generation failed';
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetch(`${baseUrl()}/api/shipping/${quote.carrier}/label`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', [INTERNAL_HEADER]: internalApiToken() },
        body: JSON.stringify({
          shipment,
          serviceCode: quote.serviceCode,
          insurance: { enabled: false },
          saturdayDelivery: false,
          simpleRateTier: null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        return {
          ok: true,
          trackingNumber: data.trackingNumber ?? 'PENDING',
          labelBase64: data.labelBase64 ?? null,
          labelMimeType: data.labelMimeType ?? null,
          carrierCostUSD: Number.isFinite(Number(data.carrierCostUSD)) ? Number(data.carrierCostUSD) : null,
        };
      }
      lastError = (data.error ?? `Label API error (${res.status})`) + (data.details ? ` — ${data.details}` : '');
    } catch (err: unknown) {
      lastError = err instanceof Error ? err.message : 'Label generation failed';
    }
  }
  return { ok: false, error: lastError };
}
