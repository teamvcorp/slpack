import client, { IGNORE_UNDEFINED } from '@/lib/mongodb';
import { randomUUID } from 'crypto';
import type { PartnerMode, PartnerQuotePackage } from '@/lib/partnerQuoteStore';

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
 *
 * This record is the PERMANENT reconciliation ledger (no TTL). Everything needed
 * to reconcile a carrier invoice weeks later is denormalized ONTO it — the
 * DECLARED package the partner gave, the cost basis we quoted, the carrier cost
 * at label time, and the tracking number — because the quote it came from is
 * TTL'd away after 30 minutes. When a carrier re-measures a box at the hub and
 * bills a higher "adjusted" cost, that adjustment is linked back to THIS package
 * by tracking number and appended to `adjustments`. See addPartnerShipmentAdjustment.
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

/**
 * A carrier billing adjustment tied to a shipment (2026-09-10).
 *
 * Carriers re-measure/re-weigh at the hub and bill a correction — a "dimensional
 * reweigh", additional handling, an unbilled residential surcharge — days or
 * weeks after the label, referencing the tracking number on the invoice. This is
 * how that extra cost is linked to the exact package. Append-only: each entry is
 * its own immutable record of one invoice line, so the full audit trail of what
 * the shop was billed and why is preserved on the package itself.
 */
export interface PartnerShipmentAdjustment {
  adjustmentId: string;
  recordedAt: Date;
  /** The corrected/total carrier charge on the invoice line, if given. */
  adjustedCostUSD?: number;
  /** The EXTRA the shop was billed vs. the original label cost (the loss driver). */
  deltaUSD: number;
  /** e.g. dimensional_reweigh | additional_handling | residential | correction | other. */
  reason?: string;
  /** What the carrier actually measured, when the invoice reports it. */
  correctedWeightLbs?: number;
  correctedLengthIn?: number;
  correctedWidthIn?: number;
  correctedHeightIn?: number;
  /** The carrier invoice / adjustment reference, for the paper trail. */
  carrierInvoiceRef?: string;
  note?: string;
  /** Billback tracking: has the shop recovered this from the partner? */
  billbackStatus: 'pending' | 'billed' | 'absorbed';
  recordedBy?: string;
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
  /** Actual carrier charge at label time — SHOP reconciliation, never returned. */
  carrierCostUSD?: number;
  /** The carrier cost basis we QUOTED — the baseline an adjustment is measured against. */
  quotedCostBasisUSD?: number;
  /** The package the partner DECLARED — denormalized so it survives the quote TTL. */
  declaredPackage: PartnerQuotePackage;
  /** Residential destination (drives a carrier surcharge if the partner mis-set it). */
  residential?: boolean;
  /** Carrier billing adjustments linked to this package, appended over time. */
  adjustments?: PartnerShipmentAdjustment[];
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

/** Money helpers — kept local so reconciliation never drifts on float noise. */
const money = (n: number) => Math.round(Number(n) * 100) / 100;

export interface ReconcileSummary {
  /** Sum of all adjustment deltas billed to the shop. */
  totalAdjustmentsUSD: number;
  /** Carrier cost at label time + every later adjustment. */
  effectiveCarrierCostUSD: number;
  /** freight retail − effective carrier cost. Negative = the shipment lost money. */
  freightMarginUSD: number;
  /** True once adjustments pushed freight below the carrier's effective cost. */
  underwater: boolean;
}

/**
 * Pure margin math for a shipment after adjustments. Used by the admin
 * reconciliation view and by the loss alert. Never touches the DB.
 */
export function reconcileSummary(s: {
  freightRetailUSD: number;
  carrierCostUSD?: number;
  adjustments?: PartnerShipmentAdjustment[];
}): ReconcileSummary {
  const base = Number(s.carrierCostUSD) || 0;
  const totalAdjustmentsUSD = money((s.adjustments ?? []).reduce((sum, a) => sum + (Number(a.deltaUSD) || 0), 0));
  const effectiveCarrierCostUSD = money(base + totalAdjustmentsUSD);
  const freightMarginUSD = money((Number(s.freightRetailUSD) || 0) - effectiveCarrierCostUSD);
  return {
    totalAdjustmentsUSD,
    effectiveCarrierCostUSD,
    freightMarginUSD,
    underwater: freightMarginUSD < 0,
  };
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
  const tn = trackingNumber ? String(trackingNumber).replace(/\s+/g, '').toUpperCase() : '';
  const res = await col().updateOne(
    { id, status: { $in: ['awaiting_pack', 'needs_review'] } },
    { $set: { status: 'shipped', ...(tn ? { trackingNumber: tn } : {}) } },
    IGNORE_UNDEFINED
  );
  return res.matchedCount > 0;
}

/** Admin: one shipment by its internal id (full record minus label bytes). */
export async function getPartnerShipmentById(id: string): Promise<Record<string, unknown> | null> {
  await client.connect();
  return col().findOne({ id }, { projection: ADMIN_PROJECTION }) as unknown as Promise<Record<string, unknown> | null>;
}

/**
 * Admin: find a shipment by tracking number — the join key on a carrier invoice.
 * This is what turns "adjustment for 1ZXXX… on the bill" into the exact package,
 * the partner who declared it, and the dimensions they claimed. Tracking is
 * normalized (spaces stripped, upper-cased) both here and at write time.
 */
export async function getPartnerShipmentByTracking(
  trackingNumber: string
): Promise<Record<string, unknown> | null> {
  const tn = String(trackingNumber ?? '').replace(/\s+/g, '').toUpperCase();
  if (!tn) return null;
  await client.connect();
  return col().findOne({ trackingNumber: tn }, { projection: ADMIN_PROJECTION }) as unknown as Promise<Record<string, unknown> | null>;
}

/**
 * Admin: search shipments for reconciliation. Any combination of an exact
 * tracking number, a partnerId, and a status; newest first. Full record minus
 * the label bytes.
 */
export async function searchPartnerShipments(opts: {
  trackingNumber?: string;
  partnerId?: string;
  status?: PartnerShipmentStatus;
  hasAdjustments?: boolean;
  limit?: number;
}): Promise<Array<Record<string, unknown>>> {
  await client.connect();
  const filter: Record<string, unknown> = {};
  if (opts.trackingNumber) filter.trackingNumber = String(opts.trackingNumber).replace(/\s+/g, '').toUpperCase();
  if (opts.partnerId) filter.partnerId = opts.partnerId;
  if (opts.status) filter.status = opts.status;
  if (opts.hasAdjustments) filter['adjustments.0'] = { $exists: true };
  const capped = Math.min(Math.max(1, Number(opts.limit) || 100), 500);
  return col()
    .find(filter, { projection: ADMIN_PROJECTION })
    .sort({ createdAt: -1 })
    .limit(capped)
    .toArray() as unknown as Promise<Array<Record<string, unknown>>>;
}

/**
 * Admin: append a carrier billing adjustment to a shipment, located by internal
 * id OR tracking number. Append-only ($push) — an adjustment is never edited or
 * removed, so the record of what the carrier billed stays intact. Returns the
 * updated shipment (minus label bytes) or null if not found.
 *
 * `deltaUSD` is the extra billed to the shop; when only the corrected total is
 * known, the caller passes `adjustedCostUSD` and we derive the delta from the
 * original label cost.
 */
export async function addPartnerShipmentAdjustment(
  locate: { id?: string; trackingNumber?: string },
  input: {
    adjustedCostUSD?: number;
    deltaUSD?: number;
    reason?: string;
    correctedWeightLbs?: number;
    correctedLengthIn?: number;
    correctedWidthIn?: number;
    correctedHeightIn?: number;
    carrierInvoiceRef?: string;
    note?: string;
    billbackStatus?: PartnerShipmentAdjustment['billbackStatus'];
    recordedBy?: string;
  }
): Promise<Record<string, unknown> | null> {
  await client.connect();
  const filter: Record<string, unknown> = {};
  if (locate.id) filter.id = locate.id;
  else if (locate.trackingNumber) filter.trackingNumber = String(locate.trackingNumber).replace(/\s+/g, '').toUpperCase();
  else return null;

  // Read the current cost so a delta can be derived from an adjusted total.
  const current = await col().findOne(filter);
  if (!current) return null;

  const originalCost = Number(current.carrierCostUSD) || 0;
  let deltaUSD: number;
  if (typeof input.deltaUSD === 'number' && Number.isFinite(input.deltaUSD)) {
    deltaUSD = money(input.deltaUSD);
  } else if (typeof input.adjustedCostUSD === 'number' && Number.isFinite(input.adjustedCostUSD)) {
    deltaUSD = money(input.adjustedCostUSD - originalCost);
  } else {
    return null; // nothing quantifiable to record
  }

  const adjustment: PartnerShipmentAdjustment = {
    adjustmentId: randomUUID(),
    recordedAt: new Date(),
    adjustedCostUSD: typeof input.adjustedCostUSD === 'number' ? money(input.adjustedCostUSD) : undefined,
    deltaUSD,
    reason: input.reason?.trim().slice(0, 60) || undefined,
    correctedWeightLbs: numOrUndef(input.correctedWeightLbs),
    correctedLengthIn: numOrUndef(input.correctedLengthIn),
    correctedWidthIn: numOrUndef(input.correctedWidthIn),
    correctedHeightIn: numOrUndef(input.correctedHeightIn),
    carrierInvoiceRef: input.carrierInvoiceRef?.trim().slice(0, 120) || undefined,
    note: input.note?.trim().slice(0, 500) || undefined,
    billbackStatus: input.billbackStatus ?? 'pending',
    recordedBy: input.recordedBy?.trim().slice(0, 120) || undefined,
  };

  const res = await col().findOneAndUpdate(
    filter,
    { $push: { adjustments: adjustment } },
    { returnDocument: 'after', projection: ADMIN_PROJECTION, ...IGNORE_UNDEFINED }
  );
  return (res ?? null) as unknown as Record<string, unknown> | null;
}

/** Admin: update the billback status of one adjustment (operational state). */
export async function setAdjustmentBillbackStatus(
  shipmentId: string,
  adjustmentId: string,
  billbackStatus: PartnerShipmentAdjustment['billbackStatus']
): Promise<boolean> {
  await client.connect();
  const res = await col().updateOne(
    { id: shipmentId, 'adjustments.adjustmentId': adjustmentId },
    { $set: { 'adjustments.$.billbackStatus': billbackStatus } },
    IGNORE_UNDEFINED
  );
  return res.matchedCount > 0;
}

function numOrUndef(v: unknown): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}
