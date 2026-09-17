import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { NextRequest, NextResponse } from 'next/server';
import { clientIp, hit } from '@/lib/rateLimit';

/**
 * Shared Vercel Blob client-upload machinery.
 *
 * The browser uploads files DIRECTLY to Blob using a short-lived token minted by
 * one of these routes, which bypasses the ~4.5 MB serverless request limit. This
 * module is the single implementation behind both the print-order and fax-request
 * upload endpoints — the two differ only in which content types they accept.
 *
 * SECURITY — read before touching isBlobUrl(). These are PUBLIC endpoints that
 * mint Blob WRITE tokens, so:
 *   - every route must be rate limited (an anonymous caller could otherwise mint
 *     unlimited upload tokens against the shop's store),
 *   - the size cap must stay document-shaped; an over-generous cap is a
 *     storage/bandwidth-billing abuse vector,
 *   - and the URLs that come BACK from the browser must be proven to belong to
 *     our own store before we email anyone a link to them.
 */

/** A file the browser uploaded to Blob and is now telling us about. */
export interface UploadedFile {
  name: string;
  url: string;
  size: number;
}

/**
 * Accept only a Vercel Blob URL from OUR store — never email an arbitrary link.
 *
 * The original check was `.endsWith('.blob.vercel-storage.com')`, but that
 * namespace is shared: any Vercel tenant's public blob URL passed it, so an
 * attacker could host a malicious file on their own store and have us email the
 * link to staff. (2026-09-10)
 *
 * Now requires the `.public.` namespace and — when BLOB_PUBLIC_HOSTNAME is set to
 * this store's host (read it off any uploaded file URL, e.g.
 * `abc123.public.blob.vercel-storage.com`) — an exact host match, which is the
 * complete fix. Left unset it degrades to the namespace check rather than
 * breaking uploads.
 */
export function isBlobUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return false;
    const pinned = process.env.BLOB_PUBLIC_HOSTNAME?.trim();
    if (pinned) return u.hostname === pinned;
    return u.hostname.endsWith('.public.blob.vercel-storage.com');
  } catch {
    return false;
  }
}

/** Human-readable size for the notification email. */
export function humanSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * Validate the `files` array a browser posted back after uploading.
 *
 * Returns only entries whose URL provably belongs to our store; the caller
 * decides whether an empty result is an error.
 */
export function validateUploadedFiles(raw: unknown, maxFiles: number): UploadedFile[] {
  const list = Array.isArray(raw) ? raw.slice(0, maxFiles) : [];
  const out: UploadedFile[] = [];
  for (const f of list) {
    if (!f || typeof f !== 'object') continue;
    const entry = f as Partial<UploadedFile>;
    const url = String(entry.url ?? '');
    if (!isBlobUrl(url)) continue;
    out.push({
      name: String(entry.name ?? 'document').slice(0, 200),
      url,
      size: Number(entry.size) || 0,
    });
  }
  return out;
}

/** PDF + Word — what the print counter can actually run. */
export const DOCUMENT_CONTENT_TYPES = [
  'application/pdf',
  'application/msword', // .doc
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
];

/** Fax is PDF-only: it's what Sinch renders most predictably (sinch_fax_notes.md). */
export const FAX_CONTENT_TYPES = ['application/pdf'];

/** Document-shaped ceiling — see the security note at the top of this file. */
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

export interface UploadRouteOptions {
  /** MIME types the browser may upload. Keep this tight. */
  allowedContentTypes: string[];
  /** Distinguishes rate-limit buckets between endpoints. */
  rateLimitPrefix: string;
  maxBytes?: number;
  limit?: number;
  windowMs?: number;
}

/**
 * Build a POST handler that mints a Blob upload token.
 *
 * Used by app/api/print-order/upload and app/api/fax-request/upload, which are
 * otherwise identical — keeping one implementation means a fix to the rate limit
 * or the size cap can't land on one endpoint and be forgotten on the other.
 */
export function createBlobUploadRoute(opts: UploadRouteOptions) {
  const maxBytes = opts.maxBytes ?? MAX_UPLOAD_BYTES;
  const limit = opts.limit ?? 12;
  const windowMs = opts.windowMs ?? 10 * 60 * 1000;

  return async function POST(request: NextRequest): Promise<NextResponse> {
    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      return NextResponse.json(
        {
          error:
            'Blob storage is not configured (BLOB_READ_WRITE_TOKEN missing). Connect a Vercel Blob store and redeploy.',
        },
        { status: 503 }
      );
    }

    const count = await hit(`${opts.rateLimitPrefix}:${clientIp(request)}`, windowMs);
    if (count > limit) {
      return NextResponse.json(
        { error: 'Too many upload requests. Please wait a few minutes and try again.' },
        { status: 429 }
      );
    }

    let body: HandleUploadBody;
    try {
      body = (await request.json()) as HandleUploadBody;
    } catch {
      return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
    }

    try {
      const jsonResponse = await handleUpload({
        body,
        request,
        onBeforeGenerateToken: async () => ({
          allowedContentTypes: opts.allowedContentTypes,
          addRandomSuffix: true,
          maximumSizeInBytes: maxBytes,
        }),
        // Fires via a Vercel-to-app callback after upload (not on localhost); we
        // don't need it — the order route receives the returned blob URLs instead.
        onUploadCompleted: async () => {},
      });
      return NextResponse.json(jsonResponse);
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : 'Upload authorization failed.' },
        { status: 400 }
      );
    }
  };
}
