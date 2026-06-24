import { NextRequest, NextResponse } from 'next/server';
import { sanitizeEmail } from '@/lib/email';
import { clientIp, hit } from '@/lib/rateLimit';
import { SITE } from '@/lib/siteConfig';

// Runs in the Node.js runtime so we can read uploaded files into Buffers.
export const runtime = 'nodejs';

// Where website-build inquiries are routed. Overridable via env.
const WEBDEV_EMAIL = process.env.WEBDEV_EMAIL ?? 'teamvcorp@thevacorp.com';

// Public endpoint — cap submissions per IP to curb spam / Resend abuse.
const MAX_PER_WINDOW = 5;
const WINDOW_MS = 10 * 60 * 1000;

// Upload limits. Logos / mockups are small; keep generous but bounded.
const MAX_FILES = 5;
const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB per file
const MAX_TOTAL_BYTES = 20 * 1024 * 1024; // 20 MB across all files
const ALLOWED_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  'application/pdf',
]);

const MAX_TEXT = 5000;

function esc(value: unknown): string {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string
  );
}

/** Strip any path and unsafe characters from a client-supplied filename. */
function safeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? 'attachment';
  return base.replace(/[^\w.\-]+/g, '_').slice(0, 100) || 'attachment';
}

function field(form: FormData, key: string): string {
  const v = form.get(key);
  return typeof v === 'string' ? v.trim() : '';
}

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData().catch(() => null);
    if (!form) {
      return NextResponse.json({ error: 'Invalid form submission.' }, { status: 400 });
    }

    // Honeypot: real users never fill the hidden "company" field. Pretend success.
    if (field(form, 'company') !== '') {
      return NextResponse.json({ ok: true });
    }

    const name = field(form, 'name');
    const email = sanitizeEmail(field(form, 'email'));
    const phone = field(form, 'phone');
    const hasLogo = field(form, 'hasLogo'); // "yes" | "no" | ""
    const hasDomain = field(form, 'hasDomain');
    const domainName = field(form, 'domainName');
    const designParams = field(form, 'designParams');
    const siteDescription = field(form, 'siteDescription');
    const servicesDescription = field(form, 'servicesDescription');

    if (!name || !email || !siteDescription) {
      return NextResponse.json(
        { error: 'Please provide your name, a valid email, and a description of the site you want.' },
        { status: 400 }
      );
    }
    // Reject obviously oversized text fields.
    for (const v of [designParams, siteDescription, servicesDescription, domainName]) {
      if (v.length > MAX_TEXT) {
        return NextResponse.json({ error: 'One of your descriptions is too long.' }, { status: 400 });
      }
    }

    // Validate uploads (authoritative — the client also pre-checks for UX).
    const uploads = form.getAll('files').filter((f): f is File => f instanceof File && f.size > 0);
    if (uploads.length > MAX_FILES) {
      return NextResponse.json({ error: `Please attach at most ${MAX_FILES} files.` }, { status: 400 });
    }
    let total = 0;
    const attachments: { filename: string; content: Buffer }[] = [];
    for (const file of uploads) {
      if (!ALLOWED_TYPES.has(file.type)) {
        return NextResponse.json(
          { error: `Unsupported file type: ${file.type || 'unknown'}. Use images or PDF.` },
          { status: 400 }
        );
      }
      if (file.size > MAX_FILE_BYTES) {
        return NextResponse.json({ error: `"${file.name}" is larger than 10 MB.` }, { status: 400 });
      }
      total += file.size;
      if (total > MAX_TOTAL_BYTES) {
        return NextResponse.json({ error: 'Attachments total more than 20 MB.' }, { status: 400 });
      }
      attachments.push({
        filename: safeFilename(file.name),
        content: Buffer.from(await file.arrayBuffer()),
      });
    }

    const count = await hit(`webdev:${clientIp(req)}`, WINDOW_MS);
    if (count > MAX_PER_WINDOW) {
      return NextResponse.json(
        { error: 'Too many submissions. Please try again later.' },
        { status: 429 }
      );
    }

    if (!process.env.RESEND_API_KEY) {
      return NextResponse.json({ error: 'Messaging is not configured.' }, { status: 503 });
    }

    const { Resend } = await import('resend');
    const resend = new Resend(process.env.RESEND_API_KEY);
    const fromEmail = process.env.RESEND_FROM_EMAIL ?? 'shipping@stormlakepackandship.com';

    const row = (label: string, value: string) =>
      value
        ? `<p style="margin:6px 0;"><strong>${esc(label)}:</strong> ${esc(value)}</p>`
        : '';
    const block = (label: string, value: string) =>
      value
        ? `<p style="margin:10px 0 4px;"><strong>${esc(label)}:</strong></p>
           <p style="white-space:pre-wrap;border-left:3px solid #34aef8;padding-left:12px;color:#333;margin:0;">${esc(value)}</p>`
        : '';

    await resend.emails.send({
      from: `${SITE.name} Website <${fromEmail}>`,
      to: WEBDEV_EMAIL,
      replyTo: email,
      subject: `ATTEN: WEBDEV — Website build inquiry from ${name}`,
      html: `<div style="font-family:Arial,sans-serif;font-size:14px;color:#1a2744;">
        <h2 style="margin:0 0 4px;">ATTEN: WEBDEV</h2>
        <p style="margin:0 0 12px;color:#666;">New website building &amp; hosting inquiry</p>
        ${row('Name', name)}
        ${row('Email', email)}
        ${row('Phone', phone)}
        ${row('Has existing logo', hasLogo)}
        ${row('Has existing domain', hasDomain)}
        ${row('Domain', domainName)}
        ${block('Design parameters', designParams)}
        ${block('Site description', siteDescription)}
        ${block('Products / services', servicesDescription)}
        <p style="margin:12px 0 0;color:#666;">Attachments: ${attachments.length}</p>
      </div>`,
      attachments: attachments.length ? attachments : undefined,
    });

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const messageText = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: messageText }, { status: 500 });
  }
}
