/** Store markup applied to carrier cost to get the customer (retail) price. */
export const SHIPPING_MARKUP = 1.4; // 40%

/** Customer-facing retail price for a given carrier cost (rounded to cents). */
export function retailPrice(costUSD: number): number {
  return Math.round(costUSD * SHIPPING_MARKUP * 100) / 100;
}
