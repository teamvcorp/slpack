/**
 * Fax service pricing (public /#solutions card and the in-store quote).
 *
 * Outgoing: $2.00 for the first page, $1.00 for each additional page. A cover
 * page is added free and is NOT billed — only the customer's own pages count.
 * Incoming: $1.00 per page, printed and held for pickup.
 *
 * Our carrier cost is ~$0.045/page (Sinch), so these are retail counter prices,
 * not a cost pass-through — see sinch_fax_notes.md.
 *
 * Pure module (no browser/node-only deps) so it can be used from a client
 * component or a server route. `money` is re-exported rather than redefined to
 * avoid a third copy of the same formatter in lib/.
 */
export { money } from './printPricing';

export const FAX_PRICING = {
  outbound: {
    label: 'Send a fax',
    firstPage: 2.0,
    additionalPage: 1.0,
    /** Cover page is included at no charge and never billed. */
    coverPageFree: true,
  },
  inbound: {
    label: 'Receive a fax',
    perPage: 1.0,
  },
} as const;

const round2 = (n: number) => Math.round(n * 100) / 100;

export type FaxDirection = 'outbound' | 'inbound';

export interface FaxQuote {
  direction: FaxDirection;
  /** Billable pages (the customer's document; a cover page is free). */
  pages: number;
  total: number;
}

/**
 * Price a fax. Outgoing is first-page + per-additional; incoming is flat per
 * page. Non-finite or negative page counts clamp to 0 (a 0-page fax is $0).
 */
export function computeFaxPrice(input: { pages: number; direction: FaxDirection }): FaxQuote {
  const pages = Number.isFinite(input.pages) ? Math.max(0, Math.floor(input.pages)) : 0;

  let total = 0;
  if (pages > 0) {
    total =
      input.direction === 'inbound'
        ? pages * FAX_PRICING.inbound.perPage
        : FAX_PRICING.outbound.firstPage + (pages - 1) * FAX_PRICING.outbound.additionalPage;
  }

  return { direction: input.direction, pages, total: round2(total) };
}
