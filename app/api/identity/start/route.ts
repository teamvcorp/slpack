import { NextRequest, NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { stripe } from '@/lib/stripe';
import { sanitizeEmail } from '@/lib/email';

function baseUrl(): string {
  return (process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
}

// POST /api/identity/start — begin a document verification for a walk-in sender.
export async function POST(req: NextRequest) {
  try {
    if (!process.env.STRIPE_SECRET_KEY) {
      return NextResponse.json({ error: 'Stripe not configured' }, { status: 503 });
    }
    const body = await req.json().catch(() => ({}));
    const sender = body?.sender ?? {};
    const email = sanitizeEmail(sender.email) ?? '';

    const params: Stripe.Identity.VerificationSessionCreateParams = {
      type: 'document',
      options: { document: { require_matching_selfie: false } },
      // The only link from the (async) webhook back to our sender record.
      metadata: {
        senderEmail: email,
        senderPhone: String(sender.phone ?? ''),
        senderName: String(sender.name ?? ''),
      },
      return_url: `${baseUrl()}/verify-done`,
    };

    const vs = await stripe.identity.verificationSessions.create(params);
    return NextResponse.json({ id: vs.id, url: vs.url });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Stripe error';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
