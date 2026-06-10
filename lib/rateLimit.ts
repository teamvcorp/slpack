import type { NextRequest } from 'next/server';
import client from '@/lib/mongodb';

const DB = 'slpack';
const COLLECTION = 'rateLimits';

interface Bucket {
  key: string;
  count: number;
  windowStart: number; // epoch ms
}

function col() {
  return client.db(DB).collection<Bucket>(COLLECTION);
}

/** Best-effort client IP from proxy headers (Vercel sets x-forwarded-for). */
export function clientIp(req: NextRequest): string {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim();
  return req.headers.get('x-real-ip') ?? 'unknown';
}

/** Current count within the active window, without incrementing. */
export async function peek(key: string, windowMs: number): Promise<number> {
  await client.connect();
  const doc = await col().findOne({ key });
  if (!doc) return 0;
  if (Date.now() - doc.windowStart > windowMs) return 0; // window expired
  return doc.count;
}

/** Increment the counter and return the new count within the active window. */
export async function hit(key: string, windowMs: number): Promise<number> {
  await client.connect();
  const now = Date.now();
  const doc = await col().findOne({ key });
  if (!doc || now - doc.windowStart > windowMs) {
    await col().updateOne(
      { key },
      { $set: { key, count: 1, windowStart: now } },
      { upsert: true }
    );
    return 1;
  }
  await col().updateOne({ key }, { $inc: { count: 1 } });
  return doc.count + 1;
}

/** Clear a key's counter (e.g. after a successful login). */
export async function reset(key: string): Promise<void> {
  await client.connect();
  await col().deleteOne({ key });
}
