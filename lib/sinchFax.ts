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

/** The shop's fax-enabled Sinch number, used as the outbound `from`. */
export function faxFromNumber(): string | undefined {
  return process.env.SINCH_FAX_NUMBER || undefined;
}

/**
 * Send a fax. `contentBase64` is the raw base64 of a single PDF. Returns the
 * created fax (status starts PENDING/IN_PROGRESS; final status arrives via the
 * FAX_COMPLETED webhook).
 */
export async function sendFax(input: {
  to: string;
  contentBase64: string;
  headerText?: string;
  callbackUrl?: string;
}): Promise<SinchFax> {
  requireConfig();
  const body: Record<string, unknown> = {
    to: input.to,
    contentBase64: input.contentBase64,
    ...(faxFromNumber() ? { from: faxFromNumber() } : {}),
    ...(input.headerText ? { headerText: input.headerText.slice(0, 50) } : {}),
    ...(input.callbackUrl ? { callbackUrl: input.callbackUrl, callbackUrlContentType: 'application/json' } : {}),
  };
  const res = await fetch(`${base()}/faxes`, {
    method: 'POST',
    headers: { Authorization: authHeader(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
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
