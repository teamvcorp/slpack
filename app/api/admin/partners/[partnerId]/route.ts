import { NextRequest, NextResponse } from 'next/server';
import { getPartnerPublic, updatePartner } from '@/lib/partners';

/**
 * Admin: read / update one partner. Admin-gated by the proxy.
 *
 * Mutable fields only: displayName, businessEmail, active. The secret is never
 * touched here (rotate it via the /secret sub-route). Deactivate with
 * active:false rather than deleting, to preserve shipment history.
 */
export const runtime = 'nodejs';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ partnerId: string }> }
) {
  const { partnerId } = await params;
  const partner = await getPartnerPublic(partnerId);
  if (!partner) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ partner });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ partnerId: string }> }
) {
  const { partnerId } = await params;
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
  const b = body as Record<string, unknown>;

  const patch: { displayName?: string; businessEmail?: string; active?: boolean } = {};
  if (typeof b.displayName === 'string' && b.displayName.trim()) patch.displayName = b.displayName.trim();
  if (typeof b.businessEmail === 'string') {
    const email = b.businessEmail.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return NextResponse.json({ error: 'A valid businessEmail is required' }, { status: 400 });
    }
    patch.businessEmail = email;
  }
  if (typeof b.active === 'boolean') patch.active = b.active;

  const partner = await updatePartner(partnerId, patch);
  if (!partner) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ partner });
}
