import client, { IGNORE_UNDEFINED } from '@/lib/mongodb';
import type { ShipmentLogEntry, ShipmentListEntry } from '@/app/admin/types/shipping';

const DB = 'slpack';
const COLLECTION = 'shipments';

function col() {
  return client.db(DB).collection<ShipmentLogEntry>(COLLECTION);
}

/**
 * Field WHITELIST for list/report reads — see ShipmentListEntry for the size
 * measurements that motivated it.
 *
 * A whitelist, not `{ labelBase64: 0 }`: a field added to the log later (a
 * document blob, an ID scan, a payment token) then cannot leak into a browser
 * response by default. Opting a field IN stays a deliberate act.
 *
 * `hasLabel` is a computed projection expression, which is why this must be an
 * INCLUSION projection — Mongo forbids mixing exclusions with computed fields,
 * and `_id: 0` is the one legal exception.
 */
const SHIPMENT_LIST_PROJECTION = {
  _id: 0,
  id: 1,
  timestamp: 1,
  carrier: 1,
  serviceName: 1,
  originZip: 1,
  destZip: 1,
  destCity: 1,
  destState: 1,
  destAttention: 1,
  weightLbs: 1,
  lengthIn: 1,
  widthIn: 1,
  heightIn: 1,
  signature: 1,
  shippingUSD: 1,
  insuranceUSD: 1,
  insuranceDescription: 1,
  packingFeeUSD: 1,
  dutiesUSD: 1,
  cardFeeUSD: 1,
  totalUSD: 1,
  carrierCostUSD: 1,
  listPriceUSD: 1,
  rateSource: 1,
  priceOverridden: 1,
  saturdayDelivery: 1,
  simpleRateTier: 1,
  transactionId: 1,
  trackingNumber: 1,
  customerName: 1,
  customerEmail: 1,
  paymentMethod: 1,
  voided: 1,
  voidedAt: 1,
  voidReason: 1,
  accepted: 1,
  acceptedAt: 1,
  acceptedSource: 1,
  hasLabel: { $ne: [{ $ifNull: ['$labelBase64', ''] }, ''] },
} as const;

/**
 * Hard ceiling on rows in one list response. Post-projection a row is ~1 KB, so
 * this caps a response near 2 MB — comfortably under the serverless limit, and
 * roughly a decade at current volume. Callers MUST surface truncation: a
 * silently short list makes a revenue total quietly wrong, which at a cash
 * counter is worse than an error.
 */
export const SHIPMENT_LIST_LIMIT = 2000;

/**
 * Shipments for the reports, newest first, WITHOUT the label images.
 *
 * `sinceIso` null/undefined means no lower bound ("all time") — the row limit
 * is then the only thing bounding the response.
 */
export async function readShipmentList(
  opts: { sinceIso?: string | null; limit?: number } = {}
): Promise<ShipmentListEntry[]> {
  await client.connect();
  const filter = opts.sinceIso ? { timestamp: { $gte: opts.sinceIso } } : {};
  return col()
    .find(filter)
    .project<ShipmentListEntry>(SHIPMENT_LIST_PROJECTION)
    .sort({ timestamp: -1 })
    .limit(opts.limit ?? SHIPMENT_LIST_LIMIT)
    .toArray();
}

export async function appendLog(entry: ShipmentLogEntry): Promise<void> {
  await client.connect();
  // IGNORE_UNDEFINED: an optional field left undefined must be stored ABSENT,
  // not as null — see the note in lib/mongodb.ts.
  await col().insertOne(entry, IGNORE_UNDEFINED);
}

/** All shipments in a combined transaction, oldest first (for the unified receipt). */
export async function readShipmentsByTransaction(
  transactionId: string
): Promise<ShipmentLogEntry[]> {
  await client.connect();
  return col().find({ transactionId }).sort({ timestamp: 1 }).toArray();
}

export async function getShipmentById(id: string): Promise<ShipmentLogEntry | null> {
  await client.connect();
  return col().findOne({ id });
}

export async function markShipmentVoided(
  id: string,
  patch: {
    voidReason?: string;
    voidCarrierStatus: 'success' | 'failed' | 'skipped' | 'manual';
    voidCarrierMessage?: string;
  }
): Promise<boolean> {
  await client.connect();
  const res = await col().updateOne(
    { id },
    {
      $set: {
        voided: true,
        voidedAt: new Date().toISOString(),
        voidReason: patch.voidReason,
        voidCarrierStatus: patch.voidCarrierStatus,
        voidCarrierMessage: patch.voidCarrierMessage,
      },
    },
    // voidReason and voidCarrierMessage are optional — without this they would
    // be written as null rather than left off. See lib/mongodb.ts.
    IGNORE_UNDEFINED
  );
  return res.matchedCount > 0;
}

/**
 * Returns shipments that still need a tracking acceptance check.
 * - Not voided, has a tracking number, not already accepted
 * - Created within the last `lookbackDays` (default 30) — older labels are
 *   effectively dead weight and unlikely to be tendered
 * - Either never checked, or last checked more than `staleMinutes` ago
 */
export async function findShipmentsNeedingAcceptanceCheck(opts: {
  limit?: number;
  lookbackDays?: number;
  staleMinutes?: number;
} = {}): Promise<ShipmentLogEntry[]> {
  await client.connect();
  const limit = opts.limit ?? 50;
  const lookbackDays = opts.lookbackDays ?? 30;
  const staleMinutes = opts.staleMinutes ?? 240; // 4 hours
  const sinceIso = new Date(Date.now() - lookbackDays * 86400000).toISOString();
  const staleIso = new Date(Date.now() - staleMinutes * 60000).toISOString();
  return col()
    .find({
      voided: { $ne: true },
      accepted: { $ne: true },
      trackingNumber: { $nin: [null, ''] },
      timestamp: { $gte: sinceIso },
      $or: [
        { acceptanceCheckedAt: { $exists: false } },
        { acceptanceCheckedAt: { $lt: staleIso } },
      ],
    })
    .sort({ timestamp: -1 })
    .limit(limit)
    .toArray();
}

export async function markShipmentAcceptance(
  id: string,
  patch: {
    accepted: boolean;
    acceptedAt?: string;
    acceptedSource?: 'tracking' | 'manual';
  }
): Promise<boolean> {
  await client.connect();
  const set: Record<string, unknown> = {
    acceptanceCheckedAt: new Date().toISOString(),
  };
  if (patch.accepted) {
    set.accepted = true;
    set.acceptedAt = patch.acceptedAt ?? new Date().toISOString();
    set.acceptedSource = patch.acceptedSource ?? 'tracking';
  }
  const res = await col().updateOne({ id }, { $set: set }, IGNORE_UNDEFINED);
  return res.matchedCount > 0;
}
