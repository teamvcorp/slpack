import { NextResponse } from 'next/server';

/**
 * List the Stripe Terminal readers on the account so this app can SELECT one —
 * it does not register/pair readers. The S710 is a shared, account-level device
 * (registered once in the Stripe Dashboard) used by multiple sites; pairing here
 * would duplicate it. Admin-gated by proxy.ts.
 */
export const runtime = 'nodejs';

export async function GET() {
  if (!process.env.STRIPE_SECRET_KEY) {
    return NextResponse.json({ error: 'Stripe not configured (STRIPE_SECRET_KEY missing)', readers: [] }, { status: 503 });
  }

  try {
    const Stripe = (await import('stripe')).default;
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2025-02-24.acacia' });
    const list = await stripe.terminal.readers.list({ limit: 100 });
    const readers = list.data.map((r) => ({
      id: r.id,
      label: r.label ?? '',
      status: r.status ?? 'unknown',
      deviceType: r.device_type ?? null,
      location: typeof r.location === 'string' ? r.location : (r.location?.id ?? null),
      serialNumber: r.serial_number ?? null,
    }));
    return NextResponse.json({ readers });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Could not list readers.';
    return NextResponse.json({ error: message, readers: [] }, { status: 502 });
  }
}
