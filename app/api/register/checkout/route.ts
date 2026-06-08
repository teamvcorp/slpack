import { NextRequest, NextResponse } from 'next/server';
import { sanitizeEmail } from '@/lib/email';
import { priceCart } from '@/lib/registerPricing';
import type { RegisterLineItem } from '@/app/admin/types/register';

/**
 * Creates a PaymentIntent for a register sale. The cart is priced
 * authoritatively server-side (see priceCart) so the charged amount can't be
 * tampered with or fall out of date. Returns the money breakdown so the client
 * and printed receipt match the charge exactly.
 */
export async function POST(req: NextRequest) {
  try {
    if (!process.env.STRIPE_SECRET_KEY) {
      return NextResponse.json(
        { error: 'Stripe not configured (STRIPE_SECRET_KEY missing)' },
        { status: 503 }
      );
    }

    const body = await req.json();
    const items: RegisterLineItem[] = Array.isArray(body.items) ? body.items : [];
    const taxRate = Number(body.taxRate) || 0;
    const customerEmail = sanitizeEmail(body.customerEmail);

    if (items.length === 0) {
      return NextResponse.json({ error: 'Cart is empty' }, { status: 400 });
    }

    const Stripe = (await import('stripe')).default;
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: '2025-02-24.acacia',
    });

    const priced = await priceCart(stripe, items, taxRate);
    if (priced.totalUSD <= 0) {
      return NextResponse.json({ error: 'Sale total must be greater than zero' }, { status: 400 });
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(priced.totalUSD * 100),
      currency: 'usd',
      receipt_email: customerEmail,
      description: `Register sale — ${items.length} item${items.length !== 1 ? 's' : ''}`,
      metadata: {
        source: 'register',
        itemCount: String(items.length),
        subtotalUSD: priced.subtotalUSD.toFixed(2),
        taxUSD: priced.taxUSD.toFixed(2),
        totalUSD: priced.totalUSD.toFixed(2),
      },
    });

    return NextResponse.json({
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      subtotalUSD: priced.subtotalUSD,
      taxUSD: priced.taxUSD,
      totalUSD: priced.totalUSD,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
