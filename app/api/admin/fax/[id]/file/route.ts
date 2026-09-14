import { NextRequest, NextResponse } from 'next/server';
import { getFaxBlobUrl } from '@/lib/faxLog';
import { sinchConfigured, getFaxPdf } from '@/lib/sinchFax';

/**
 * GET /api/admin/fax/[id]/file — stream a fax's PDF for inline view/download.
 *
 * Serves from the Blob archive when present, else fetches live from Sinch. The
 * Blob URL is never handed to the browser (streamed through this admin-gated
 * route), mirroring app/api/shipping/label/[id]/route.ts. `id` is the Sinch id.
 */
export const runtime = 'nodejs';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  let bytes: Buffer | null = null;

  const blobUrl = await getFaxBlobUrl(id);
  if (blobUrl) {
    try {
      const r = await fetch(blobUrl);
      if (r.ok) bytes = Buffer.from(await r.arrayBuffer());
    } catch {
      /* fall through to Sinch */
    }
  }

  if (!bytes) {
    if (!sinchConfigured()) {
      return NextResponse.json({ error: 'Fax storage unavailable' }, { status: 503 });
    }
    try {
      bytes = await getFaxPdf(id);
    } catch {
      return NextResponse.json({ error: 'Fax document not found' }, { status: 404 });
    }
  }

  return new NextResponse(new Uint8Array(bytes), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="fax-${id}.pdf"`,
      'Cache-Control': 'private, no-cache',
    },
  });
}
