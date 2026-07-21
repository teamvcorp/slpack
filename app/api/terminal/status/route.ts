import { NextRequest, NextResponse } from 'next/server';
import client from '@/lib/mongodb';

/**
 * Poll the state of an in-person reader payment. The client calls this every
 * couple of seconds after /api/terminal/collect until it returns a terminal
 * state. We check the PaymentIntent first (authoritative for success/cancel) and
 * fall back to the reader's action for the in-progress/failure detail.
 */
export const runtime = 'nodejs';

const DB = 'slpack';
const COLLECTION = 'settings';
const ID = 'stripeTerminal';

export async function POST(req: NextRequest) {
  if (!process.env.STRIPE_SECRET_KEY) {
    return NextResponse.json({ error: 'Stripe not configured' }, { status: 503 });
  }

  const body = await req.json().catch(() => null);
  const paymentIntentId = String(body?.paymentIntentId ?? '').trim();
  if (!paymentIntentId) {
    return NextResponse.json({ error: 'Missing paymentIntentId' }, { status: 400 });
  }

  await client.connect();
  const settings = await client
    .db(DB)
    .collection<{ _id: string; readerId?: string }>(COLLECTION)
    .findOne({ _id: ID });

  try {
    const Stripe = (await import('stripe')).default;
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2025-02-24.acacia' });

    const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
    if (pi.status === 'succeeded') return NextResponse.json({ status: 'succeeded' });
    if (pi.status === 'canceled') return NextResponse.json({ status: 'canceled' });

    // Not yet done — the reader's action carries progress + failure detail.
    if (settings?.readerId) {
      const reader = await stripe.terminal.readers.retrieve(settings.readerId);
      const action = 'deleted' in reader ? null : reader.action;
      if (action?.status === 'failed') {
        return NextResponse.json({
          status: 'failed',
          failureMessage: action.failure_message ?? 'The card could not be processed.',
        });
      }
    }
    return NextResponse.json({ status: 'in_progress' });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Could not check payment status.';
    return NextResponse.json({ status: 'error', failureMessage: message }, { status: 502 });
  }
}
