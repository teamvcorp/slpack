/**
 * Sinch Fax API client (2026-09-14).
 *
 * Thin server-only wrapper over https://fax.api.sinch.com. Basic auth with the
 * project key id/secret (officially supported; OAuth bearer is a later hardening
 * option). Fail-closed: every call throws `SinchNotConfigured` until the three
 * SINCH_* env vars are set, so the feature is inert until you turn it on.
 *
 * SECURITY: never import this into a client component — it holds the key/secret.
 * Treat every value Sinch returns (from, errorMessage, filenames) as untrusted.
 *
 * Docs: sinch_fax_notes.md. Spec: fax.yaml (International/Fax v3).
 */

export interface SinchFax {
  id: string;
  direction: 'INBOUND' | 'OUTBOUND';
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';
  from?: string;
  to?: string;
  numberOfPages?: number;
  createTime?: string;
  completedTime?: string;
  errorType?: string;
  errorMessage?: string;
  headerText?: string;
  price?: { amount?: string; currencyCode?: string };
  hasFile?: boolean;
}

export class SinchNotConfigured extends Error {
  constructor() {
    super('Sinch Fax is not configured (SINCH_PROJECT_ID / SINCH_KEY_ID / SINCH_KEY_SECRET)');
    this.name = 'SinchNotConfigured';
  }
}

export class SinchApiError extends Error {
  status: number;
  body: string;
  constructor(status: number, body: string) {
    super(`Sinch Fax API error (${status})`);
    this.name = 'SinchApiError';
    this.status = status;
    this.body = body;
  }
}

/** True once the three required credentials are present. */
export function sinchConfigured(): boolean {
  return Boolean(process.env.SINCH_PROJECT_ID && process.env.SINCH_KEY_ID && process.env.SINCH_KEY_SECRET);
}

function base(): string {
  return `https://fax.api.sinch.com/v3/projects/${process.env.SINCH_PROJECT_ID}`;
}

function authHeader(): string {
  const raw = `${process.env.SINCH_KEY_ID}:${process.env.SINCH_KEY_SECRET}`;
  return `Basic ${Buffer.from(raw).toString('base64')}`;
}

function requireConfig(): void {
  if (!sinchConfigured()) throw new SinchNotConfigured();
}

/**
 * Normalize a dialed number to E.164 (`+` then digits). Sinch stores and compares
 * its own numbers in E.164, and a bare `12085551234` as `from` is rejected with
 * 422 "the number you set as from does not belong to you" — so normalize rather
 * than trusting whoever typed the env var or the form field.
 */
export function toE164(raw: string): string {
  const trimmed = String(raw || '').trim();
  const plus = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/g, '');
  if (plus) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`; // bare US 10-digit
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return digits ? `+${digits}` : '';
}

/** The shop's fax-enabled Sinch number, used as the outbound `from` (E.164). */
export function faxFromNumber(): string | undefined {
  return toE164(process.env.SINCH_FAX_NUMBER ?? '') || undefined;
}

/**
 * Send a fax. Sinch expects **multipart/form-data** with a `file` part — verified
 * against the live API (a JSON `contentBase64` body is rejected with "must submit
 * at least one file or content URL"). Returns the created fax (status starts
 * PENDING/IN_PROGRESS; the final status arrives via the FAX_COMPLETED webhook).
 */
export async function sendFax(input: {
  to: string;
  file: Buffer;
  filename?: string;
  contentType?: string;
  headerText?: string;
  callbackUrl?: string;
}): Promise<SinchFax> {
  requireConfig();
  const form = new FormData();
  form.set('to', input.to);
  const from = faxFromNumber();
  if (from) form.set('from', from);
  if (input.headerText) form.set('headerText', input.headerText.slice(0, 50));
  if (input.callbackUrl) {
    form.set('callbackUrl', input.callbackUrl);
    form.set('callbackUrlContentType', 'application/json');
  }
  form.set(
    'file',
    // new Uint8Array(...) gives a Blob-safe ArrayBuffer-backed view (a bare Buffer
    // trips TS's BufferSource typing under strict lib settings).
    new Blob([new Uint8Array(input.file)], { type: input.contentType ?? 'application/pdf' }),
    input.filename ?? 'fax.pdf'
  );
  // No explicit Content-Type header — FormData sets the multipart boundary.
  const res = await fetch(`${base()}/faxes`, {
    method: 'POST',
    headers: { Authorization: authHeader() },
    body: form,
  });
  const text = await res.text();
  if (!res.ok) throw new SinchApiError(res.status, text.slice(0, 1000));
  return JSON.parse(text) as SinchFax;
}

/** Fetch a single fax's authoritative metadata. */
export async function getFax(id: string): Promise<SinchFax> {
  requireConfig();
  const res = await fetch(`${base()}/faxes/${encodeURIComponent(id)}`, {
    headers: { Authorization: authHeader(), Accept: 'application/json' },
  });
  const text = await res.text();
  if (!res.ok) throw new SinchApiError(res.status, text.slice(0, 1000));
  return JSON.parse(text) as SinchFax;
}

/** Download the rendered fax as a PDF. */
export async function getFaxPdf(id: string): Promise<Buffer> {
  requireConfig();
  const res = await fetch(`${base()}/faxes/${encodeURIComponent(id)}/file.pdf`, {
    headers: { Authorization: authHeader(), Accept: 'application/pdf' },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new SinchApiError(res.status, text.slice(0, 500));
  }
  return Buffer.from(await res.arrayBuffer());
}

/** List faxes from Sinch (for backfill/reconcile; the UI reads the local mirror). */
export async function listFaxes(opts: {
  direction?: 'INBOUND' | 'OUTBOUND';
  status?: string;
  page?: number;
  pageSize?: number;
} = {}): Promise<SinchFax[]> {
  requireConfig();
  const qs = new URLSearchParams();
  if (opts.direction) qs.set('direction', opts.direction);
  if (opts.status) qs.set('status', opts.status);
  qs.set('page', String(opts.page ?? 0));
  qs.set('pageSize', String(Math.min(Math.max(1, opts.pageSize ?? 50), 100)));
  const res = await fetch(`${base()}/faxes?${qs.toString()}`, {
    headers: { Authorization: authHeader(), Accept: 'application/json' },
  });
  const text = await res.text();
  if (!res.ok) throw new SinchApiError(res.status, text.slice(0, 1000));
  const data = JSON.parse(text) as { faxes?: SinchFax[] } | SinchFax[];
  return Array.isArray(data) ? data : (data.faxes ?? []);
}
