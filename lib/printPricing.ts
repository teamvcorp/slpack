/**
 * Print & copy pricing (self-service quote on the public /printing page).
 *
 * Tiered per printed page (page count × copies):
 *   Black & white: $0.25 for the first 100 pages, then $0.10 each.
 *   Color:         $0.75 for the first 25 pages, then $0.50 each.
 *
 * Pure module — imported both client-side (live estimate) and server-side
 * (order confirmation email), so it must have no browser/node-only deps.
 */
export type PrintColor = 'bw' | 'color';

export const PRINT_PRICING = {
  bw: { label: 'Black & white', tierPages: 100, tierRate: 0.25, overRate: 0.1 },
  color: { label: 'Color', tierPages: 25, tierRate: 0.75, overRate: 0.5 },
} as const;

const round2 = (n: number) => Math.round(n * 100) / 100;

export interface PrintQuote {
  color: PrintColor;
  pages: number;
  copies: number;
  /** pages × copies */
  totalPages: number;
  tierPages: number;
  tierRate: number;
  overRate: number;
  /** pages billed at the first-tier rate */
  tierCount: number;
  /** pages billed at the cheaper over-tier rate */
  overCount: number;
  total: number;
}

/** Compute the estimated print price. Non-finite/negative inputs are clamped. */
export function computePrintPrice(input: {
  pages: number;
  copies: number;
  color: PrintColor;
}): PrintQuote {
  const pages = Number.isFinite(input.pages) ? Math.max(0, Math.floor(input.pages)) : 0;
  const copies = Number.isFinite(input.copies) ? Math.max(1, Math.floor(input.copies)) : 1;
  const totalPages = pages * copies;
  const t = PRINT_PRICING[input.color] ?? PRINT_PRICING.bw;

  const tierCount = Math.min(totalPages, t.tierPages);
  const overCount = Math.max(0, totalPages - t.tierPages);
  const total = round2(tierCount * t.tierRate + overCount * t.overRate);

  return {
    color: input.color,
    pages,
    copies,
    totalPages,
    tierPages: t.tierPages,
    tierRate: t.tierRate,
    overRate: t.overRate,
    tierCount,
    overCount,
    total,
  };
}

export function money(n: number): string {
  return `$${n.toFixed(2)}`;
}

export function cents(n: number): string {
  return `${Math.round(n * 100)}¢`;
}
