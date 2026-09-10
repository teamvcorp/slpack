import { NextRequest, NextResponse } from 'next/server';
import { listAwaitingPack, markPartnerShipmentShipped } from '@/lib/partnerShipmentLog';

/**
 * Admin: the partner pickup & pack queue. Admin-gated by the proxy.
 *
 * GET  — shipments awaiting pickup & pack (all partners), plus any that need
 *        review (a self_ship label that failed after payment and must be
 *        completed by hand).
 * POST — { id, trackingNumber? } marks one as packed & shipped.
 */
export const runtime = 'nodejs';

export async function GET() {
  const shipments = await listAwaitingPack();
  return NextResponse.json({ shipments });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const id = String((body as Record<string, unknown> | null)?.id ?? '').trim();
  const trackingNumber = (body as Record<string, unknown> | null)?.trackingNumber
    ? String((body as Record<string, unknown>).trackingNumber).trim()
    : undefined;
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

  const ok = await markPartnerShipmentShipped(id, trackingNumber);
  if (!ok) return NextResponse.json({ error: 'Not found or not awaiting pack' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
