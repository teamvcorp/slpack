import client, { IGNORE_UNDEFINED } from '@/lib/mongodb';
import type { DropoffRecord } from '@/app/admin/types/dropoff';

const DB = 'slpack';
const COLLECTION = 'dropoffs';

function col() {
  return client.db(DB).collection<DropoffRecord>(COLLECTION);
}

export async function appendDropoff(entry: DropoffRecord): Promise<void> {
  await client.connect();
  // IGNORE_UNDEFINED: optional customer fields must be stored ABSENT, not null
  // — see lib/mongodb.ts.
  await col().insertOne(entry, IGNORE_UNDEFINED);
}

/** Drop-offs with timestamp >= sinceIso, newest first. */
export async function readDropoffsSince(sinceIso: string): Promise<DropoffRecord[]> {
  await client.connect();
  return col()
    .find({ timestamp: { $gte: sinceIso } })
    .sort({ timestamp: -1 })
    .toArray();
}

/** All drop-offs in a batch (same customer, one receipt), oldest first. */
export async function readDropoffsByBatch(batchId: string): Promise<DropoffRecord[]> {
  await client.connect();
  return col().find({ batchId }).sort({ timestamp: 1 }).toArray();
}

/** Mark every record in a batch as having had its receipt emailed. */
export async function markBatchEmailed(batchId: string): Promise<void> {
  await client.connect();
  await col().updateMany({ batchId }, { $set: { receiptEmailed: true } });
}
