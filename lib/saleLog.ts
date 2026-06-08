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

export async function appendSale(entry: SaleRecord): Promise<void> {
  await client.connect();
  await col().insertOne(entry);
}
