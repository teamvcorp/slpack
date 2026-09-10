import client, { IGNORE_UNDEFINED } from '@/lib/mongodb';
import { randomUUID } from 'crypto';

/**
 * Server-side quotes for the Partner Shipping API (2026-09-10).
 *
 * A SEPARATE collection from the counter's `quotes` (lib/quoteStore.ts), so a
 * partner-path bug can never touch the counter's payment binding. It also stores
 * MORE than the counter quote: the destination, the package, and the fulfillment
 * mode — because the partner flow references the quote at /shipments instead of
 * re-sending parcel + price (the caller cannot quote one parcel and ship
 * another, and cannot restate the price).
 *
 * The stored `retailUSD` is what the consumer must have paid; the API verifies
 * the Stripe PaymentIntent covers it before minting a label. Cost basis is kept
 * for audit but NEVER returned to the partner.
 *
 * Single-use + short TTL, exactly like the counter quote: one paid quote → at
 * most one label, and stale carrier prices are forced to re-quote.
 */
const DB = 'slpack';
const COLLECTION = 'partnerQuotes';

/** Match the counter quote window. Also surfaced to callers as a countdown. */
export const PARTNER_QUOTE_TTL_MS = 30 * 60 * 1000;

export type PartnerMode = 'self_ship' | 'pickup_pack';

export interface PartnerQuoteDest {
  zip: string;
  city?: string;
  state?: string;
  country: string;
  residential: boolean;
}

export interface PartnerQuotePackage {
  weightLbs: number;
  lengthIn: number;
  widthIn: number;
  heightIn: number;
}

export interface PartnerQuote {
  quoteId: string;
  /** The partner who requested it — quotes are consumed scoped to this (IDOR). */
  partnerId: string;
  carrier: string;
  serviceCode: string;
  serviceName: string;
  mode: PartnerMode;
  /** Carrier cost basis (audit / margin) — server-side only, never returned. */
  costBasisUSD: number;
  /** Retail freight portion. */
  freightRetailUSD: number;
  /** Packing fee (0 for self_ship; the shop's packing charge for pickup_pack). */
  packingFeeUSD: number;
  /** What the consumer must pay = freight + packing. The PI must cover this. */
  retailUSD: number;
  dest: PartnerQuoteDest;
  pkg: PartnerQuotePackage;
  createdAt: Date;
  expiresAt: Date;
  consumedAt?: Date;
}

function col() {
  return client.db(DB).collection<PartnerQuote>(COLLECTION);
}

const money = (n: number) => Math.round(Number(n) * 100) / 100;

/** Persist a priced partner rate and return its id + expiry. */
export async function createPartnerQuote(input: {
  partnerId: string;
  carrier: string;
  serviceCode: string;
  serviceName: string;
  mode: PartnerMode;
  costBasisUSD: number;
  freightRetailUSD: number;
  packingFeeUSD: number;
  dest: PartnerQuoteDest;
  pkg: PartnerQuotePackage;
}): Promise<{ quoteId: string; retailUSD: number; expiresAt: Date }> {
  await client.connect();
  const now = new Date();
  const retailUSD = money(input.freightRetailUSD + input.packingFeeUSD);
  const quote: PartnerQuote = {
    quoteId: randomUUID(),
    partnerId: input.partnerId,
    carrier: input.carrier,
    serviceCode: input.serviceCode,
    serviceName: input.serviceName,
    mode: input.mode,
    costBasisUSD: money(input.costBasisUSD),
    freightRetailUSD: money(input.freightRetailUSD),
    packingFeeUSD: money(input.packingFeeUSD),
    retailUSD,
    dest: input.dest,
    pkg: input.pkg,
    createdAt: now,
    expiresAt: new Date(now.getTime() + PARTNER_QUOTE_TTL_MS),
  };
  await col().insertOne(quote, IGNORE_UNDEFINED);
  return { quoteId: quote.quoteId, retailUSD, expiresAt: quote.expiresAt };
}

/**
 * Fetch a quote that is still valid (exists, owned by THIS partner, unexpired,
 * unconsumed). Scoping by partnerId is the IDOR guard — a partner can only act
 * on its own quotes.
 */
export async function getValidPartnerQuote(
  partnerId: string,
  quoteId: string
): Promise<PartnerQuote | null> {
  if (!partnerId || typeof quoteId !== 'string' || !quoteId) return null;
  await client.connect();
  const q = await col().findOne({ quoteId, partnerId });
  if (!q) return null;
  if (q.consumedAt) return null;
  if (new Date(q.expiresAt).getTime() <= Date.now()) return null;
  return q;
}

/**
 * Atomically mark a quote consumed, scoped to the owning partner. Returns the
 * quote if THIS call claimed it, null if already consumed/expired/missing — so a
 * retried /shipments cannot mint two labels for one paid quote.
 */
export async function consumePartnerQuote(
  partnerId: string,
  quoteId: string
): Promise<PartnerQuote | null> {
  if (!partnerId || typeof quoteId !== 'string' || !quoteId) return null;
  await client.connect();
  const res = await col().findOneAndUpdate(
    { quoteId, partnerId, consumedAt: { $exists: false }, expiresAt: { $gt: new Date() } },
    { $set: { consumedAt: new Date() } },
    { returnDocument: 'before' }
  );
  return res ?? null;
}
