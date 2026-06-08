/** Iowa state sales tax. Override with NEXT_PUBLIC_SALES_TAX_RATE (e.g. 0.07). */
export const SALES_TAX_RATE = Number(process.env.NEXT_PUBLIC_SALES_TAX_RATE ?? '0.07');

/** A product pulled from the Stripe catalog (one active product + its default price). */
export interface RegisterProduct {
  /** Stripe product id (prod_…) */
  id: string;
  name: string;
  description: string | null;
  /** Stripe price id (price_…) of the product's default price */
  priceId: string;
  unitAmountUSD: number;
  /** Optional product image URL */
  image: string | null;
}

/** A line in the register cart — either a catalog product or a custom amount. */
export interface RegisterLineItem {
  /** Stable client id: the Stripe price id, or "custom-<uuid>" for ad-hoc items */
  id: string;
  name: string;
  /** Stripe price id, or null for a custom/misc line item */
  priceId: string | null;
  unitAmountUSD: number;
  quantity: number;
}

/** Persisted line item (subset of cart item plus computed line total). */
export interface SaleLineItem {
  name: string;
  priceId: string | null;
  unitAmountUSD: number;
  quantity: number;
  lineTotalUSD: number;
}

/** One completed register sale — stored in slpack.sales. */
export interface SaleRecord {
  id: string;
  timestamp: string; // ISO
  items: SaleLineItem[];
  subtotalUSD: number;
  taxRate: number;
  taxUSD: number;
  totalUSD: number;
  paymentMethod: 'card' | 'cash';
  customerEmail?: string;
  /** Stripe PaymentIntent id for card sales */
  paymentIntentId?: string;
  /** Cash handling — recorded when the cashier enters an amount tendered */
  cashTenderedUSD?: number;
  changeDueUSD?: number;
}
