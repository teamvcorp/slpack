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
