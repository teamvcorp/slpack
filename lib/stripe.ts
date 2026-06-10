import Stripe from 'stripe';

/**
 * Lazily-initialized Stripe client (per STRIPE_IDENTITY_SETUP.md). Importing it
 * never throws at build time — the key is only read on first actual call.
 * apiVersion is pinned to what the installed SDK (stripe@17) types support.
 */
let instance: Stripe | null = null;

function getStripe(): Stripe {
  if (instance) return instance;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('Please add STRIPE_SECRET_KEY to your environment');
  instance = new Stripe(key, { apiVersion: '2025-02-24.acacia', typescript: true });
  return instance;
}

export const stripe = new Proxy({} as Stripe, {
  get(_t, prop, recv) {
    const client = getStripe();
    const value = Reflect.get(client, prop, recv);
    return typeof value === 'function' ? value.bind(client) : value;
  },
});
