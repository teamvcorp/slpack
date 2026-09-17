import { NextRequest, NextResponse } from 'next/server';
import { sanitizeEmail } from '@/lib/email';
import { clientIp, hit } from '@/lib/rateLimit';
import { SITE } from '@/lib/siteConfig';
import { humanSize, validateUploadedFiles } from '@/lib/blobUpload';
import { FAX_PRICING, computeFaxPrice, money } from '@/lib/faxPricing';
import { toE164 } from '@/lib/sinchFax';

/**
 * Public fax request — a customer uploads a PDF (or emails one) and tells us the
 * number to send it to. Mirrors app/api/print-order/route.ts: the browser uploads
 * straight to Blob, then posts only the resulting URLs here, and we email the
 * shop a job to run from /admin/fax.
 *
 * Deliberately does NOT send the fax. Sending costs money and the customer pays
 * at the counter, so staff dial it from the admin Fax page once payment is taken.
 *
 * Public (allowlisted in proxy.ts).
 */
export const runtime = 'nodejs';

const FAX_REQUEST_EMAIL = process.env.FAX_REQUEST_EMAIL ?? SITE.email;

// Public endpoint — cap submissions per IP to curb spam / Resend abuse.
const MAX_PER_WINDOW = 8;
const WINDOW_MS = 10 * 60 * 1000;

const MAX_FILES = 10;
const MAX_TEXT = 2000;

function esc(value: unknown): string {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string
  );
}

function row(label: string, value: string): string {
  if (!value) return '';
  return `<p style="margin:4px 0;"><strong>${esc(label)}:</strong> ${esc(value)}</p>`;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid submission.' }, { status: 400 });
    }

    // Honeypot: real users never fill the hidden "hp_check" field. Pretend success.
    if (typeof body.hp_check === 'string' && body.hp_check.trim() !== '') {
      return NextResponse.json({ ok: true });
    }

    const count = await hit(`faxrequest:${clientIp(req)}`, WINDOW_MS);
    if (count > MAX_PER_WINDOW) {
      return NextResponse.json(
        { error: 'Too many requests. Please wait a few minutes and try again.' },
        { status: 429 }
      );
    }

    const name = String(body.name ?? '').trim();
    const email = sanitizeEmail(body.email);
    const phone = String(body.phone ?? '').trim();
    const notes = String(body.notes ?? '').trim();
    // Reuse the same normalizer the admin send path uses, so what staff see here
    // is exactly what will be dialed.
    const faxTo = toE164(String(body.faxTo ?? ''));
    const pages = Math.max(0, Math.floor(Number(body.pages) || 0));

    if (!name || !email) {
      return NextResponse.json({ error: 'Please provide your name and a valid email.' }, { status: 400 });
    }
    if (!/^\+\d{8,15}$/.test(faxTo)) {
      return NextResponse.json(
        { error: 'Enter the fax number to send to.', field: 'faxTo' },
        { status: 400 }
      );
    }
    if (notes.length > MAX_TEXT) {
      return NextResponse.json({ error: 'Message is too long.' }, { status: 400 });
    }

    // Only URLs provably from our own Blob store — never email an arbitrary link.
    const files = validateUploadedFiles(body.files, MAX_FILES);
    if (files.length === 0) {
      return NextResponse.json(
        { error: 'Please attach the PDF you want faxed.', field: 'files' },
        { status: 400 }
      );
    }

    if (!process.env.RESEND_API_KEY) {
      return NextResponse.json(
        { error: 'Email is not configured. Please call the shop.' },
        { status: 503 }
      );
    }

    // Page count is what the customer told us; staff confirm it against the PDF.
    const quote = pages > 0 ? computeFaxPrice({ pages, direction: 'outbound' }) : null;

    const fileList = files
      .map(
        (f) =>
          `<li style="margin:4px 0;"><a href="${esc(f.url)}" style="color:#34aef8;">${esc(f.name)}</a>${
            f.size ? ` <span style="color:#999;">(${humanSize(f.size)})</span>` : ''
          }</li>`
      )
      .join('');

    const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#1a2744;">
      <h2 style="margin:0 0 4px;">New fax request</h2>
      <p style="margin:0 0 12px;color:#666;">${esc(SITE.name)} — Fax service</p>
      ${row('Name', name)}
      ${row('Email', email)}
      ${row('Phone', phone)}
      <hr style="border:none;border-top:1px solid #eee;margin:12px 0;">
      <p style="margin:4px 0;font-size:16px;"><strong>Send to:</strong>
        <span style="font-family:monospace;font-size:18px;">${esc(faxTo)}</span></p>
      ${row('Pages (per customer)', pages > 0 ? String(pages) : 'not stated')}
      ${
        quote
          ? row(
              'Estimate',
              `${money(quote.total)} (${money(FAX_PRICING.outbound.firstPage)} first page + ${money(
                FAX_PRICING.outbound.additionalPage
              )} each additional; cover page free)`
            )
          : ''
      }
      ${
        notes
          ? `<p style="margin:10px 0 4px;"><strong>Message / cover note:</strong></p>
        <p style="white-space:pre-wrap;border-left:3px solid #34aef8;padding-left:12px;color:#333;margin:0;">${esc(notes)}</p>`
          : ''
      }
      <p style="margin:14px 0 4px;"><strong>Document${files.length === 1 ? '' : 's'} (${files.length}):</strong></p>
      <ul style="margin:0;padding-left:18px;">${fileList}</ul>
      <p style="margin:14px 0 0;color:#999;font-size:12px;">
        Download the PDF, then send it from Admin → Fax. Take payment at the counter first —
        this request does not send anything. Links are secure Vercel Blob URLs.
      </p>
    </div>`;

    const { Resend } = await import('resend');
    const resend = new Resend(process.env.RESEND_API_KEY);
    const fromEmail = process.env.RESEND_FROM_EMAIL ?? 'noreply@fyht4.com';

    // Resend returns { data, error } rather than throwing, so a rejected send
    // (e.g. unverified sender domain) must be checked explicitly — otherwise the
    // customer is told "received" when nothing reached the shop.
    const { error: sendError } = await resend.emails.send({
      from: `${SITE.name} Fax <${fromEmail}>`,
      to: FAX_REQUEST_EMAIL,
      replyTo: email,
      subject: `Fax request — ${name} → ${faxTo}${quote ? ` (~${money(quote.total)})` : ''}`,
      html,
    });
    if (sendError) {
      console.error('[fax-request] notification email failed', sendError);
      return NextResponse.json(
        { error: 'Your request was received but the notification email failed. Please call the shop.' },
        { status: 502 }
      );
    }

    // Customer confirmation — best effort, never blocks the request.
    try {
      await resend.emails.send({
        from: `${SITE.name} <${fromEmail}>`,
        to: email,
        subject: 'We received your fax request',
        html: `<div style="font-family:Arial,sans-serif;font-size:14px;color:#1a2744;">
          <p>Hi ${esc(name)},</p>
          <p>Thanks — we have your document and will fax it to
          <strong style="font-family:monospace;">${esc(faxTo)}</strong>.
          ${quote ? `Estimated total: <strong>${money(quote.total)}</strong> (confirmed at the counter).` : ''}</p>
          <p>We'll confirm once it has gone through. Payment is taken at the counter.</p>
          <p style="color:#666;">${esc(SITE.name)} · ${esc(SITE.telephoneDisplay)}</p>
        </div>`,
      });
    } catch (err) {
      console.error('[fax-request] customer confirmation failed', err instanceof Error ? err.message : err);
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[fax-request]', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 });
  }
}
