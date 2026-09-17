import client from '@/lib/mongodb';
import { normalizeCatalog, type RegisterCatalogDoc, type RegisterCategory } from '@/lib/registerCatalog';

/**
 * Persistence for the register GRID LAYOUT — category names and the order of
 * items within them. One document in slpack.settings, alongside packingPricing
 * and carrierIncentives.
 *
 * ⚠️ THIS DOCUMENT CONTAINS NO PRICES, AND MUST NOT. Stripe owns identity and
 * money; this owns presentation only. That split is what keeps a corrupt, stale
 * or hand-edited layout from being able to influence a charge — lib/registerPricing.ts
 * still re-fetches every amount from Stripe. Storing amounts here would recreate
 * exactly the client-trusted-price hole the pricing module exists to prevent.
 *
 * Order is an array index rather than a numeric sort field, which makes gaps and
 * duplicate positions impossible by construction, and makes a reorder one
 * document write instead of one API call per item.
 *
 * Notes: register_items_notes.md
 */

const DB = 'slpack';
const COLLECTION = 'settings';
const ID = 'registerCatalog';

interface CatalogDbDoc {
  _id: string;
  categories?: unknown;
  updatedAt?: string;
}

function col() {
  return client.db(DB).collection<CatalogDbDoc>(COLLECTION);
}

/**
 * Read the saved layout, normalized. Never throws on a malformed document — a
 * broken layout degrades to "no grouping", which still sells.
 */
export async function readCatalog(): Promise<RegisterCatalogDoc> {
  await client.connect();
  const doc = await col().findOne({ _id: ID });
  return normalizeCatalog(doc ?? undefined);
}

export interface WriteResult {
  ok: boolean;
  /** Set when the write was refused because someone else saved first. */
  conflict?: boolean;
  updatedAt: string | null;
}

/**
 * Replace the layout wholesale, guarded by optimistic concurrency.
 *
 * Two people reordering on two terminals is a real scenario in a shop, and a
 * blind overwrite would silently discard whichever save landed first. The
 * caller passes the updatedAt it last read; if the stored value moved, nothing
 * is written and the caller is told to reload.
 */
export async function writeCatalog(
  categories: RegisterCategory[],
  ifUpdatedAt: string | null
): Promise<WriteResult> {
  await client.connect();
  const updatedAt = new Date().toISOString();

  const filter =
    ifUpdatedAt == null
      ? // First write: succeed only if no document exists yet.
        { _id: ID, updatedAt: { $exists: false } }
      : { _id: ID, updatedAt: ifUpdatedAt };

  try {
    const res = await col().updateOne(filter, { $set: { categories, updatedAt } }, { upsert: true });
    if (res.matchedCount === 0 && res.upsertedCount === 0) {
      return { ok: false, conflict: true, updatedAt: null };
    }
    return { ok: true, updatedAt };
  } catch (err) {
    // Duplicate key on the upsert means a document already exists but didn't
    // match the filter — i.e. someone else saved between our read and write.
    if ((err as { code?: number })?.code === 11000) {
      return { ok: false, conflict: true, updatedAt: null };
    }
    throw err;
  }
}

/** Reset to no grouping — the register falls back to a flat alphabetical grid. */
export async function resetCatalog(): Promise<void> {
  await client.connect();
  await col().deleteOne({ _id: ID });
}

/**
 * Remove one product from whatever category holds it.
 *
 * Called after archiving an item so its slot closes up. groupProducts() already
 * ignores ids that no longer resolve, so this is tidiness rather than
 * correctness — the grid renders right either way.
 */
export async function pruneProductFromCatalog(productId: string): Promise<void> {
  await client.connect();
  await col().updateOne(
    { _id: ID },
    { $pull: { 'categories.$[].productIds': productId } as never }
  );
}
