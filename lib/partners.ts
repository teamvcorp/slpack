import client, { IGNORE_UNDEFINED } from '@/lib/mongodb';
import { randomUUID, randomBytes, scryptSync, timingSafeEqual } from 'crypto';

/**
 * Partner credential store for the Partner Shipping API (2026-09-10).
 *
 * WHY isolated: mainstreet-shops.com (a sister e-commerce site) calls slpack
 * server-to-server to buy labels. Those callers authenticate with a STATIC
 * issued credential — a public `keyId` (the "name", sent as X-Partner-Id) plus a
 * high-entropy `secret` (the "password", sent as X-Partner-Secret). This store
 * is completely separate from the admin passcode/session model so a partner
 * credential can never satisfy the counter/admin gate, and a bug here cannot
 * touch admin auth. See PARTNER_API.md and lib/partnerAuth.ts.
 *
 * The secret is stored ONLY as a scrypt hash with a per-credential random salt —
 * never reversibly. We generate the secret ourselves (256 bits of randomness),
 * so it is not brute-forceable; scrypt + salt is defense in depth and matches
 * the constant-time compare used for the admin passcode.
 *
 * The whole feature is inert unless PARTNER_API_SECRET is set (master switch,
 * fail-closed) — see partnerApiEnabled(). Deploying these files changes nothing
 * until that env var exists AND a partner has been issued a credential.
 */
const DB = 'slpack';
const COLLECTION = 'partners';

/** scrypt output length in bytes. */
const KEY_LEN = 64;

export interface PartnerRecord {
  /** Internal stable id — never sent by or shown to the caller. */
  partnerId: string;
  /** Public credential id the caller sends as X-Partner-Id (unique). */
  keyId: string;
  displayName: string;
  /** Default "email the label here" address for self_ship. */
  businessEmail: string;
  /** scrypt(secret, secretSalt) hex — the only copy of the secret we keep. */
  secretHash: string;
  /** Per-credential random salt (hex). */
  secretSalt: string;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
  lastUsedAt?: Date;
}

/** What admin views may see — the secret material is never projected out. */
export interface PartnerPublic {
  partnerId: string;
  keyId: string;
  displayName: string;
  businessEmail: string;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
  lastUsedAt?: Date;
}

/**
 * Master on/off switch. The Partner API is fully inert (routes 404) unless this
 * env var is set, exactly like SESSION_SECRET / PAYMENT_BINDING_ENABLED gate
 * their features. Fail-closed: unset means the feature does not exist.
 */
export function partnerApiEnabled(): boolean {
  return Boolean(process.env.PARTNER_API_SECRET);
}

function col() {
  return client.db(DB).collection<PartnerRecord>(COLLECTION);
}

const PUBLIC_PROJECTION = {
  _id: 0,
  partnerId: 1,
  keyId: 1,
  displayName: 1,
  businessEmail: 1,
  active: 1,
  createdAt: 1,
  updatedAt: 1,
  lastUsedAt: 1,
} as const;

/** scrypt a secret against a salt, returning the hex digest. */
function hashSecret(secret: string, saltHex: string): string {
  return scryptSync(secret, Buffer.from(saltHex, 'hex'), KEY_LEN).toString('hex');
}

/** A fresh public keyId (the caller's "name"). Prefixed for humans; opaque. */
function newKeyId(): string {
  return `slp_${randomBytes(10).toString('hex')}`;
}

/** A fresh secret (the caller's "password"). 256 bits, shown to admin once. */
function newSecret(): string {
  return `sk_${randomBytes(32).toString('hex')}`;
}

/**
 * Create a partner and return the ONE-TIME plaintext secret alongside the public
 * record. The secret is never retrievable again — only its scrypt hash is
 * stored. Caller (admin route) must surface it to the operator exactly once.
 */
export async function createPartner(input: {
  displayName: string;
  businessEmail: string;
}): Promise<{ partner: PartnerPublic; secret: string }> {
  await client.connect();
  const now = new Date();
  const secret = newSecret();
  const secretSalt = randomBytes(16).toString('hex');

  // Retry on the astronomically unlikely keyId collision (unique index).
  for (let attempt = 0; attempt < 5; attempt++) {
    const keyId = newKeyId();
    const record: PartnerRecord = {
      partnerId: randomUUID(),
      keyId,
      displayName: String(input.displayName || '').trim().slice(0, 120) || 'Partner',
      businessEmail: String(input.businessEmail || '').trim().slice(0, 200),
      secretHash: hashSecret(secret, secretSalt),
      secretSalt,
      active: true,
      createdAt: now,
      updatedAt: now,
    };
    try {
      await col().insertOne(record, IGNORE_UNDEFINED);
      const { secretHash: _h, secretSalt: _s, ...pub } = record;
      void _h; void _s;
      return { partner: pub, secret };
    } catch (err: unknown) {
      // Duplicate key on keyId → try another; anything else is a real failure.
      if (err && typeof err === 'object' && (err as { code?: number }).code === 11000) continue;
      throw err;
    }
  }
  throw new Error('Could not allocate a unique partner keyId');
}

/** Fetch the FULL record (incl. secret hash) for auth. Internal use only. */
export async function getPartnerByKeyId(keyId: string): Promise<PartnerRecord | null> {
  if (typeof keyId !== 'string' || !keyId) return null;
  await client.connect();
  return col().findOne({ keyId });
}

/**
 * Constant-time verify a presented secret against a stored record.
 *
 * Always does the scrypt work (even when lengths differ) so a caller cannot
 * distinguish "wrong length" from "wrong secret" by timing. The unknown-keyId
 * case is handled by the auth wrapper with a dummy hash of equal cost.
 */
export function verifyPartnerSecret(record: PartnerRecord, presented: string): boolean {
  if (typeof presented !== 'string' || !presented) return false;
  let computed: Buffer;
  try {
    computed = scryptSync(presented, Buffer.from(record.secretSalt, 'hex'), KEY_LEN);
  } catch {
    return false;
  }
  const stored = Buffer.from(record.secretHash, 'hex');
  if (computed.length !== stored.length) return false;
  return timingSafeEqual(computed, stored);
}

/**
 * Burn the same scrypt cost as a real verify, then fail. Called when the keyId
 * is unknown so an attacker cannot tell "no such partner" from "wrong secret" by
 * timing (user enumeration). The salt is a process-lifetime constant of the same
 * length as a real one, so the work is identical.
 */
const DUMMY_SALT = randomBytes(16);
export function dummyVerify(presented: unknown): boolean {
  try {
    scryptSync(typeof presented === 'string' && presented ? presented : 'x', DUMMY_SALT, KEY_LEN);
  } catch {
    /* ignore — this path only exists to spend time */
  }
  return false;
}

/** Stamp last-used (best-effort; never throws into the request path). */
export async function touchPartnerUsed(partnerId: string): Promise<void> {
  try {
    await client.connect();
    await col().updateOne(
      { partnerId },
      { $set: { lastUsedAt: new Date() } },
      IGNORE_UNDEFINED
    );
  } catch (err) {
    console.error('[partners] touch failed', err instanceof Error ? err.message : err);
  }
}

/** Admin: list partners (secret material excluded by projection). */
export async function listPartners(): Promise<PartnerPublic[]> {
  await client.connect();
  return col()
    .find({}, { projection: PUBLIC_PROJECTION })
    .sort({ createdAt: -1 })
    .toArray() as unknown as Promise<PartnerPublic[]>;
}

/** Admin: fetch one partner (public projection). */
export async function getPartnerPublic(partnerId: string): Promise<PartnerPublic | null> {
  await client.connect();
  return col().findOne(
    { partnerId },
    { projection: PUBLIC_PROJECTION }
  ) as unknown as Promise<PartnerPublic | null>;
}

/** Admin: update mutable fields (never the secret here). */
export async function updatePartner(
  partnerId: string,
  patch: { displayName?: string; businessEmail?: string; active?: boolean }
): Promise<PartnerPublic | null> {
  await client.connect();
  const $set: Record<string, unknown> = { updatedAt: new Date() };
  if (typeof patch.displayName === 'string') $set.displayName = patch.displayName.trim().slice(0, 120);
  if (typeof patch.businessEmail === 'string') $set.businessEmail = patch.businessEmail.trim().slice(0, 200);
  if (typeof patch.active === 'boolean') $set.active = patch.active;
  await col().updateOne({ partnerId }, { $set }, IGNORE_UNDEFINED);
  return getPartnerPublic(partnerId);
}

/**
 * Admin: rotate the secret. Returns the new one-time plaintext. The old secret
 * stops working immediately (fresh salt + hash overwrite the record).
 */
export async function rotatePartnerSecret(
  partnerId: string
): Promise<{ secret: string } | null> {
  await client.connect();
  const secret = newSecret();
  const secretSalt = randomBytes(16).toString('hex');
  const res = await col().updateOne(
    { partnerId },
    { $set: { secretHash: hashSecret(secret, secretSalt), secretSalt, updatedAt: new Date() } },
    IGNORE_UNDEFINED
  );
  if (!res.matchedCount) return null;
  return { secret };
}
