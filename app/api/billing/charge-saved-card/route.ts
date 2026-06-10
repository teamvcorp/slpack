import { NextRequest, NextResponse } from 'next/server';
import { sanitizeEmail } from '@/lib/email';

// POST /api/billing/charge-saved-card — charge a card already on file for the
// sender (off-session, confirmed immediately — no Stripe Elements needed).
export async function POST(req: NextRequest) {
  try {
    if (!process.env.STRIPE_SECRET_KEY) {
      return NextResponse.json({ ok: false, error: 'Stripe not configured' }, { status: 503 });
    }

    const { email, paymentMethodId, amountUSD, carrier, serviceName, shipmentDetails } = await req.json();
    const cleanEmail = sanitizeEmail(email);

    if (!cleanEmail) return NextResponse.json({ ok: false, error: 'Sender email required' }, { status: 400 });
    if (!paymentMethodId) return NextResponse.json({ ok: false, error: 'No saved card selected' }, { status: 400 });
    if (!amountUSD || Number(amountUSD) <= 0) {
      return NextResponse.json({ ok: false, error: 'Invalid amount' }, { status: 400 });
    }

    const Stripe = (await import('stripe')).default;
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2025-02-24.acacia' });

    const customers = await stripe.customers.list({ email: cleanEmail, limit: 1 });
    const customer = customers.data[0];
    if (!customer) {
      return NextResponse.json({ ok: false, error: 'No saved customer for this email' }, { status: 404 });
    }

    try {
      const pi = await stripe.paymentIntents.create({
        amount: Math.round(Number(amountUSD) * 100),
        currency: 'usd',
        customer: customer.id,
        payment_method: paymentMethodId,
        off_session: true,
        confirm: true,
        receipt_email: cleanEmail,
        description: `Shipping: ${String(carrier).toUpperCase()} — ${serviceName}`,
        metadata: {
          carrier: String(carrier),
          service: String(serviceName),
          originZip: String(shipmentDetails?.originZip ?? ''),
          destZip: String(shipmentDetails?.destZip ?? ''),
          weightLbs: String(shipmentDetails?.weightLbs ?? ''),
        },
      });

      if (pi.status === 'succeeded') {
        return NextResponse.json({ ok: true, paymentIntentId: pi.id });
      }
      // e.g. requires_action — saved-card auth needed; cashier should re-enter the card.
      return NextResponse.json(
        { ok: false, error: `Payment ${pi.status} — please run the card manually.`, status: pi.status },
        { status: 402 }
      );
    } catch (err: unknown) {
      // Card declined / authentication_required / etc.
      const e = err as { code?: string; raw?: { message?: string }; message?: string };
      const message = e?.raw?.message ?? e?.message ?? 'The saved card could not be charged.';
      return NextResponse.json({ ok: false, error: message, code: e?.code }, { status: 402 });
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
