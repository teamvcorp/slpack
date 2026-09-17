import { createBlobUploadRoute, FAX_CONTENT_TYPES } from '@/lib/blobUpload';

/**
 * Client-upload token endpoint for the public /fax page — the same mechanism the
 * print counter uses, so a customer can hand us a document without emailing it.
 *
 * PDF only: it's what Sinch renders most predictably (sinch_fax_notes.md), and
 * narrowing the accepted types on a public token-minting endpoint is free.
 *
 * Public (allowlisted in proxy.ts). Rate limiting, the size cap and token minting
 * all live in lib/blobUpload.ts, shared with /api/print-order/upload.
 */
export const runtime = 'nodejs';

export const POST = createBlobUploadRoute({
  allowedContentTypes: FAX_CONTENT_TYPES,
  rateLimitPrefix: 'faxupload',
});
