import { NextRequest, NextResponse } from 'next/server';
import { stripe } from '@/lib/stripe';
import {
  CatalogError,
  REGISTER_ACCOUNT_ID,
  assertNameAvailable,
  validateItemInput,
} from '@/lib/registerCatalog';

/**
 * Admin register items — list (GET) and create (POST).
 *
 * Register items ARE Stripe products; this route is the in-app editor for them
 * so staff don't have to log into the Stripe Dashboard to add a thing to sell.
 *
 * Access is gated by the admin session (see proxy.ts) — this route lives under
 * /api coverage, so no per-route auth check is needed, same as the settings routes.
 *
 * ⚠️ The Stripe account is shared with another site, so every product we create
 * MUST carry metadata.account_id = REGISTER_ACCOUNT_ID. Without that stamp the
 * item simply will not appear on the register (the products route filters on it),
 * which reads to staff as "my new item vanished".
 *
 * Notes: register_items_notes.md
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function fail(err: unknown): NextResponse {
  if (err instanceof CatalogError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  console.error('[register items]', err instanceof Error ? err.message : err);
  return NextResponse.json({ error: 'Could not reach Stripe. Try again.' }, { status: 502 });
}

interface AdminItem {
  id: string;
  name: string;
  description: string | null;
  priceId: string | null;
  unitAmountUSD: number | null;
  active: boolean;
}

/** Every active product belonging to this shop, newest first. */
async function listOwnedProducts(): Promise<AdminItem[]> {
  const items: AdminItem[] = [];
  for await (const p of stripe.products.list({
    active: true,
    limit: 100,
    expand: ['data.default_price'],
  })) {
    if (p.metadata?.account_id !== REGISTER_ACCOUNT_ID) continue;
    const price = p.default_price;
    const usable = price && typeof price !== 'string' && price.currency === 'usd' && price.unit_amount != null;
    items.push({
      id: p.id,
      name: p.name,
      description: p.description,
      // Surfaced even when unusable, so an item with a broken price is visible
      // and fixable here rather than silently missing from the register.
      priceId: usable ? (price as { id: string }).id : null,
      unitAmountUSD: usable ? (price as { unit_amount: number }).unit_amount / 100 : null,
      active: p.active,
    });
  }
  items.sort((a, b) => a.name.localeCompare(b.name));
  return items;
}

export async function GET() {
  if (!process.env.STRIPE_SECRET_KEY) {
    return NextResponse.json({ error: 'Stripe is not configured.' }, { status: 503 });
  }
  try {
    return NextResponse.json({ items: await listOwnedProducts(), accountId: REGISTER_ACCOUNT_ID });
  } catch (err) {
    return fail(err);
  }
}

export async function POST(req: NextRequest) {
  if (!process.env.STRIPE_SECRET_KEY) {
    return NextResponse.json({ error: 'Stripe is not configured.' }, { status: 503 });
  }
  try {
    const body = await req.json().catch(() => null);
    const { name, description, unitAmountCents } = validateItemInput(body, { priceRequired: true });

    const existing = await listOwnedProducts();
    assertNameAvailable(name, existing);

    // default_price_data creates the product and its price in ONE call, so there
    // is no window where a product exists with no sellable price.
    const product = await stripe.products.create(
      {
        name,
        ...(description ? { description } : {}),
        metadata: { account_id: REGISTER_ACCOUNT_ID },
        default_price_data: { currency: 'usd', unit_amount: unitAmountCents as number },
      },
      // Counter tablets lag and staff double-tap; without this a double submit
      // creates two identical products.
      { idempotencyKey: `regitem:create:${REGISTER_ACCOUNT_ID}:${name.toLowerCase()}:${unitAmountCents}` }
    );

    const price = product.default_price;
    return NextResponse.json({
      item: {
        id: product.id,
        name: product.name,
        description: product.description,
        priceId: typeof price === 'string' ? price : (price?.id ?? null),
        unitAmountUSD: (unitAmountCents as number) / 100,
        active: product.active,
      },
    });
  } catch (err) {
    return fail(err);
  }
}
