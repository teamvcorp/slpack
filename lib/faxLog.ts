import client, { IGNORE_UNDEFINED } from '@/lib/mongodb';

/**
 * Local fax archive (2026-09-14) — a durable mirror of Sinch faxes so history
 * outlives Sinch's 13-month retention, loads without hitting Sinch, and supports
 * unread badges. Modeled on lib/dropoffLog.ts + the inclusion-whitelist idiom in
 * lib/shipmentLog.ts.
 *
 * The stored PDF lives in Vercel Blob; `blobUrl` is SERVER-ONLY and deliberately
 * excluded from FAX_LIST_PROJECTION, so it is never shipped to the browser — PDFs
 * are served only through the admin-gated /api/admin/fax/[id]/file route (same
 * reasoning as shipmentLog withholding labelBase64).
 *
 * Indexes (create by hand in Atlas — see reporting_notes.md):
 *   db.faxes.createIndex({ sinchId: 1 }, { unique: true })
 *   db.faxes.createIndex({ direction: 1, createdAt: -1 })
 */
const DB = 'slpack';
const COLLECTION = 'faxes';

export type FaxDirection = 'INBOUND' | 'OUTBOUND';
export type FaxStatus = 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';

export interface FaxRecord {
  sinchId: string;
  direction: FaxDirection;
  status: FaxStatus;
  from?: string;
  to?: string;
  numberOfPages?: number;
  priceUSD?: number;
  errorType?: string;
  errorMessage?: string;
  headerText?: string;
  /** Vercel Blob URL of the archived PDF — SERVER-ONLY, never projected. */
  blobUrl?: string;
  createdAt: string; // ISO
  completedAt?: string;
  read?: boolean;
  createdBy?: string;
}

function col() {
  return client.db(DB).collection<FaxRecord>(COLLECTION);
}

/** Inclusion whitelist — omits `blobUrl` so it can never leak to a browser. */
const FAX_LIST_PROJECTION = {
  _id: 0,
  sinchId: 1,
  direction: 1,
  status: 1,
  from: 1,
  to: 1,
  numberOfPages: 1,
  priceUSD: 1,
  errorType: 1,
  errorMessage: 1,
  headerText: 1,
  createdAt: 1,
  completedAt: 1,
  read: 1,
  createdBy: 1,
} as const;

/** Public (browser-safe) shape returned by the list. */
export type FaxListEntry = Omit<FaxRecord, 'blobUrl'>;

/**
 * Idempotent upsert keyed on sinchId — safe for webhook retries and for the
 * send→webhook race (both converge on the same row). Only the fields you pass are
 * written (undefined is stripped by IGNORE_UNDEFINED, so a status-only update from
 * the webhook never blanks the from/to captured at send time).
 */
export async function upsertFax(input: {
  sinchId: string;
  direction: FaxDirection;
  status?: FaxStatus;
  from?: string;
  to?: string;
  numberOfPages?: number;
  priceUSD?: number;
  errorType?: string;
  errorMessage?: string;
  headerText?: string;
  blobUrl?: string;
  completedAt?: string;
  createdBy?: string;
  /** Sinch createTime; used only when the row is first inserted. */
  createdAt?: string;
}): Promise<{ inserted: boolean }> {
  await client.connect();
  const now = new Date().toISOString();
  const $set: Record<string, unknown> = {
    direction: input.direction,
    status: input.status,
    from: input.from,
    to: input.to,
    numberOfPages: input.numberOfPages,
    priceUSD: input.priceUSD,
    errorType: input.errorType,
    errorMessage: input.errorMessage,
    headerText: input.headerText,
    blobUrl: input.blobUrl,
    completedAt: input.completedAt,
    createdBy: input.createdBy,
  };
  const $setOnInsert: Record<string, unknown> = {
    sinchId: input.sinchId,
    createdAt: input.createdAt ?? now,
    // Inbound faxes start unread; outbound don't participate in unread counts.
    ...(input.direction === 'INBOUND' ? { read: false } : {}),
  };
  const res = await col().updateOne(
    { sinchId: input.sinchId },
    { $set, $setOnInsert },
    { upsert: true, ...IGNORE_UNDEFINED }
  );
  // upsertedCount > 0 means this call created the row — lets the webhook email
  // exactly once for a new inbound fax and stay silent on Sinch's retries.
  return { inserted: (res.upsertedCount ?? 0) > 0 };
}

/** Newest-first list for the admin page, optionally filtered by direction. */
export async function listFaxes(opts: { direction?: FaxDirection; limit?: number } = {}): Promise<FaxListEntry[]> {
  await client.connect();
  const filter = opts.direction ? { direction: opts.direction } : {};
  const limit = Math.min(Math.max(1, Number(opts.limit) || 200), 1000);
  return col()
    .find(filter, { projection: FAX_LIST_PROJECTION })
    .sort({ createdAt: -1 })
    .limit(limit)
    .toArray() as unknown as Promise<FaxListEntry[]>;
}

/** The archived Blob URL for one fax (server-only; used by the file route). */
export async function getFaxBlobUrl(sinchId: string): Promise<string | null> {
  await client.connect();
  const doc = await col().findOne({ sinchId }, { projection: { _id: 0, blobUrl: 1 } });
  return doc?.blobUrl ?? null;
}

/** Mark an inbound fax read. */
export async function markFaxRead(sinchId: string): Promise<boolean> {
  await client.connect();
  const res = await col().updateOne({ sinchId }, { $set: { read: true } }, IGNORE_UNDEFINED);
  return res.matchedCount > 0;
}

/** Count of unread inbound faxes (for the badge). */
export async function countUnreadInbound(): Promise<number> {
  await client.connect();
  return col().countDocuments({ direction: 'INBOUND', read: false });
}
