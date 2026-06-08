import type Stripe from 'stripe';
import type { RegisterLineItem, SaleLineItem } from '@/app/admin/types/register';

export interface PricedCart {
  items: SaleLineItem[];
  subtotalUSD: number;
  taxRate: number;
  taxUSD: number;
  totalUSD: number;
}

/**
 * Authoritatively prices a register cart. Catalog line items (with a Stripe
 * priceId) are re-priced from Stripe so amounts can't be tampered with or go
 * stale; custom/misc items use the cashier-entered amount. All math is done in
 * integer cents to avoid floating-point drift, then converted to USD.
 */
export async function priceCart(
  stripe: Stripe,
  rawItems: RegisterLineItem[],
  taxRate: number
): Promise<PricedCart> {
  const safeTaxRate = Math.max(0, Number(taxRate) || 0);
  const priceCache = new Map<string, number>();
  const items: SaleLineItem[] = [];
  let subtotalCents = 0;

  for (const it of rawItems) {
    const qty = Math.max(1, Math.floor(Number(it.quantity) || 1));
    let unitCents: number;
    if (it.priceId) {
      if (!priceCache.has(it.priceId)) {
        const price = await stripe.prices.retrieve(it.priceId);
        if (price.unit_amount == null) {
          throw new Error(`Price ${it.priceId} has no fixed amount`);
        }
        priceCache.set(it.priceId, price.unit_amount);
      }
      unitCents = priceCache.get(it.priceId)!;
    } else {
      unitCents = Math.round(Math.max(0, Number(it.unitAmountUSD) || 0) * 100);
    }

    const lineCents = unitCents * qty;
    subtotalCents += lineCents;
    items.push({
      name: it.name,
      priceId: it.priceId ?? null,
      unitAmountUSD: unitCents / 100,
      quantity: qty,
      lineTotalUSD: lineCents / 100,
    });
  }

  const taxCents = Math.round(subtotalCents * safeTaxRate);
  const totalCents = subtotalCents + taxCents;

  return {
    items,
    subtotalUSD: subtotalCents / 100,
    taxRate: safeTaxRate,
    taxUSD: taxCents / 100,
    totalUSD: totalCents / 100,
  };
}
