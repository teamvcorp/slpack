import { NextRequest, NextResponse } from 'next/server';
import { sanitizeEmail } from '@/lib/email';

// POST /api/identity/send-link { email, url } — email the Stripe verification link.
export async function POST(req: NextRequest) {
  try {
    if (!process.env.RESEND_API_KEY) {
      return NextResponse.json({ error: 'Email not configured (RESEND_API_KEY missing)' }, { status: 503 });
    }
    const body = await req.json().catch(() => ({}));
    const to = sanitizeEmail(body.email);
    const url = typeof body.url === 'string' ? body.url : '';
    if (!to) return NextResponse.json({ error: 'A valid email is required' }, { status: 400 });
    if (!/^https:\/\/.+/.test(url)) return NextResponse.json({ error: 'Invalid link' }, { status: 400 });

    const { Resend } = await import('resend');
    const resend = new Resend(process.env.RESEND_API_KEY);
    const fromEmail = process.env.RESEND_FROM_EMAIL ?? 'shipping@stormlakepackandship.com';

    await resend.emails.send({
      from: `Storm Lake Pack & Ship <${fromEmail}>`,
      to,
      subject: 'Verify your ID to ship',
      html: `<div style="font-family:Arial,sans-serif;font-size:14px;color:#1a2744;max-width:480px;">
        <h2 style="margin:0 0 12px;">Verify your identity</h2>
        <p style="color:#555;line-height:1.6;">Tap the button below on your phone to securely verify your
        government ID with Stripe. It only takes a minute — your ID is handled by Stripe, not stored by us.</p>
        <p style="margin:20px 0;">
          <a href="${url}" style="display:inline-block;background:#1a2744;color:#fff;text-decoration:none;
          font-weight:bold;padding:12px 20px;border-radius:8px;">Verify my ID →</a>
        </p>
        <p style="color:#999;font-size:12px;word-break:break-all;">${url}</p>
      </div>`,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
