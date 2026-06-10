import { NextRequest, NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { stripe } from '@/lib/stripe';
import { persistVerified } from '@/lib/identity';
import { SITE } from '@/lib/siteConfig';

function esc(v: unknown): string {
  return String(v ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string
  );
}

/** Emails the shop when a sender cancels their ID verification. */
async function notifyCanceled(vs: Stripe.Identity.VerificationSession) {
  if (!process.env.RESEND_API_KEY) return;
  const md = (vs.metadata ?? {}) as Record<string, string>;
  const { Resend } = await import('resend');
  const resend = new Resend(process.env.RESEND_API_KEY);
  const fromEmail = process.env.RESEND_FROM_EMAIL ?? 'shipping@stormlakepackandship.com';
  await resend.emails.send({
    from: `${SITE.name} <${fromEmail}>`,
    to: SITE.email,
    subject: 'ID verification canceled',
    html: `<div style="font-family:Arial,sans-serif;font-size:14px;color:#1a2744;">
      <h2 style="margin:0 0 12px;">A sender canceled ID verification</h2>
      <p><strong>Name:</strong> ${esc(md.senderName) || '—'}</p>
      <p><strong>Email:</strong> ${esc(md.senderEmail) || '—'}</p>
      <p><strong>Phone:</strong> ${esc(md.senderPhone) || '—'}</p>
      <p style="color:#888;font-size:12px;">Session ${esc(vs.id)} · ${new Date().toLocaleString()}</p>
    </div>`,
  });
}

// POST /api/identity/webhook — Stripe Identity events (public; signature-verified).
// Source of truth for completions away from the counter. Allowlisted in proxy.ts.
export async function POST(req: NextRequest) {
  const sig = req.headers.get('stripe-signature');
  const secret = process.env.STRIPE_IDENTITY_WEBHOOK_SECRET || process.env.STRIPE_WEBHOOK_SECRET;
  if (!sig || !secret) {
    return NextResponse.json({ error: 'Missing signature or secret' }, { status: 400 });
  }

  const raw = await req.text(); // RAW body — signature needs exact bytes
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(raw, sig, secret);
  } catch {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  try {
    if (event.type === 'identity.verification_session.verified') {
      const vs = event.data.object as Stripe.Identity.VerificationSession;
      // Re-retrieve with outputs + report expanded to extract the minimized result.
      const full = await stripe.identity.verificationSessions.retrieve(vs.id, {
        expand: ['verified_outputs', 'last_verification_report'],
      });
      await persistVerified(full);
    } else if (event.type === 'identity.verification_session.canceled') {
      await notifyCanceled(event.data.object as Stripe.Identity.VerificationSession);
    }
  } catch (err) {
    console.error('Identity webhook processing error:', err);
    // Still 200 so Stripe doesn't retry forever; the status poll is the fallback.
  }

  return NextResponse.json({ received: true });
}
