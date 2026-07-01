import type { CartItem } from '@/app/admin/types/shipping';

/**
 * Single-counter handoff of built shipping packages from the shipping page to
 * the register, so a cashier can charge retail items + shipping in one sale.
 *
 * Uses sessionStorage — scoped to the one POS browser/tab, which is exactly the
 * counter workflow. (If this ever needs to span devices, promote to a
 * server-side draft cart keyed by a code.)
 */
const KEY = 'slpack.pendingShipping';

/** Stash the shipping cart, then navigate to the register to check out. */
export function stashShippingCart(items: CartItem[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(items));
  } catch {
    // sessionStorage unavailable (private mode / quota) — non-fatal.
  }
}

/** Read and clear any pending shipping cart. Returns [] when none. */
export function takeShippingCart(): CartItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (!raw) return [];
    window.sessionStorage.removeItem(KEY);
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as CartItem[]) : [];
  } catch {
    return [];
  }
}
