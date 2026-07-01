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

    // Combined register + shipping sales add a pre-priced shipping amount (retail
    // shipping + insurance + packing) on top of the goods total. It is validated
    // here but priced on the client exactly as the standalone shipping flow does.
    const rawShipping = Number(body.shippingUSD);
    const shippingUSD =
      Number.isFinite(rawShipping) && rawShipping > 0
        ? Math.round(rawShipping * 100) / 100
        : 0;

    if (items.length === 0 && shippingUSD <= 0) {
      return NextResponse.json({ error: 'Cart is empty' }, { status: 400 });
    }

    const Stripe = (await import('stripe')).default;
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: '2025-02-24.acacia',
    });

    const priced = await priceCart(stripe, items, taxRate);
    const grandTotalUSD = Math.round((priced.totalUSD + shippingUSD) * 100) / 100;
    if (grandTotalUSD <= 0) {
      return NextResponse.json({ error: 'Sale total must be greater than zero' }, { status: 400 });
    }

    const combined = shippingUSD > 0;
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(grandTotalUSD * 100),
      currency: 'usd',
      receipt_email: customerEmail,
      description: combined
        ? `Register + shipping — ${items.length} item${items.length !== 1 ? 's' : ''} + shipping`
        : `Register sale — ${items.length} item${items.length !== 1 ? 's' : ''}`,
      metadata: {
        source: combined ? 'combined' : 'register',
        itemCount: String(items.length),
        subtotalUSD: priced.subtotalUSD.toFixed(2),
        taxUSD: priced.taxUSD.toFixed(2),
        shippingUSD: shippingUSD.toFixed(2),
        totalUSD: grandTotalUSD.toFixed(2),
      },
    });

    return NextResponse.json({
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      subtotalUSD: priced.subtotalUSD,
      taxUSD: priced.taxUSD,
      shippingUSD,
      totalUSD: grandTotalUSD,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
