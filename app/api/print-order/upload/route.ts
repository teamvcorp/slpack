import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { NextRequest, NextResponse } from 'next/server';
import { hit, clientIp } from '@/lib/rateLimit';

/**
 * Client-upload token endpoint for the public /printing page. The browser
 * uploads documents DIRECTLY to Vercel Blob (bypassing the ~4.5 MB serverless
 * request limit, so there's effectively no size cap), using a short-lived token
 * minted here. We only allow PDF/Word content types.
 *
 * Public (allowlisted in proxy.ts). Requires BLOB_READ_WRITE_TOKEN (auto-set by
 * Vercel once a Blob store is added to the project).
 */
export const runtime = 'nodejs';

const ALLOWED_CONTENT_TYPES = [
  'application/pdf',
  'application/msword', // .doc
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
];

// Document-shaped ceiling. This is a PUBLIC endpoint that mints Blob write
// tokens, so an over-generous cap is a storage/bandwidth-billing abuse vector —
// 50 MB comfortably covers a scanned document without handing out a 1 GB write.
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

// Public token-minting must be rate limited (fix 2026-09-10). Without this an
// anonymous caller could mint unlimited upload tokens against the shop's Blob
// store. Matches the sibling /api/print-order limiter.
const UPLOAD_LIMIT = 12;
const WINDOW_MS = 10 * 60 * 1000;

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json(
      { error: 'Blob storage is not configured (BLOB_READ_WRITE_TOKEN missing). Connect a Vercel Blob store and redeploy.' },
      { status: 503 }
    );
  }

  const count = await hit(`printupload:${clientIp(request)}`, WINDOW_MS);
  if (count > UPLOAD_LIMIT) {
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
        allowedContentTypes: ALLOWED_CONTENT_TYPES,
        addRandomSuffix: true,
        maximumSizeInBytes: MAX_UPLOAD_BYTES,
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
}
