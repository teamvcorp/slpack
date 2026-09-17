import { createBlobUploadRoute, DOCUMENT_CONTENT_TYPES } from '@/lib/blobUpload';

/**
 * Client-upload token endpoint for the public /printing page. The browser
 * uploads documents DIRECTLY to Vercel Blob (bypassing the ~4.5 MB serverless
 * request limit, so there's effectively no size cap), using a short-lived token
 * minted here. PDF/Word only.
 *
 * Public (allowlisted in proxy.ts). Requires BLOB_READ_WRITE_TOKEN (auto-set by
 * Vercel once a Blob store is added to the project).
 *
 * The implementation — rate limiting, size cap, token minting — lives in
 * lib/blobUpload.ts and is shared with /api/fax-request/upload, so a fix to
 * either safeguard can't land on one endpoint and be forgotten on the other.
 */
export const runtime = 'nodejs';

export const POST = createBlobUploadRoute({
  allowedContentTypes: DOCUMENT_CONTENT_TYPES,
  rateLimitPrefix: 'printupload',
});
