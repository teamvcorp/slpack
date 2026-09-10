import client, { IGNORE_UNDEFINED } from '@/lib/mongodb';
import { SITE_URL } from '@/lib/siteConfig';

/**
 * Ownership record for Stripe Terminal PaymentIntents (2026-09-10).
 *
 * The S710 reader lives on a Stripe account SHARED across sites, and the
 * terminal status/cancel routes accepted ANY PaymentIntent id on that account —
 * so one site could read another site's payment status, or cancel another
 * site's in-progress sale. This records the PIs THIS site issued (tagged by
 * host) so those routes can refuse ids that aren't ours.
 *
 * A TTL index on `at` reclaims rows — terminal PIs resolve in seconds
 * (create it once; see reporting_notes.md).
 */
const DB = 'slpack';
const COLLECTION = 'terminalIntents';

/** This deployment's site tag (host without www) — matches the PI metadata.site. */
export const SITE_TAG = (() => {
  try {
    return new URL(SITE_URL).hostname.replace(/^www\./, '');
  } catch {
    return 'slpack';
  }
})();

/** Record a PaymentIntent this site just created on the shared reader. */
export async function recordTerminalIntent(paymentIntentId: string): Promise<void> {
  if (!paymentIntentId) return;
  try {
    await client.connect();
    await client
      .db(DB)
      .collection(COLLECTION)
      .insertOne({ paymentIntentId, site: SITE_TAG, at: new Date() }, IGNORE_UNDEFINED);
  } catch (err) {
    console.error('[terminal] failed to record intent', err instanceof Error ? err.message : err);
  }
}

/** True only when `paymentIntentId` was issued by THIS site. */
export async function isOurTerminalIntent(paymentIntentId: string): Promise<boolean> {
  if (!paymentIntentId) return false;
  await client.connect();
  const doc = await client
    .db(DB)
    .collection(COLLECTION)
    .findOne({ paymentIntentId, site: SITE_TAG });
  return Boolean(doc);
}
