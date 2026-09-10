import client, { IGNORE_UNDEFINED } from '@/lib/mongodb';
import type { PartnerMode } from '@/lib/partnerQuoteStore';

/**
 * Partner shipment records (2026-09-10).
 *
 * A SEPARATE collection from the counter's `shipments` — a partner-path bug can
 * never corrupt the counter's revenue book or its reports (honoring the hard
 * "separate, no impact" constraint). The counter reports read `shipments`; this
 * is read only by the partner history endpoint and a dedicated admin view.
 *
 * Cost fields (carrierCostUSD) and the label bytes are stored for the SHOP's
 * reconciliation and re-email, but the partner-facing projection excludes them:
 * a partner only ever sees retail.
 */
const DB = 'slpack';
const COLLECTION = 'partnerShipments';

/**
 * shipped        — self_ship label minted & emailed.
 * awaiting_pack  — pickup_pack: shop will collect, pack, and label.
 * needs_review   — self_ship where the carrier label FAILED after a verified
 *                  payment. The quote stays consumed (no automated double-mint);
 *                  the shop was notified and completes it manually. Never left
 *                  the consumer paid with nothing.
 */
export type PartnerShipmentStatus = 'shipped' | 'awaiting_pack' | 'needs_review';

export interface PartnerShipmentRecipient {
  name: string;
  phone?: string;
  email?: string;
  street: string;
  street2?: string;
  city: string;
  state: string;
  zip: string;
  country: string;
}

export interface PartnerShipment {
  id: string;
  partnerId: string;
  createdAt: Date;
  mode: PartnerMode;
  status: PartnerShipmentStatus;
  carrier: string;
  serviceName: string;
  serviceCode: string;
  /** What the consumer paid (freight + packing). */
  retailUSD: number;
  freightRetailUSD: number;
  packingFeeUSD: number;
  /** Actual carrier charge — SHOP margin/reconciliation only, never returned. */
  carrierCostUSD?: number;
  paymentIntentId: string;
  quoteId: string;
  orderRef?: string;
  businessEmail?: string;
  trackingNumber?: string;
  /** Label bytes for the shop's records — never returned to the partner. */
  labelBase64?: string;
  labelMimeType?: string;
  recipient: PartnerShipmentRecipient;
}

function col() {
  return client.db(DB).collection<PartnerShipment>(COLLECTION);
}

/** Retail-only, PII-minimal projection for the partner's own history endpoint. */
const PARTNER_HISTORY_PROJECTION = {
  _id: 0,
  id: 1,
  createdAt: 1,
  status: 1,
  mode: 1,
  carrier: 1,
  serviceName: 1,
  trackingNumber: 1,
  retailUSD: 1,
  orderRef: 1,
  'recipient.name': 1,
  'recipient.city': 1,
  'recipient.state': 1,
  'recipient.zip': 1,
} as const;

/** Admin view: full record minus the heavy label bytes. */
const ADMIN_PROJECTION = { _id: 0, labelBase64: 0 } as const;

export async function appendPartnerShipment(entry: PartnerShipment): Promise<void> {
  await client.connect();
  await col().insertOne(entry, IGNORE_UNDEFINED);
}

/**
 * The shipment already created for this quote, if any. Powers idempotent replay:
 * a retried /shipments for a quote that already produced a shipment returns the
 * SAME result instead of minting a second label (lost-response safety). Scoped
 * to the owning partner.
 */
export async function getPartnerShipmentByQuote(
  partnerId: string,
  quoteId: string
): Promise<PartnerShipment | null> {
  await client.connect();
  return col().findOne({ partnerId, quoteId });
}

/**
 * A shipment already paid for by this PaymentIntent, if any. Binds one payment
 * to one shipment: a PI cannot be reused to mint labels for other quotes (the
 * amount-only check alone would let a large PI cover several small labels).
 */
export async function getPartnerShipmentByPaymentIntent(
  partnerId: string,
  paymentIntentId: string
): Promise<PartnerShipment | null> {
  await client.connect();
  return col().findOne({ partnerId, paymentIntentId });
}

/** The partner's own shipments, newest first, retail-only, scoped to them. */
export async function listPartnerShipments(
  partnerId: string,
  limit = 50
): Promise<Array<Record<string, unknown>>> {
  await client.connect();
  const capped = Math.min(Math.max(1, Number(limit) || 50), 200);
  return col()
    .find({ partnerId }, { projection: PARTNER_HISTORY_PROJECTION })
    .sort({ createdAt: -1 })
    .limit(capped)
    .toArray() as unknown as Promise<Array<Record<string, unknown>>>;
}

/**
 * Admin: the shop's action queue (all partners) — pickup_pack shipments awaiting
 * packing, plus needs_review self_ship labels that failed after payment and must
 * be completed by hand. The label bytes are dropped from the projection.
 */
export async function listAwaitingPack(limit = 100): Promise<Array<Record<string, unknown>>> {
  await client.connect();
  const capped = Math.min(Math.max(1, Number(limit) || 100), 500);
  return col()
    .find({ status: { $in: ['awaiting_pack', 'needs_review'] } }, { projection: ADMIN_PROJECTION })
    .sort({ createdAt: -1 })
    .limit(capped)
    .toArray() as unknown as Promise<Array<Record<string, unknown>>>;
}

/** Admin: mark a pickup_pack shipment as packed & shipped. */
export async function markPartnerShipmentShipped(
  id: string,
  trackingNumber?: string
): Promise<boolean> {
  await client.connect();
  const res = await col().updateOne(
    { id, status: { $in: ['awaiting_pack', 'needs_review'] } },
    { $set: { status: 'shipped', ...(trackingNumber ? { trackingNumber } : {}) } },
    IGNORE_UNDEFINED
  );
  return res.matchedCount > 0;
}
