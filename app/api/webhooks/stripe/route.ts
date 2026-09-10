import { NextRequest, NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { stripe } from '@/lib/stripe';
import client, { IGNORE_UNDEFINED } from '@/lib/mongodb';

/**
 * Stripe payment webhook (H6, 2026-09-10) — a server-side source of truth that a
 * payment actually completed.
 *
 * This is NOT in the payment path. Nothing about the counter checkout or the
 * Terminal reader flow changes: this endpoint is called BY Stripe, after the
 * fact, to record payment_intent events for reconciliation. It is the
 * foundation the (future, flag-gated) payment↔label binding will read from.
 *
 * PUBLIC but signature-verified (allowlisted in proxy.ts): the raw body is
 * checked against STRIPE_WEBHOOK_SECRET, so an unauthenticated POST without a
 * valid Stripe signature gets a 400 and nothing else. Fails CLOSED when the
 * secret is unset — inert until you configure it in Vercel.
 *
 * Set up: in the Stripe Dashboard add an endpoint at
 * https://<your-domain>/api/webhooks/stripe for payment_intent.succeeded (and
 * .payment_failed / .canceled), then put its signing secret in
 * STRIPE_WEBHOOK_SECRET. Keep it distinct from STRIPE_IDENTITY_WEBHOOK_SECRET,
 * which signs the separate identity endpoint.
 */
export const runtime = 'nodejs';

const DB = 'slpack';
const COLLECTION = 'paymentEvents';

const HANDLED = new Set([
  'payment_intent.succeeded',
  'payment_intent.payment_failed',
  'payment_intent.canceled',
]);

export async function POST(req: NextRequest) {
  const sig = req.headers.get('stripe-signature');
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!sig || !secret) {
    return NextResponse.json({ error: 'Missing signature or secret' }, { status: 400 });
  }

  const raw = await req.text(); // RAW body — the signature needs the exact bytes
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(raw, sig, secret);
  } catch {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  try {
    if (HANDLED.has(event.type)) {
      const pi = event.data.object as Stripe.PaymentIntent;
      const md = (pi.metadata ?? {}) as Record<string, string>;
      await client.connect();
      // Keyed on eventId (unique index) so Stripe's retries are idempotent — a
      // duplicate upsert is a no-op rather than a second row.
      await client
        .db(DB)
        .collection(COLLECTION)
        .updateOne(
          { eventId: event.id },
          {
            $setOnInsert: {
              eventId: event.id,
              type: event.type,
              paymentIntentId: pi.id,
              amount: pi.amount,
              amountReceived: pi.amount_received,
              currency: pi.currency,
              status: pi.status,
              site: md.site,
              source: md.source,
              receivedAt: new Date(),
            },
          },
          { upsert: true, ...IGNORE_UNDEFINED }
        );
    }
  } catch (err) {
    // Record-keeping only — never fail the webhook over it. Returning non-200
    // would make Stripe retry; a dropped record is recoverable from the
    // Dashboard, a retry storm is not worth it.
    console.error('Stripe payment webhook processing error:', err);
  }

  return NextResponse.json({ received: true });
}
