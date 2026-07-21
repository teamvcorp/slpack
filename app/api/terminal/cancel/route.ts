import { NextRequest, NextResponse } from 'next/server';
import client from '@/lib/mongodb';

/**
 * Cancel an in-progress reader payment: clear the reader's current action so it
 * stops prompting, then cancel the PaymentIntent. Both are best-effort — a
 * partially-completed cancel still leaves the customer un-charged.
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

  await client.connect();
  const settings = await client
    .db(DB)
    .collection<{ _id: string; readerId?: string }>(COLLECTION)
    .findOne({ _id: ID });

  const Stripe = (await import('stripe')).default;
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2025-02-24.acacia' });

  if (settings?.readerId) {
    try {
      await stripe.terminal.readers.cancelAction(settings.readerId);
    } catch {
      /* reader may already be idle */
    }
  }
  if (paymentIntentId) {
    try {
      await stripe.paymentIntents.cancel(paymentIntentId);
    } catch {
      /* PI may already be canceled/succeeded */
    }
  }

  return NextResponse.json({ ok: true });
}
