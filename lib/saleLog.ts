import client from '@/lib/mongodb';
import type { SaleRecord } from '@/app/admin/types/register';

const DB = 'slpack';
const COLLECTION = 'sales';

function col() {
  return client.db(DB).collection<SaleRecord>(COLLECTION);
}

export async function readSales(): Promise<SaleRecord[]> {
  await client.connect();
  return col().find({}).sort({ timestamp: -1 }).toArray();
}

/** Sales with timestamp >= sinceIso, newest first. */
export async function readSalesSince(sinceIso: string): Promise<SaleRecord[]> {
  await client.connect();
  return col()
    .find({ timestamp: { $gte: sinceIso } })
    .sort({ timestamp: -1 })
    .toArray();
}

export async function getSaleById(id: string): Promise<SaleRecord | null> {
  await client.connect();
  return col().findOne({ id });
}

export async function appendSale(entry: SaleRecord): Promise<void> {
  await client.connect();
  await col().insertOne(entry);
}
