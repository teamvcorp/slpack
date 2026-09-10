import type { NextRequest } from 'next/server';
import client from '@/lib/mongodb';

const DB = 'slpack';
const COLLECTION = 'rateLimits';

interface Bucket {
  key: string; // `${logicalKey}:${windowIndex}`
  count: number;
  expiresAt: Date; // TTL index removes the doc after its window closes
}

function col() {
  return client.db(DB).collection<Bucket>(COLLECTION);
}

/**
 * Client IP for rate-limit keying.
 *
 * Prefers `x-vercel-forwarded-for` (2026-09-10): Vercel sets it to the real
 * connecting IP and the client cannot forge it. The previous code took the
 * LEFT-most entry of `x-forwarded-for`, which in an append-style proxy chain is
 * the attacker-supplied value — a rotating header there gave every request a
 * fresh bucket and defeated the login lockout entirely. Off-Vercel (local dev)
 * none of these are set and everything shares the 'unknown' bucket, which is
 * fine for development.
 */
export function clientIp(req: NextRequest): string {
  const vercel = req.headers.get('x-vercel-forwarded-for');
  if (vercel) return vercel.split(',')[0].trim();
  const real = req.headers.get('x-real-ip');
  if (real) return real.trim();
  return 'unknown';
}

/** The document key + expiry for the window `key` falls into right now. */
function windowDoc(key: string, windowMs: number): { windowKey: string; expiresAt: Date } {
  const now = Date.now();
  const index = Math.floor(now / windowMs);
  return {
    windowKey: `${key}:${index}`,
    // End of this window, plus a small grace so the TTL never races the window.
    expiresAt: new Date((index + 1) * windowMs + 60_000),
  };
}

/** Current count within the active window, without incrementing. */
export async function peek(key: string, windowMs: number): Promise<number> {
  await client.connect();
  const { windowKey } = windowDoc(key, windowMs);
  const doc = await col().findOne({ key: windowKey });
  return doc?.count ?? 0;
}

/**
 * Increment the counter and return the new count within the active window.
 *
 * ATOMIC (fix 2026-09-10). This was findOne-then-updateOne — a read-modify-write
 * that N concurrent lambdas all raced past the ceiling. Bucketing the key by
 * time window makes each window its own document, so a single upserting
 * `$inc` is naturally atomic and needs no reset logic; the TTL index on
 * `expiresAt` reclaims old buckets (create it once — see reporting_notes.md).
 */
export async function hit(key: string, windowMs: number): Promise<number> {
  await client.connect();
  const { windowKey, expiresAt } = windowDoc(key, windowMs);
  const doc = await col().findOneAndUpdate(
    { key: windowKey },
    { $inc: { count: 1 }, $setOnInsert: { key: windowKey, expiresAt } },
    { upsert: true, returnDocument: 'after' }
  );
  return doc?.count ?? 1;
}

/**
 * Clear a logical key's counters (e.g. after a successful login). Deletes every
 * window bucket for the key; the anchored prefix regex is served by the index
 * on `key`. The metacharacter escape matters because keys contain IPs (dots).
 */
export async function reset(key: string): Promise<void> {
  await client.connect();
  const prefix = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  await col().deleteMany({ key: { $regex: `^${prefix}:` } });
}
