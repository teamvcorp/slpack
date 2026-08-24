import { NextRequest, NextResponse } from 'next/server';
import client from '@/lib/mongodb';
import {
  DEFAULT_CARRIER_INCENTIVES,
  INCENTIVE_CARRIERS,
  MAX_INCENTIVE,
  normalizeCarrierIncentives,
  type CarrierIncentives,
} from '@/lib/carrierIncentive';
import { SERVICE_CLASS_ORDER } from '@/lib/serviceClass';

/**
 * Our negotiated discount off each carrier's published list price, per service
 * speed. Persisted as a single doc in slpack.settings so staff can update the
 * shop's contract terms without a redeploy and every counter agrees.
 *
 * Mirrors settings/packing-pricing exactly, including its two rules:
 *  - access is gated by the admin session (proxy.ts covers /api), so no
 *    per-route auth check is needed;
 *  - values are re-validated on read as well as write, because a doc edited
 *    directly in the database must not be able to misprice the counter.
 */
export const runtime = 'nodejs';

const DB = 'slpack';
const COLLECTION = 'settings';
const ID = 'carrierIncentives';

interface IncentivesDoc {
  _id: string;
  incentives?: CarrierIncentives;
  updatedAt?: string;
}

function col() {
  return client.db(DB).collection<IncentivesDoc>(COLLECTION);
}

export async function GET() {
  await client.connect();
  const doc = await col().findOne({ _id: ID });
  // No saved doc yet → the shipped defaults (all zero: assume no discount).
  return NextResponse.json({
    incentives: normalizeCarrierIncentives(doc?.incentives ?? DEFAULT_CARRIER_INCENTIVES),
    updatedAt: doc?.updatedAt ?? null,
  });
}

export async function PUT(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const raw = (body as { incentives?: unknown }).incentives;
  if (!raw || typeof raw !== 'object') {
    return NextResponse.json({ error: 'Missing incentives object.' }, { status: 400 });
  }

  // Reject rather than silently clamp — an incentive typed as 38 instead of 0.38
  // must be visible to the person typing it. Quietly reading it as 90% off would
  // price every express shipment below cost.
  const table = raw as Record<string, Record<string, unknown>>;
  for (const carrier of INCENTIVE_CARRIERS) {
    for (const cls of SERVICE_CLASS_ORDER) {
      const value = table[carrier]?.[cls];
      if (value === null || value === undefined || value === '') continue; // → default
      const n = Number(value);
      if (!Number.isFinite(n) || n < 0 || n > MAX_INCENTIVE) {
        return NextResponse.json(
          {
            error:
              `${carrier} ${cls} incentive must be a fraction between 0 and ${MAX_INCENTIVE} ` +
              `(e.g. 0.38 for 38% off list).`,
          },
          { status: 400 }
        );
      }
    }
  }

  const incentives = normalizeCarrierIncentives(raw);
  const updatedAt = new Date().toISOString();

  await client.connect();
  await col().updateOne({ _id: ID }, { $set: { incentives, updatedAt } }, { upsert: true });
  return NextResponse.json({ incentives, updatedAt });
}

/** Reset to the shipped defaults (no assumed discount). */
export async function DELETE() {
  await client.connect();
  await col().deleteOne({ _id: ID });
  return NextResponse.json({ incentives: DEFAULT_CARRIER_INCENTIVES, updatedAt: null });
}
