import { NextRequest, NextResponse } from 'next/server';
import { stripe } from '@/lib/stripe';
import { CatalogError, REGISTER_ACCOUNT_ID, validateCatalogInput } from '@/lib/registerCatalog';
import { readCatalog, resetCatalog, writeCatalog } from '@/lib/registerCatalogStore';

/**
 * Register grid layout — categories and item order.
 *
 * Mirrors app/api/admin/settings/packing-pricing/route.ts: GET returns the saved
 * document (or shipped defaults), PUT validates-and-rejects then upserts, DELETE
 * resets. Auth is handled by proxy.ts.
 *
 * This is the ONLY route that writes the layout document, and it never touches
 * Stripe except to read which product ids currently exist — because the layout
 * must not be able to reference an item that isn't there.
 *
 * Values are re-validated on read as well as on write (normalizeCatalog), so a
 * document edited straight in Atlas cannot produce a broken grid at the counter.
 *
 * Notes: register_items_notes.md
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Ids of products currently sellable on THIS register. */
async function liveProductIds(): Promise<Set<string>> {
  const ids = new Set<string>();
  for await (const p of stripe.products.list({ active: true, limit: 100 })) {
    if (p.metadata?.account_id !== REGISTER_ACCOUNT_ID) continue;
    ids.add(p.id);
  }
  return ids;
}

export async function GET() {
  const doc = await readCatalog();
  return NextResponse.json(doc);
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    if (!process.env.STRIPE_SECRET_KEY) {
      return NextResponse.json({ error: 'Stripe is not configured.' }, { status: 503 });
    }

    const categories = validateCatalogInput(body, await liveProductIds());

    const ifUpdatedAt =
      typeof (body as { ifUpdatedAt?: unknown }).ifUpdatedAt === 'string'
        ? ((body as { ifUpdatedAt: string }).ifUpdatedAt)
        : null;

    const res = await writeCatalog(categories, ifUpdatedAt);
    if (!res.ok) {
      return NextResponse.json(
        { error: 'The layout changed on another terminal. Reload and try again.' },
        { status: 409 }
      );
    }
    return NextResponse.json({ categories, updatedAt: res.updatedAt });
  } catch (err) {
    if (err instanceof CatalogError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error('[register catalog]', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Could not save the layout.' }, { status: 500 });
  }
}

/** Clear all grouping — the register returns to a flat alphabetical grid. */
export async function DELETE() {
  await resetCatalog();
  return NextResponse.json({ categories: [], updatedAt: null });
}
