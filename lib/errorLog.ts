import client from '@/lib/mongodb';
import type { ErrorLogEntry } from '@/app/admin/types/shipping';

const DB = 'slpack';
const COLLECTION = 'errors';

function col() {
  return client.db(DB).collection<ErrorLogEntry>(COLLECTION);
}

/**
 * Persist an error entry. Never throws — Mongo failures must not break the
 * caller's HTTP response. On failure logs a single console.error and returns.
 */
export async function appendError(entry: ErrorLogEntry): Promise<void> {
  try {
    await client.connect();
    await col().insertOne(entry);
  } catch (err) {
    console.error(
      '[error-log] failed to persist error entry',
      err instanceof Error ? err.message : err
    );
  }
}

export interface ReadErrorsOptions {
  /** Max age in milliseconds (default: 7 days) */
  sinceMs?: number;
  /** Max rows returned (default: 200, hard cap 1000) */
  limit?: number;
}

export async function readErrors(opts: ReadErrorsOptions = {}): Promise<ErrorLogEntry[]> {
  const sinceMs = opts.sinceMs ?? 7 * 24 * 60 * 60 * 1000;
  const limit = Math.min(opts.limit ?? 200, 1000);

  await client.connect();
  const cutoff = new Date(Date.now() - sinceMs).toISOString();
  return col()
    .find({ timestamp: { $gte: cutoff } })
    .sort({ timestamp: -1 })
    .limit(limit)
    .toArray();
}
