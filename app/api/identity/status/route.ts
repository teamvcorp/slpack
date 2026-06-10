import { NextRequest, NextResponse } from 'next/server';
import { stripe } from '@/lib/stripe';
import { persistVerified } from '@/lib/identity';

// GET /api/identity/status?id=vs_... — poll a session; persists on first verified.
export async function GET(req: NextRequest) {
  try {
    if (!process.env.STRIPE_SECRET_KEY) {
      return NextResponse.json({ error: 'Stripe not configured' }, { status: 503 });
    }
    const id = req.nextUrl.searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'Missing session id' }, { status: 400 });

    const vs = await stripe.identity.verificationSessions.retrieve(id, {
      expand: ['verified_outputs', 'last_verification_report'],
    });

    if (vs.status === 'verified') {
      const idCheck = await persistVerified(vs);
      return NextResponse.json({ status: 'verified', idCheck });
    }
    return NextResponse.json({ status: vs.status });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Stripe error';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
