import client, { IGNORE_UNDEFINED } from '@/lib/mongodb';

/**
 * Append-only audit trail for the Partner Shipping API (2026-09-10).
 *
 * Mirrors lib/authLog.ts: every partner request records who (keyId/partnerId),
 * from where (ip), what (route + action), and the outcome (ok + reason). It lets
 * a leaked credential be spotted and its blast radius reconstructed. A leaked
 * key is already bounded (rate-limited, deactivatable, and useless without a
 * real succeeded payment), and this log is how you'd notice it being tried.
 *
 * NEVER throws — a partner request must not fail because logging did. A TTL index
 * on `at` keeps it bounded (create once; see reporting_notes.md).
 */
const DB = 'slpack';
const COLLECTION = 'partnerApiEvents';

export async function logPartnerEvent(entry: {
  ok: boolean;
  route: string;
  ip: string;
  keyId?: string;
  partnerId?: string;
  status?: number;
  reason?: string;
  /** Retail-only, non-PII context (quoteId, mode, tracking) — never cost/list. */
  meta?: Record<string, unknown>;
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
          route: entry.route,
          ip: entry.ip,
          keyId: entry.keyId,
          partnerId: entry.partnerId,
          status: entry.status,
          reason: entry.reason,
          meta: entry.meta,
        },
        IGNORE_UNDEFINED
      );
  } catch (err) {
    console.error('[partner-log] failed to record event', err instanceof Error ? err.message : err);
  }
}
