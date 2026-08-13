import { NextRequest, NextResponse } from 'next/server';
import client from '@/lib/mongodb';
import { DEFAULT_PACKING_RATES, normalizePackingRates, type PackingRates } from '@/lib/boxOptimizer';

/**
 * Packing-charge pricing for the box size calculator. Persisted as a single doc
 * in slpack.settings so staff can change what the shop charges without a
 * redeploy, and every counter terminal agrees on the price.
 *
 * Access is gated by the admin session (see proxy.ts) — this route lives under
 * /api coverage, so no per-route auth check is needed.
 *
 * Values are re-validated on read as well as write: a doc edited directly in
 * the database must not be able to produce a nonsense quote at the counter.
 */
export const runtime = 'nodejs';

const DB = 'slpack';
const COLLECTION = 'settings';
const ID = 'packingPricing';

interface PackingPricingDoc extends PackingRates {
  _id: string;
  updatedAt?: string;
}

function col() {
  return client.db(DB).collection<PackingPricingDoc>(COLLECTION);
}

export async function GET() {
  await client.connect();
  const doc = await col().findOne({ _id: ID });
  // No saved doc yet → the shipped defaults.
  return NextResponse.json({
    ...normalizePackingRates(doc ?? DEFAULT_PACKING_RATES),
    updatedAt: doc?.updatedAt ?? null,
  });
}

export async function PUT(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  // Reject rather than silently clamp — a typo'd price should be visible to the
  // person typing it, not quietly replaced by a default they didn't choose.
  const fields: Array<keyof PackingRates> = ['light', 'standard', 'fragile', 'box'];
  for (const f of fields) {
    const n = Number((body as Record<string, unknown>)[f]);
    if (!Number.isFinite(n) || n < 0 || n > 1) {
      return NextResponse.json(
        { error: `${f} must be a rate between $0.00 and $1.00 per square inch.` },
        { status: 400 }
      );
    }
  }
  const mult = Number((body as Record<string, unknown>).retailMultiplier);
  if (!Number.isFinite(mult) || mult < 1 || mult > 20) {
    return NextResponse.json(
      { error: 'Retail multiplier must be between 1 and 20.' },
      { status: 400 }
    );
  }

  const rates = normalizePackingRates(body);
  const updatedAt = new Date().toISOString();

  await client.connect();
  await col().updateOne({ _id: ID }, { $set: { ...rates, updatedAt } }, { upsert: true });
  return NextResponse.json({ ...rates, updatedAt });
}

/** Reset to the shipped defaults. */
export async function DELETE() {
  await client.connect();
  await col().deleteOne({ _id: ID });
  return NextResponse.json({ ...DEFAULT_PACKING_RATES, updatedAt: null });
}
