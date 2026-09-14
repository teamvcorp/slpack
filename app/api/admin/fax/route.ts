import { NextRequest, NextResponse } from 'next/server';
import { put } from '@vercel/blob';
import { clientIp, hit } from '@/lib/rateLimit';
import { sinchConfigured, sendFax, faxFromNumber } from '@/lib/sinchFax';
import { upsertFax, listFaxes, countUnreadInbound, type FaxDirection } from '@/lib/faxLog';

/**
 * Admin Fax — list the local archive (GET) and send a fax (POST).
 *
 * Admin-gated by the proxy (this lives under /api coverage), so no per-route auth
 * check is needed — same as app/api/admin/settings/*. Fail-closed: sending returns
 * 503 until the SINCH_* env vars are set.
 */
export const runtime = 'nodejs';

// Serverless request bodies cap ~4.5 MB; keep the uploaded PDF comfortably under.
// Larger docs would need the Blob client-upload + contentUrl path (see plan).
const MAX_FAX_BYTES = 4 * 1024 * 1024;
const SEND_LIMIT = 30;
const WINDOW_MS = 10 * 60 * 1000;

/** Normalize a dialed number to E.164-ish (+digits). Best-effort; Sinch validates. */
function normalizeTo(raw: string): string {
  const trimmed = String(raw || '').trim();
  const plus = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/g, '');
  if (plus) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return digits ? `+${digits}` : '';
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const dirRaw = url.searchParams.get('direction')?.toUpperCase();
  const direction: FaxDirection | undefined =
    dirRaw === 'INBOUND' || dirRaw === 'OUTBOUND' ? dirRaw : undefined;
  const [entries, unread] = await Promise.all([listFaxes({ direction }), countUnreadInbound()]);
  return NextResponse.json({ entries, unread, configured: sinchConfigured() });
}

export async function POST(req: NextRequest) {
  if (!sinchConfigured()) {
    return NextResponse.json(
      { error: 'Fax is not configured yet (SINCH_PROJECT_ID / SINCH_KEY_ID / SINCH_KEY_SECRET).' },
      { status: 503 }
    );
  }
  if (!faxFromNumber()) {
    return NextResponse.json(
      { error: 'No fax number configured (SINCH_FAX_NUMBER).' },
      { status: 503 }
    );
  }

  const count = await hit(`faxsend:${clientIp(req)}`, WINDOW_MS);
  if (count > SEND_LIMIT) {
    return NextResponse.json({ error: 'Too many fax sends. Please wait a few minutes.' }, { status: 429 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: 'Expected a multipart form (to + file).' }, { status: 400 });
  }

  const to = normalizeTo(String(form.get('to') ?? ''));
  const headerText = String(form.get('headerText') ?? '').trim().slice(0, 50) || undefined;
  const file = form.get('file');

  if (!/^\+\d{8,15}$/.test(to)) {
    return NextResponse.json({ error: 'Enter a valid destination fax number.', field: 'to' }, { status: 422 });
  }
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: 'Attach a PDF to fax.', field: 'file' }, { status: 422 });
  }
  if (file.type && file.type !== 'application/pdf') {
    return NextResponse.json({ error: 'Only PDF files can be faxed.', field: 'file' }, { status: 422 });
  }
  if (file.size > MAX_FAX_BYTES) {
    return NextResponse.json(
      { error: `PDF is too large (max ${(MAX_FAX_BYTES / (1024 * 1024)).toFixed(0)} MB).`, field: 'file' },
      { status: 422 }
    );
  }

  const bytes = Buffer.from(await file.arrayBuffer());

  const base = process.env.NEXT_PUBLIC_BASE_URL ?? 'http://localhost:3000';
  const token = process.env.SINCH_FAX_WEBHOOK_TOKEN;
  const callbackUrl = token ? `${base}/api/webhooks/fax?token=${encodeURIComponent(token)}` : undefined;

  let fax;
  try {
    fax = await sendFax({ to, file: bytes, filename: file.name || 'fax.pdf', headerText, callbackUrl });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Fax send failed';
    return NextResponse.json({ error: `Fax could not be sent — ${message}` }, { status: 502 });
  }

  // Archive the sent PDF to Blob (best-effort; the fax already went out). The
  // file route falls back to fetching from Sinch if this didn't store.
  let blobUrl: string | undefined;
  try {
    if (process.env.BLOB_READ_WRITE_TOKEN) {
      const res = await put(`fax/out/${fax.id}.pdf`, bytes, {
        access: 'public',
        addRandomSuffix: true,
        contentType: 'application/pdf',
      });
      blobUrl = res.url;
    }
  } catch (err) {
    console.error('[fax] blob archive failed', err instanceof Error ? err.message : err);
  }

  await upsertFax({
    sinchId: fax.id,
    direction: 'OUTBOUND',
    status: fax.status ?? 'PENDING',
    from: faxFromNumber(),
    to,
    numberOfPages: fax.numberOfPages,
    headerText,
    blobUrl,
    createdAt: fax.createTime,
  });

  return NextResponse.json({
    ok: true,
    fax: { sinchId: fax.id, status: fax.status ?? 'PENDING', to, numberOfPages: fax.numberOfPages },
  });
}
