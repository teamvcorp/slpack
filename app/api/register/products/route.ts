import { NextResponse } from 'next/server';
import type { RegisterProduct } from '@/app/admin/types/register';
import { REGISTER_ACCOUNT_ID, groupProducts } from '@/lib/registerCatalog';
import { readCatalog } from '@/lib/registerCatalogStore';

// Only show products tagged for this shop's account in Stripe metadata
// (account_id) -- the Stripe account is shared with another site.

// NOT cached. This was `revalidate = 60`, which meant a price corrected in the
// admin (or the Stripe Dashboard) could take a minute to reach the counter --
// long enough to ring up a customer at the old price. This is admin-only traffic
// behind the proxy, so caching bought almost nothing. The cost of dropping it is
// one products.list pagination per register load; limit:100 makes that a single
// request in practice.
//
// Do NOT "optimize" this later with stripe.products.search: it supports
// metadata['account_id'] filtering but is eventually consistent, with up to about
// a minute of lag on newly created and updated objects -- reintroducing exactly
// the staleness removed here.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    if (!process.env.STRIPE_SECRET_KEY) {
      return NextResponse.json(
        { error: 'Stripe not configured (STRIPE_SECRET_KEY missing)' },
        { status: 503 }
      );
    }

    const Stripe = (await import('stripe')).default;
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: '2025-02-24.acacia',
    });

    // Metadata isn't filterable in products.list, so auto-paginate the full
    // active catalog and filter by account_id ourselves — this way matching
    // products beyond the first page are never missed.
    const products: RegisterProduct[] = [];
    for await (const p of stripe.products.list({
      active: true,
      limit: 100,
      expand: ['data.default_price'],
    })) {
      // Only this shop's products.
      if (p.metadata?.account_id !== REGISTER_ACCOUNT_ID) continue;

      const price = p.default_price;
      // Skip products with no usable default price (unset, tiered, or non-USD).
      if (!price || typeof price === 'string') continue;
      if (price.currency !== 'usd' || price.unit_amount == null) continue;

      products.push({
        id: p.id,
        name: p.name,
        description: p.description,
        priceId: price.id,
        unitAmountUSD: price.unit_amount / 100,
        image: p.images?.[0] ?? null,
      });
    }

    products.sort((a, b) => a.name.localeCompare(b.name));

    // Grouping is a pure enhancement layered on a working register: if the saved
    // layout is missing or Mongo is unreachable, `groups` collapses to a single
    // "Other" section holding everything, i.e. the flat alphabetical grid this
    // route has always returned. Selling never depends on it.
    let groups;
    try {
      groups = groupProducts(products, await readCatalog());
    } catch (err) {
      console.error('[register products] layout read failed', err instanceof Error ? err.message : err);
      groups = groupProducts(products, null);
    }

    // `products` keeps its exact historical shape so a browser still running the
    // previous build keeps working while a deploy rolls out. `groups` carries ids
    // only -- each product crosses the wire once.
    return NextResponse.json({ products, groups });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
