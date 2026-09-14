import { NextRequest, NextResponse } from 'next/server';
import { markFaxRead } from '@/lib/faxLog';

/**
 * PATCH /api/admin/fax/[id] — mark an inbound fax read (clears the unread badge).
 * Admin-gated by the proxy. `id` is the Sinch id.
 */
export const runtime = 'nodejs';

export async function PATCH(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  const ok = await markFaxRead(id);
  if (!ok) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
