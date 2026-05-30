import client from '@/lib/mongodb';
import type { CarrierKey, SettlementEntry } from '@/app/admin/types/shipping';

const DB = 'slpack';
const COLLECTION = 'settlements';

function col() {
  return client.db(DB).collection<SettlementEntry>(COLLECTION);
}

export async function readSettlements(): Promise<SettlementEntry[]> {
  await client.connect();
  return col().find({}).sort({ paidAt: -1 }).toArray();
}

export async function appendSettlement(entry: SettlementEntry): Promise<void> {
  await client.connect();
  await col().insertOne(entry);
}

/** Returns the most recent settlement per carrier, keyed by carrier. */
export async function lastSettlementByCarrier(): Promise<Partial<Record<CarrierKey, SettlementEntry>>> {
  const all = await readSettlements();
  const out: Partial<Record<CarrierKey, SettlementEntry>> = {};
  for (const s of all) {
    if (!out[s.carrier]) out[s.carrier] = s;
  }
  return out;
}
