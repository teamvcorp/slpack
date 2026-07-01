import client from '@/lib/mongodb';
import type { ShipmentLogEntry } from '@/app/admin/types/shipping';

const DB = 'slpack';
const COLLECTION = 'shipments';

function col() {
  return client.db(DB).collection<ShipmentLogEntry>(COLLECTION);
}

export async function readLog(): Promise<ShipmentLogEntry[]> {
  await client.connect();
  return col().find({}).sort({ timestamp: -1 }).toArray();
}

/** Shipments with timestamp >= sinceIso, newest first. */
export async function readShipmentsSince(sinceIso: string): Promise<ShipmentLogEntry[]> {
  await client.connect();
  return col()
    .find({ timestamp: { $gte: sinceIso } })
    .sort({ timestamp: -1 })
    .toArray();
}

export async function appendLog(entry: ShipmentLogEntry): Promise<void> {
  await client.connect();
  await col().insertOne(entry);
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
    }
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
  const res = await col().updateOne({ id }, { $set: set });
  return res.matchedCount > 0;
}
