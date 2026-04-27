import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  try {
    if (!process.env.STRIPE_SECRET_KEY) {
      return NextResponse.json(
        { error: 'Stripe not configured (STRIPE_SECRET_KEY missing)' },
        { status: 503 }
      );
    }

    const { amountUSD, carrier, serviceName, customerEmail, shipmentDetails } =
      await req.json();

    if (!amountUSD || Number(amountUSD) <= 0) {
      return NextResponse.json({ error: 'Invalid amount' }, { status: 400 });
    }

    // Lazy-load the Stripe SDK — avoids hard build errors before the package is installed
    const Stripe = (await import('stripe')).default;
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: '2025-02-24.acacia',
    });

    const amountCents = Math.round(Number(amountUSD) * 100);

    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountCents,
      currency: 'usd',
      receipt_email: customerEmail ?? undefined,
      description: `Shipping: ${String(carrier).toUpperCase()} — ${serviceName}`,
      metadata: {
        carrier: String(carrier),
        service: String(serviceName),
        originZip: String(shipmentDetails?.originZip ?? ''),
        destZip: String(shipmentDetails?.destZip ?? ''),
        weightLbs: String(shipmentDetails?.weightLbs ?? ''),
      },
    });

    return NextResponse.json({ clientSecret: paymentIntent.client_secret });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
