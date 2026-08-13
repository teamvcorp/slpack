/**
 * Shared Tailwind class strings for the box-size calculator.
 *
 * This repo has no UI primitive components — every page hand-rolls Tailwind.
 * These constants are the exact strings used elsewhere in /admin (see
 * ShipmentForm.tsx and settings/page.tsx), pulled out so the calculator's six
 * components stay consistent with each other and with the rest of the app.
 */

export const CARD = 'rounded-xl border border-navy/10 bg-white p-5 shadow-sm';
export const CARD_TITLE = 'text-base font-semibold text-navy';
export const CARD_SUB = 'mt-0.5 text-xs text-navy/50';

export const LABEL = 'mb-1 block text-xs font-semibold uppercase tracking-wide text-navy/50';
export const INPUT =
  'w-full rounded-lg border border-navy/20 bg-white px-3 py-2 text-sm text-navy placeholder-navy/30 focus:border-blue focus:outline-none focus:ring-1 focus:ring-blue';
export const HELP = 'mt-1 text-[11px] text-navy/40';

export const BTN_PRIMARY =
  'rounded-lg bg-blue px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-navy disabled:opacity-50';
export const BTN_SECONDARY =
  'rounded-lg border border-navy/20 px-4 py-2.5 text-sm font-medium text-navy/70 transition-colors hover:bg-cream disabled:opacity-50';

export const CHECKBOX = 'h-4 w-4 rounded border-navy/30 text-blue focus:ring-blue';
export const CHECKBOX_ROW = 'flex items-center gap-2 text-sm text-navy/80';

export const BANNER_WARN = 'rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900';
export const BANNER_CRITICAL = 'rounded-xl border border-red/30 bg-red/5 p-3 text-sm text-red';
export const BANNER_INFO = 'rounded-xl bg-navy/5 px-4 py-3 text-[12px] leading-relaxed text-navy/60';

export const NOTE = 'mt-6 rounded-xl bg-navy/5 px-4 py-3 text-[11px] leading-relaxed text-navy/50';
