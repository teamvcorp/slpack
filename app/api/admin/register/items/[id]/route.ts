import { NextRequest, NextResponse } from 'next/server';
import { stripe } from '@/lib/stripe';
import {
  CatalogError,
  REGISTER_ACCOUNT_ID,
  assertNameAvailable,
  assertOwnedProduct,
  validateItemInput,
} from '@/lib/registerCatalog';
import { pruneProductFromCatalog } from '@/lib/registerCatalogStore';

/**
 * Admin register item — edit (PATCH) and archive (DELETE).
 *
 * ⚠️ OWNERSHIP: the Stripe account is shared with another site. The product id
 * arrives from the browser and is untrusted, so assertOwnedProduct() re-reads it
 * from Stripe and proves metadata.account_id matches THIS shop before any write.
 * Without that check an admin here could rename, reprice or archive the sister
 * site's catalog. It returns 404 (not 403) on a mismatch so this route can't be
 * used to probe which ids exist over there.
 *
 * Notes: register_items_notes.md
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function fail(err: unknown): NextResponse {
  if (err instanceof CatalogError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  console.error('[register item]', err instanceof Error ? err.message : err);
  return NextResponse.json({ error: 'Could not reach Stripe. Try again.' }, { status: 502 });
}

/** Active products for this shop — used for the duplicate-name check. */
async function ownedNames(): Promise<Array<{ id: string; name: string }>> {
  const out: Array<{ id: string; name: string }> = [];
  for await (const p of stripe.products.list({ active: true, limit: 100 })) {
    if (p.metadata?.account_id !== REGISTER_ACCOUNT_ID) continue;
    out.push({ id: p.id, name: p.name });
  }
  return out;
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!process.env.STRIPE_SECRET_KEY) {
    return NextResponse.json({ error: 'Stripe is not configured.' }, { status: 503 });
  }
  try {
    const { id } = await ctx.params;
    const body = await req.json().catch(() => null);
    const { name, description, unitAmountCents } = validateItemInput(body, { priceRequired: false });

    const product = await assertOwnedProduct(stripe, id);
    if (!product.active) {
      throw new CatalogError(409, 'This item is archived. Restore it in the Stripe Dashboard first.');
    }

    assertNameAvailable(name, await ownedNames(), id);

    const current = product.default_price;
    const currentPriceId = typeof current === 'string' ? current : (current?.id ?? null);
    const currentCents =
      current && typeof current !== 'string' && current.unit_amount != null ? current.unit_amount : null;

    let priceId = currentPriceId;
    let unitAmountUSD = currentCents == null ? null : currentCents / 100;

    // ── The immutable-price dance ────────────────────────────────────────────
    // Stripe Prices cannot be edited, so a price change means minting a new one
    // and repointing the product at it. ORDER IS LOAD-BEARING: create, then
    // swap, then archive. Archiving first and failing the create would leave the
    // product with no active price — it would vanish from the register mid-shift.
    // Stripe also refuses to deactivate a price that is still default_price, so
    // the archive must come after the swap regardless.
    if (unitAmountCents != null && unitAmountCents !== currentCents) {
      const clientRequestId = req.headers.get('x-request-id') ?? '';
      const created = await stripe.prices.create(
        { product: id, currency: 'usd', unit_amount: unitAmountCents },
        { idempotencyKey: `regprice:${id}:${unitAmountCents}:${clientRequestId}` }
      );
      await stripe.products.update(id, { default_price: created.id });
      if (currentPriceId) {
        // Best effort: a failure here leaves a stray active non-default price,
        // which the register never reads (it uses default_price only). Harmless,
        // and not worth failing an otherwise-successful price change over.
        try {
          await stripe.prices.update(currentPriceId, { active: false });
        } catch (err) {
          console.error('[register item] old price archive failed', err instanceof Error ? err.message : err);
        }
      }
      priceId = created.id;
      unitAmountUSD = unitAmountCents / 100;
    }

    if (name !== product.name || (description ?? null) !== (product.description ?? null)) {
      await stripe.products.update(id, { name, description: description ?? '' });
    }

    // Return what Stripe actually holds, so the UI shows truth rather than its
    // own optimistic guess about the new price id.
    return NextResponse.json({
      item: { id, name, description: description ?? null, priceId, unitAmountUSD, active: true },
    });
  } catch (err) {
    return fail(err);
  }
}

/**
 * Archive, not delete.
 *
 * Stripe cannot hard-delete a product that has prices, and archiving is what we
 * want anyway: the button disappears from the register immediately while past
 * sales and reports keep resolving the item correctly.
 */
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!process.env.STRIPE_SECRET_KEY) {
    return NextResponse.json({ error: 'Stripe is not configured.' }, { status: 503 });
  }
  try {
    const { id } = await ctx.params;
    await assertOwnedProduct(stripe, id);
    await stripe.products.update(id, { active: false });

    // Drop it from the saved grid layout too, so the position it occupied closes
    // up instead of leaving a gap the next editor has to tidy by hand.
    await pruneProductFromCatalog(id).catch((err) => {
      console.error('[register item] layout prune failed', err instanceof Error ? err.message : err);
    });

    return NextResponse.json({ ok: true, id });
  } catch (err) {
    return fail(err);
  }
}
