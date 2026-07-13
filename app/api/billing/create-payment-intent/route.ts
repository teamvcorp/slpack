import { NextRequest, NextResponse } from 'next/server';
import { sanitizeEmail } from '@/lib/email';
import { computeCardFee, normalizeFunding } from '@/lib/cardFee';

export async function POST(req: NextRequest) {
  try {
    if (!process.env.STRIPE_SECRET_KEY) {
      return NextResponse.json(
        { error: 'Stripe not configured (STRIPE_SECRET_KEY missing)' },
        { status: 503 }
      );
    }

    const { amountUSD, paymentMethodId, carrier, serviceName, customerEmail, customerName, saveCard, shipmentDetails } =
      await req.json();

    if (!amountUSD || Number(amountUSD) <= 0) {
      return NextResponse.json({ error: 'Invalid amount' }, { status: 400 });
    }

    // Stripe rejects malformed receipt_email values with a cryptic
    // "user email is incorrect" error. Strip anything that isn't a plausible
    // address before forwarding.
    const receiptEmail = sanitizeEmail(customerEmail);

    // Lazy-load the Stripe SDK — avoids hard build errors before the package is installed
    const Stripe = (await import('stripe')).default;
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: '2025-02-24.acacia',
    });

    // Credit-only surcharge: read the card's funding type server-side, then
    // gross up so the shop nets the base amount. Debit/prepaid pay no fee.
    let funding: ReturnType<typeof normalizeFunding> = 'unknown';
    if (paymentMethodId) {
      try {
        const pm = await stripe.paymentMethods.retrieve(String(paymentMethodId));
        funding = normalizeFunding(pm.card?.funding);
      } catch {
        funding = 'unknown'; // fee-safe default (no surcharge)
      }
    }
    const { feeUSD, totalUSD } = computeCardFee(Number(amountUSD), funding);
    const amountCents = Math.round(totalUSD * 100);

    // When the sender opts in, attach the charge to a (reusable) Stripe customer
    // and mark the card for future off-session use, so it's saved on file.
    let customerId: string | undefined;
    if (saveCard) {
      const existing = receiptEmail
        ? await stripe.customers.list({ email: receiptEmail, limit: 1 })
        : { data: [] as Array<{ id: string }> };
      const customer =
        existing.data[0] ??
        (await stripe.customers.create({
          email: receiptEmail,
          name: typeof customerName === 'string' ? customerName : undefined,
        }));
      customerId = customer.id;
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountCents,
      currency: 'usd',
      receipt_email: receiptEmail,
      description: `Shipping: ${String(carrier).toUpperCase()} — ${serviceName}`,
      // Attach the card up front so funding could be read and the fee priced;
      // the client confirms this same PaymentIntent (handles any 3DS).
      ...(paymentMethodId ? { payment_method: String(paymentMethodId) } : {}),
      ...(customerId ? { customer: customerId, setup_future_usage: 'off_session' } : {}),
      metadata: {
        carrier: String(carrier),
        service: String(serviceName),
        originZip: String(shipmentDetails?.originZip ?? ''),
        destZip: String(shipmentDetails?.destZip ?? ''),
        weightLbs: String(shipmentDetails?.weightLbs ?? ''),
        cardFeeUSD: feeUSD.toFixed(2),
      },
    });

    return NextResponse.json({
      clientSecret: paymentIntent.client_secret,
      feeUSD,
      totalUSD,
      funding,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
