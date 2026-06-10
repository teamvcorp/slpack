import { NextRequest, NextResponse } from 'next/server';
import { sanitizeEmail } from '@/lib/email';
import { clientIp, hit } from '@/lib/rateLimit';
import { SITE } from '@/lib/siteConfig';

// Public endpoint — cap submissions per IP to curb spam / Resend abuse.
const MAX_PER_WINDOW = 5;
const WINDOW_MS = 10 * 60 * 1000;

function esc(value: unknown): string {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string
  );
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { name, email, phone, message, company } = body;

    // Honeypot: real users never fill the hidden "company" field. Pretend success.
    if (typeof company === 'string' && company.trim() !== '') {
      return NextResponse.json({ ok: true });
    }

    const cleanName = String(name ?? '').trim();
    const cleanEmail = sanitizeEmail(email);
    const cleanMessage = String(message ?? '').trim();
    const cleanPhone = String(phone ?? '').trim();

    if (!cleanName || !cleanEmail || !cleanMessage) {
      return NextResponse.json(
        { error: 'Please provide your name, a valid email, and a message.' },
        { status: 400 }
      );
    }
    if (cleanMessage.length > 5000) {
      return NextResponse.json({ error: 'Message is too long.' }, { status: 400 });
    }

    const count = await hit(`contact:${clientIp(req)}`, WINDOW_MS);
    if (count > MAX_PER_WINDOW) {
      return NextResponse.json(
        { error: 'Too many messages. Please try again later.' },
        { status: 429 }
      );
    }

    if (!process.env.RESEND_API_KEY) {
      return NextResponse.json({ error: 'Messaging is not configured.' }, { status: 503 });
    }

    const { Resend } = await import('resend');
    const resend = new Resend(process.env.RESEND_API_KEY);
    const fromEmail = process.env.RESEND_FROM_EMAIL ?? 'shipping@stormlakepackandship.com';

    await resend.emails.send({
      from: `${SITE.name} Website <${fromEmail}>`,
      to: SITE.email,
      replyTo: cleanEmail,
      subject: `New website inquiry from ${cleanName}`,
      html: `<div style="font-family:Arial,sans-serif;font-size:14px;color:#1a2744;">
        <h2 style="margin:0 0 12px;">New contact form message</h2>
        <p><strong>Name:</strong> ${esc(cleanName)}</p>
        <p><strong>Email:</strong> ${esc(cleanEmail)}</p>
        ${cleanPhone ? `<p><strong>Phone:</strong> ${esc(cleanPhone)}</p>` : ''}
        <p><strong>Message:</strong></p>
        <p style="white-space:pre-wrap;border-left:3px solid #34aef8;padding-left:12px;color:#333;">${esc(cleanMessage)}</p>
      </div>`,
    });

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const messageText = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: messageText }, { status: 500 });
  }
}
