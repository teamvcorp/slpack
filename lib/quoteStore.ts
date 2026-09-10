import client, { IGNORE_UNDEFINED } from '@/lib/mongodb';
import { randomUUID } from 'crypto';

/**
 * Server-side shipping quotes (2026-09-10) — the record that makes a charge
 * amount trustworthy.
 *
 * WHY: the freight price is computed in the browser and both billing routes
 * trust the amount the browser sends, so a tampered client can pay a cent for a
 * real label. The fix is for the SERVER to remember what it quoted: when a rate
 * route prices a shipment it stores the authoritative retail here and hands the
 * browser only a `quoteId`; the billing route recomputes the charge from the
 * stored quote, and submit refuses to mint a label unless a succeeded payment
 * covers it. The browser never gets to name the price.
 *
 * Gated on PAYMENT_BINDING_ENABLED: while it is off, quotes may still be written
 * (harmless) but nothing REQUIRES or enforces them, so behavior is unchanged.
 * Turn it on only once the client is shipping quoteIds and the flow is tested in
 * Stripe test mode.
 *
 * Single-use: `consumeQuote` marks a quote spent so one paid quote cannot mint
 * two labels. A short TTL bounds the collection and forces re-quoting of stale
 * prices (carrier costs move).
 */
const DB = 'slpack';
const COLLECTION = 'quotes';

/** How long a quote may be paid against. Matches the rate-staleness window. */
export const QUOTE_TTL_MS = 30 * 60 * 1000;

export interface ShippingQuote {
  quoteId: string;
  carrier: string;
  serviceCode: string;
  serviceName: string;
  /** The carrier's cost basis this price was derived from (audit / margin). */
  costBasisUSD: number;
  /** The authoritative freight retail — what the customer must pay for freight. */
  retailUSD: number;
  createdAt: Date;
  expiresAt: Date;
  consumedAt?: Date;
}

/** True once payment binding is switched on. The single enforcement switch. */
export function paymentBindingEnabled(): boolean {
  return process.env.PAYMENT_BINDING_ENABLED === 'true';
}

function col() {
  return client.db(DB).collection<ShippingQuote>(COLLECTION);
}

/** Persist a priced rate and return its id + expiry. */
export async function createQuote(input: {
  carrier: string;
  serviceCode: string;
  serviceName: string;
  costBasisUSD: number;
  retailUSD: number;
}): Promise<{ quoteId: string; expiresAt: Date }> {
  await client.connect();
  const now = new Date();
  const quote: ShippingQuote = {
    quoteId: randomUUID(),
    carrier: input.carrier,
    serviceCode: input.serviceCode,
    serviceName: input.serviceName,
    costBasisUSD: Math.round(Number(input.costBasisUSD) * 100) / 100,
    retailUSD: Math.round(Number(input.retailUSD) * 100) / 100,
    createdAt: now,
    expiresAt: new Date(now.getTime() + QUOTE_TTL_MS),
  };
  await col().insertOne(quote, IGNORE_UNDEFINED);
  return { quoteId: quote.quoteId, expiresAt: quote.expiresAt };
}

/** Fetch a quote that is still valid (exists, unexpired, unconsumed). */
export async function getValidQuote(quoteId: string): Promise<ShippingQuote | null> {
  if (typeof quoteId !== 'string' || !quoteId) return null;
  await client.connect();
  const q = await col().findOne({ quoteId });
  if (!q) return null;
  if (q.consumedAt) return null;
  if (new Date(q.expiresAt).getTime() <= Date.now()) return null;
  return q;
}

/**
 * Atomically mark a quote consumed. Returns the quote if THIS call claimed it,
 * null if it was already consumed/expired/missing — so two concurrent submits
 * for one quote cannot both mint a label.
 */
export async function consumeQuote(quoteId: string): Promise<ShippingQuote | null> {
  if (typeof quoteId !== 'string' || !quoteId) return null;
  await client.connect();
  const res = await col().findOneAndUpdate(
    { quoteId, consumedAt: { $exists: false }, expiresAt: { $gt: new Date() } },
    { $set: { consumedAt: new Date() } },
    { returnDocument: 'before' }
  );
  return res ?? null;
}
