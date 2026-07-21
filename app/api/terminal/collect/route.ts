import { NextRequest, NextResponse } from 'next/server';
import { sanitizeEmail } from '@/lib/email';
import { priceCart } from '@/lib/registerPricing';
import client from '@/lib/mongodb';
import type { RegisterLineItem } from '@/app/admin/types/register';

/**
 * Start an in-person card payment on the Stripe Terminal reader (server-driven).
 *
 * Amount is authoritative server-side: register/combined carts are re-priced via
 * priceCart (client totals never trusted); shipping-only sends a pre-priced
 * amountUSD (same trust model as /api/billing/create-payment-intent). NO card
 * surcharge is applied in person — the card type isn't known before the tap and
 * the surcharge ships off. Creates a card_present PaymentIntent and hands it to
 * the reader; the client then polls /api/terminal/status.
 */
export const runtime = 'nodejs';

const DB = 'slpack';
const COLLECTION = 'settings';
const ID = 'stripeTerminal';

export async function POST(req: NextRequest) {
  if (!process.env.STRIPE_SECRET_KEY) {
    return NextResponse.json({ error: 'Stripe not configured (STRIPE_SECRET_KEY missing)' }, { status: 503 });
  }

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });

  await client.connect();
  const settings = await client
    .db(DB)
    .collection<{ _id: string; readerId?: string; enabled?: boolean }>(COLLECTION)
    .findOne({ _id: ID });

  if (!settings?.enabled || !settings.readerId) {
    return NextResponse.json({ error: 'Card reader is not set up or is disabled.' }, { status: 409 });
  }
  const readerId = settings.readerId;
  const customerEmail = sanitizeEmail(body.customerEmail);

  const Stripe = (await import('stripe')).default;
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2025-02-24.acacia' });

  // ── Resolve the amount to charge ───────────────────────────────────────────
  let amountUSD: number;
  let subtotalUSD: number | undefined;
  let taxUSD: number | undefined;
  let description: string;

  if (Array.isArray(body.items)) {
    // Register / combined: price the cart authoritatively, add validated shipping.
    const items: RegisterLineItem[] = body.items;
    const taxRate = Number(body.taxRate) || 0;
    const rawShipping = Number(body.shippingUSD);
    const shippingUSD =
      Number.isFinite(rawShipping) && rawShipping > 0 ? Math.round(rawShipping * 100) / 100 : 0;

    if (items.length === 0 && shippingUSD <= 0) {
      return NextResponse.json({ error: 'Cart is empty' }, { status: 400 });
    }
    const priced = await priceCart(stripe, items, taxRate);
    amountUSD = Math.round((priced.totalUSD + shippingUSD) * 100) / 100;
    subtotalUSD = priced.subtotalUSD;
    taxUSD = priced.taxUSD;
    description =
      shippingUSD > 0
        ? `Register + shipping — ${items.length} item${items.length !== 1 ? 's' : ''} + shipping (reader)`
        : `Register sale — ${items.length} item${items.length !== 1 ? 's' : ''} (reader)`;
  } else {
    // Shipping-only: client-priced amount (mirrors create-payment-intent).
    const raw = Number(body.amountUSD);
    amountUSD = Number.isFinite(raw) ? Math.round(raw * 100) / 100 : 0;
    description = String(body.description ?? 'Shipping (reader)').slice(0, 200);
  }

  if (amountUSD <= 0) {
    return NextResponse.json({ error: 'Amount must be greater than zero' }, { status: 400 });
  }

  // ── Create the card_present PI and hand it to the reader ───────────────────
  let paymentIntentId = '';
  try {
    const pi = await stripe.paymentIntents.create({
      amount: Math.round(amountUSD * 100),
      currency: 'usd',
      payment_method_types: ['card_present'],
      capture_method: 'automatic',
      receipt_email: customerEmail,
      description,
      metadata: { source: 'terminal', totalUSD: amountUSD.toFixed(2) },
    });
    paymentIntentId = pi.id;

    await stripe.terminal.readers.processPaymentIntent(readerId, { payment_intent: pi.id });

    return NextResponse.json({ paymentIntentId, amountUSD, subtotalUSD, taxUSD });
  } catch (err: unknown) {
    // Reader offline/busy or bad state — cancel the orphaned PI so it doesn't linger.
    if (paymentIntentId) {
      try {
        await stripe.paymentIntents.cancel(paymentIntentId);
      } catch {
        /* best effort */
      }
    }
    const message = err instanceof Error ? err.message : 'Could not start the reader payment.';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
