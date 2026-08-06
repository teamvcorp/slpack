import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { NextResponse } from 'next/server';

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

// Generous abuse guard, not a real limit for documents (~1 GB).
const MAX_UPLOAD_BYTES = 1024 * 1024 * 1024;

export async function POST(request: Request): Promise<NextResponse> {
  const body = (await request.json()) as HandleUploadBody;
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
