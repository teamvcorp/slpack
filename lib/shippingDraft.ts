import type { CartItem, ShipmentInput } from '@/app/admin/types/shipping';

/**
 * In-progress shipment, held across a tab change.
 *
 * WHY: every admin tab is a route, so navigating to the box calculator, the
 * register or Reports unmounts /admin/shipping and takes a half-entered
 * shipment with it. Staff were re-keying customer and address details, which is
 * both slow and a chance to get them wrong.
 *
 * sessionStorage, exactly like lib/comboHandoff.ts and for the same reason:
 * this is one counter on one browser tab. It also means the draft dies with the
 * tab, which is the right lifetime for customer PII. Never localStorage. No card
 * data goes near it — Stripe holds that.
 */

const KEY = 'slpack.shippingDraft';

export interface ShippingDraft {
  /** The form's shipment inputs. Null before the form has produced one. */
  shipment: ShipmentInput | null;
  /** Packages already added to the cart. */
  cart: CartItem[];
  /** ISO timestamp of the last write, for display in the restore banner. */
  savedAt: string;
}

/**
 * NOTE what is deliberately absent: rates, quotedAt, hasCompared.
 *
 * Restoring a QUOTE across a tab switch would resurrect a price that may predate
 * a deploy or a carrier rate change — precisely what isQuoteStale() and the
 * rate-signature guard on the shipping page exist to prevent. The inputs come
 * back; the panels stay empty until staff press Compare again.
 */
export function saveShippingDraft(draft: Omit<ShippingDraft, 'savedAt'>): void {
  if (typeof window === 'undefined') return;
  try {
    const payload: ShippingDraft = { ...draft, savedAt: new Date().toISOString() };
    window.sessionStorage.setItem(KEY, JSON.stringify(payload));
  } catch {
    // sessionStorage unavailable (private mode / quota) — non-fatal, the page
    // just behaves as it did before drafts existed.
  }
}

/** The stored draft, or null when there is none or it is unreadable. */
export function readShippingDraft(): ShippingDraft | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ShippingDraft> | null;
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      shipment: (parsed.shipment as ShipmentInput | null) ?? null,
      cart: Array.isArray(parsed.cart) ? (parsed.cart as CartItem[]) : [],
      savedAt: typeof parsed.savedAt === 'string' ? parsed.savedAt : '',
    };
  } catch {
    return null;
  }
}

/**
 * Drop the draft.
 *
 * Called when the shipment is genuinely FINISHED — payment complete and the
 * label printed — and on the register handoff, where stashShippingCart() takes
 * ownership instead. A draft that outlives its shipment would reappear looking
 * like fresh entry, which is the same failure shape as a prefilled weight.
 */
export function clearShippingDraft(): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(KEY);
  } catch {
    // Non-fatal.
  }
}

/**
 * Merge fields into the stored shipment without disturbing the rest.
 *
 * Used by the box calculator's "Add to current shipment", which knows the box
 * dimensions but nothing about the customer — so it must not overwrite a
 * half-entered address. Creates a draft if none exists yet.
 */
export function mergeIntoShippingDraft(patch: Partial<ShipmentInput>): void {
  const existing = readShippingDraft();
  const shipment = {
    ...(existing?.shipment ?? {}),
    ...patch,
  } as ShipmentInput;
  saveShippingDraft({ shipment, cart: existing?.cart ?? [] });
}
