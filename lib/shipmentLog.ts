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

export async function appendLog(entry: ShipmentLogEntry): Promise<void> {
  await client.connect();
  await col().insertOne(entry);
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
