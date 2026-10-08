import { SITE_URL } from '@/lib/siteConfig';

/**
 * Who this deployment is, for revenue attribution on the shared Stripe account.
 *
 * WHY THIS EXISTS: every shop runs its own deployment of this app, each with its
 * own database, but all of them charge into ONE Stripe platform account. A
 * charge that doesn't say which shop earned it cannot be attributed, and so
 * cannot be paid out — the money is simply unaccounted for in the platform
 * balance. `SHOP_ID` is the key the transfer app groups by.
 *
 * Contract and consumer: SHOP_CHARGE_TAGGING.md (what every shop must stamp) and
 * TRANSFER_APP_INTEGRATION.md (how those tags are read back).
 *
 * ⚠️ SHOP_ID MUST BE STABLE FOREVER. It is the join key for all historical
 * revenue. Changing it silently orphans every prior charge — the old ones keep
 * the old id and quietly fall out of that shop's totals, which surfaces as an
 * unexplained shortfall rather than an error. Set it once, never edit it.
 *
 * This is metadata only. Nothing here affects what anyone is charged.
 */

/**
 * Hostname fallback, kept for continuity with terminal PaymentIntents written
 * before SHOP_ID existed (they carry `metadata.site` = this value).
 *
 * Deriving identity from a hostname is exactly the fragility SHOP_ID fixes —
 * moving to a new domain would re-key the shop — so this is a bridge, not the
 * intended configuration. Set SHOP_ID in every environment.
 */
export const SITE_TAG = (() => {
  try {
    return new URL(SITE_URL).hostname.replace(/^www\./, '');
  } catch {
    return 'slpack';
  }
})();

/** Stable identifier for this shop. Assigned by the platform, never derived. */
export const SHOP_ID = process.env.SHOP_ID?.trim() || SITE_TAG;

/**
 * This shop's Stripe connected account (`acct_…`), when known.
 *
 * Recorded on the charge purely so the transfer app knows the intended payee
 * without a lookup table. Charges are created on the PLATFORM account — this is
 * NOT a Connect destination and moves no money on its own.
 */
export const CONNECTED_ACCOUNT_ID = process.env.STRIPE_CONNECTED_ACCOUNT_ID?.trim() || '';

/** Where a charge originated, for per-channel breakdowns in the transfer app. */
export type ChargeSource = 'register' | 'combined' | 'terminal' | 'shipping' | 'partner';

/**
 * The attribution block stamped on every PaymentIntent this app creates.
 *
 * Stripe metadata values must be strings, so every field is pre-formatted here.
 * Empty values are omitted rather than sent as '' — an absent key reads as
 * "not configured", while an empty string looks like a real but blank answer.
 *
 * @param surchargeUSD what the customer paid toward card processing, so the
 *   transfer app can compare it against Stripe's actual fee. Pass 0 where no
 *   surcharge applies (in-person reader sales never carry one: card funding
 *   isn't known before the tap).
 */
export function attributionMetadata(
  source: ChargeSource,
  surchargeUSD = 0
): Record<string, string> {
  return {
    shop_id: SHOP_ID,
    source,
    surcharge_usd: (Number.isFinite(surchargeUSD) ? surchargeUSD : 0).toFixed(2),
    ...(CONNECTED_ACCOUNT_ID ? { connected_account: CONNECTED_ACCOUNT_ID } : {}),
  };
}
