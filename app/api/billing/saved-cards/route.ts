import { NextRequest, NextResponse } from 'next/server';
import { sanitizeEmail } from '@/lib/email';

// GET /api/billing/saved-cards?email=... — saved cards on file for a sender.
export async function GET(req: NextRequest) {
  try {
    if (!process.env.STRIPE_SECRET_KEY) return NextResponse.json({ cards: [] });

    const email = sanitizeEmail(req.nextUrl.searchParams.get('email'));
    if (!email) return NextResponse.json({ cards: [] });

    const Stripe = (await import('stripe')).default;
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2025-02-24.acacia' });

    const customers = await stripe.customers.list({ email, limit: 1 });
    const customer = customers.data[0];
    if (!customer) return NextResponse.json({ customerId: null, cards: [] });

    const pms = await stripe.paymentMethods.list({ customer: customer.id, type: 'card' });
    const cards = pms.data.map((pm) => ({
      id: pm.id,
      brand: pm.card?.brand ?? 'card',
      last4: pm.card?.last4 ?? '••••',
      expMonth: pm.card?.exp_month ?? null,
      expYear: pm.card?.exp_year ?? null,
    }));

    return NextResponse.json({ customerId: customer.id, cards });
  } catch {
    // Never block checkout on a saved-card lookup failure.
    return NextResponse.json({ cards: [] });
  }
}
