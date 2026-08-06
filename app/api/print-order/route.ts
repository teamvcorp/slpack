import { NextRequest, NextResponse } from 'next/server';
import { sanitizeEmail } from '@/lib/email';
import { clientIp, hit } from '@/lib/rateLimit';
import { SITE } from '@/lib/siteConfig';
import { computePrintPrice, money, LAMINATION_PER_PAGE, type PrintColor } from '@/lib/printPricing';

// Node runtime for Resend Buffer/email sending consistency with other routes.
export const runtime = 'nodejs';

// Where print orders are routed (the shop). Overridable via env.
const PRINT_ORDER_EMAIL = process.env.PRINT_ORDER_EMAIL ?? SITE.email;

// Public endpoint — cap submissions per IP to curb spam / Resend abuse.
const MAX_PER_WINDOW = 8;
const WINDOW_MS = 10 * 60 * 1000;

const MAX_FILES = 50;
const MAX_TEXT = 5000;

function esc(value: unknown): string {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string
  );
}

/** Only accept Vercel Blob URLs we minted — never email arbitrary links. */
function isBlobUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && u.hostname.endsWith('.blob.vercel-storage.com');
  } catch {
    return false;
  }
}

function humanSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

interface IncomingFile {
  name: string;
  url: string;
  size: number;
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

    const name = String(body.name ?? '').trim();
    const email = sanitizeEmail(body.email);
    const phone = String(body.phone ?? '').trim();
    const color: PrintColor = body.color === 'color' ? 'color' : 'bw';
    const sides: 'single' | 'double' = body.sides === 'double' ? 'double' : 'single';
    const pages = Number(body.pages) || 0;
    const copies = Number(body.copies) || 1;
    const laminatePages = Math.max(0, Number(body.laminatePages) || 0);
    const collated = Boolean(body.collated);
    const stapled = Boolean(body.stapled);
    const sendToRecipient = Boolean(body.sendToRecipient);
    const recipientEmail = sendToRecipient ? sanitizeEmail(body.recipientEmail) : undefined;
    const notes = String(body.notes ?? '').trim();

    if (!name || !email) {
      return NextResponse.json({ error: 'Please provide your name and a valid email.' }, { status: 400 });
    }
    if (notes.length > MAX_TEXT) {
      return NextResponse.json({ error: 'Instructions are too long.' }, { status: 400 });
    }
    if (sendToRecipient && !recipientEmail) {
      return NextResponse.json({ error: 'Enter a valid recipient email, or uncheck "email to someone".' }, { status: 400 });
    }

    // Validate uploaded blob references (client uploaded straight to Vercel Blob).
    const rawFiles = Array.isArray(body.files) ? body.files : [];
    if (rawFiles.length === 0) {
      return NextResponse.json({ error: 'Please attach at least one PDF or Word document.' }, { status: 400 });
    }
    if (rawFiles.length > MAX_FILES) {
      return NextResponse.json({ error: `Please attach at most ${MAX_FILES} files.` }, { status: 400 });
    }
    const files: IncomingFile[] = [];
    for (const f of rawFiles) {
      const url = String(f?.url ?? '');
      if (!isBlobUrl(url)) {
        return NextResponse.json({ error: 'An uploaded file reference was invalid. Please re-upload.' }, { status: 400 });
      }
      files.push({ name: String(f?.name ?? 'document').slice(0, 200), url, size: Number(f?.size) || 0 });
    }

    const count = await hit(`print:${clientIp(req)}`, WINDOW_MS);
    if (count > MAX_PER_WINDOW) {
      return NextResponse.json({ error: 'Too many submissions. Please try again later.' }, { status: 429 });
    }

    if (!process.env.RESEND_API_KEY) {
      return NextResponse.json({ error: 'Messaging is not configured.' }, { status: 503 });
    }

    const quote = computePrintPrice({ pages, copies, color, laminatePages });

    // ── Build the order email ────────────────────────────────────────────────
    const row = (label: string, value: string) =>
      value ? `<p style="margin:6px 0;"><strong>${esc(label)}:</strong> ${esc(value)}</p>` : '';

    const finishing = [collated ? 'Collated' : '', stapled ? 'Stapled' : '']
      .filter(Boolean)
      .join(', ') || 'None';

    const estimateHtml = quote.total > 0
      ? `<p style="margin:6px 0;"><strong>Estimated price:</strong> ${money(quote.total)}</p>
         <p style="margin:2px 0;color:#666;font-size:13px;">Print: ${quote.totalPages} page${quote.totalPages === 1 ? '' : 's'} — ${money(quote.printTotal)}${
           quote.laminationTotal > 0
             ? `<br>Laminate: ${quote.laminatePages} @ $${LAMINATION_PER_PAGE} — ${money(quote.laminationTotal)}`
             : ''
         }</p>`
      : `<p style="margin:6px 0;color:#666;">Page count not provided — quote at the counter.</p>`;

    const fileList = files
      .map(
        (f) =>
          `<li style="margin:4px 0;"><a href="${esc(f.url)}" style="color:#34aef8;">${esc(f.name)}</a>${
            f.size ? ` <span style="color:#999;">(${humanSize(f.size)})</span>` : ''
          }</li>`
      )
      .join('');

    const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#1a2744;">
      <h2 style="margin:0 0 4px;">New print order</h2>
      <p style="margin:0 0 12px;color:#666;">Storm Lake Pack &amp; Ship — Printing &amp; Copy</p>
      ${row('Name', name)}
      ${row('Email', email)}
      ${row('Phone', phone)}
      <hr style="border:none;border-top:1px solid #eee;margin:12px 0;">
      ${row('Print type', color === 'color' ? 'Color' : 'Black & white')}
      ${row('Sides', sides === 'double' ? 'Double-sided' : 'Single-sided')}
      ${row('Pages (per set)', pages ? String(pages) : '—')}
      ${row('Copies', String(copies))}
      ${row('Laminate', laminatePages > 0 ? `${laminatePages} page${laminatePages === 1 ? '' : 's'}` : 'No')}
      ${row('Finishing', finishing)}
      ${sendToRecipient && recipientEmail ? row('Email finished files to', recipientEmail) : ''}
      ${estimateHtml}
      ${notes ? `<p style="margin:10px 0 4px;"><strong>Instructions:</strong></p>
        <p style="white-space:pre-wrap;border-left:3px solid #34aef8;padding-left:12px;color:#333;margin:0;">${esc(notes)}</p>` : ''}
      <p style="margin:14px 0 4px;"><strong>Documents (${files.length}):</strong></p>
      <ul style="margin:0;padding-left:18px;">${fileList}</ul>
      <p style="margin:14px 0 0;color:#999;font-size:12px;">Price is an estimate; confirm at the counter. Links are secure Vercel Blob URLs.</p>
    </div>`;

    const { Resend } = await import('resend');
    const resend = new Resend(process.env.RESEND_API_KEY);
    // Default to the verified fyht4.com domain (the old stormlakepackandship.com
    // default is unverified in Resend and gets rejected). Override via env.
    const fromEmail = process.env.RESEND_FROM_EMAIL ?? 'noreply@fyht4.com';

    // Resend's SDK returns { data, error } — it does NOT throw on API rejections
    // (e.g. an unverified sender domain). Surface that so the order never reports
    // success when the shop email didn't actually go out.
    const { error: sendError } = await resend.emails.send({
      from: `${SITE.name} Printing <${fromEmail}>`,
      to: PRINT_ORDER_EMAIL,
      replyTo: email,
      subject: `Print order — ${name} (${files.length} file${files.length === 1 ? '' : 's'}${quote.totalPages ? `, ~${money(quote.total)}` : ''})`,
      html,
    });
    if (sendError) {
      return NextResponse.json(
        { error: `Order upload succeeded but the notification email failed: ${sendError.message ?? 'unknown error'}` },
        { status: 502 }
      );
    }

    // Customer confirmation (best-effort — never blocks the order).
    try {
      await resend.emails.send({
        from: `${SITE.name} <${fromEmail}>`,
        to: email,
        subject: 'We received your print order',
        html: `<div style="font-family:Arial,sans-serif;font-size:14px;color:#1a2744;">
          <p>Hi ${esc(name)},</p>
          <p>Thanks — we received your ${files.length} document${files.length === 1 ? '' : 's'} for
          ${color === 'color' ? 'color' : 'black &amp; white'} printing${copies > 1 ? ` (${copies} copies)` : ''}.
          ${quote.totalPages > 0 ? `Estimated total: <strong>${money(quote.total)}</strong> (confirmed at the counter).` : ''}</p>
          <p>We'll get it ready${sendToRecipient && recipientEmail ? ` and email the finished files to ${esc(recipientEmail)}` : ''}.
          Questions? Just reply, or call ${esc(SITE.telephoneDisplay)}.</p>
          <p style="color:#666;">— ${esc(SITE.name)}</p>
        </div>`,
      });
    } catch {
      /* non-fatal */
    }

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
