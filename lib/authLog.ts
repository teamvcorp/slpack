import client, { IGNORE_UNDEFINED } from '@/lib/mongodb';

/**
 * Audit trail for admin login attempts (2026-09-10).
 *
 * WHY: the auth route kept only a failure COUNTER, cleared on success — so a
 * successful brute-force erased its own evidence and there was no record of who
 * logged in, from where, or when. This is an append-only log the success path
 * never touches.
 *
 * Never throws — an auth attempt must not fail because logging did. A TTL index
 * on `at` keeps it bounded (create once; see reporting_notes.md).
 */
const DB = 'slpack';
const COLLECTION = 'authEvents';

export async function logAuthAttempt(entry: {
  ok: boolean;
  ip: string;
  ua?: string;
  reason?: string;
}): Promise<void> {
  try {
    await client.connect();
    await client
      .db(DB)
      .collection(COLLECTION)
      .insertOne(
        {
          at: new Date(),
          ok: entry.ok,
          ip: entry.ip,
          ua: entry.ua,
          reason: entry.reason,
        },
        IGNORE_UNDEFINED
      );
  } catch (err) {
    console.error('[auth-log] failed to record attempt', err instanceof Error ? err.message : err);
  }
}
