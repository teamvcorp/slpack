/**
 * Credit-card processing surcharge (gross-up, credit-only).
 *
 * The shop passes Stripe's processing cost to the customer, but ONLY on credit
 * cards — surcharging debit/prepaid is prohibited by card-network rules. The
 * fee is "grossed up" so that after Stripe deducts its cut the shop nets the
 * original base amount:  total = (base + FIXED) / (1 - PCT).
 *
 * Gated behind CARD_SURCHARGE_ENABLED so it can be shipped dark until the
 * surcharge is registered with the card networks (Visa/Mastercard). Funding
 * type MUST be read server-side from the Stripe PaymentMethod — never trust the
 * client for the fee.
 */

export type CardFunding = 'credit' | 'debit' | 'prepaid' | 'unknown';

const ENABLED = process.env.CARD_SURCHARGE_ENABLED === 'true';
const PCT = Number(process.env.STRIPE_FEE_PCT ?? '0.029');
const FIXED = Number(process.env.STRIPE_FEE_FIXED ?? '0.30');
// Card-network cap: the surcharge may not exceed the merchant's cost or ~3%
// (Visa), whichever is lower. Capping keeps us compliant; on small orders the
// fixed component would otherwise push the gross-up over the cap.
const CAP_PCT = Number(process.env.STRIPE_FEE_CAP_PCT ?? '0.03');

const round2 = (n: number) => Math.round(n * 100) / 100;

export interface CardFeeResult {
  /** Surcharge added to the base (0 when disabled, non-credit, or base <= 0). */
  feeUSD: number;
  /** Amount to actually charge the card (base + feeUSD). */
  totalUSD: number;
}

/** Compute the credit-only grossed-up surcharge for a base amount. */
export function computeCardFee(baseUSD: number, funding: CardFunding): CardFeeResult {
  const base = round2(Number(baseUSD) || 0);
  if (!ENABLED || funding !== 'credit' || base <= 0) {
    return { feeUSD: 0, totalUSD: base };
  }
  // Gross-up to fully recover Stripe's cut, then cap at CAP_PCT of the base so
  // the surcharge never exceeds the card-network limit.
  const grossedFee = (base + FIXED) / (1 - PCT) - base;
  const feeUSD = round2(Math.min(grossedFee, base * CAP_PCT));
  return { feeUSD, totalUSD: round2(base + feeUSD) };
}

/** True when surcharging is turned on (for optional UI hints). */
export function surchargeEnabled(): boolean {
  return ENABLED;
}

/** Narrow an arbitrary Stripe funding string to our union. */
export function normalizeFunding(funding: unknown): CardFunding {
  return funding === 'credit' || funding === 'debit' || funding === 'prepaid'
    ? funding
    : 'unknown';
}
