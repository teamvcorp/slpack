import { NextRequest, NextResponse } from 'next/server';
import { createPartner, listPartners } from '@/lib/partners';

/**
 * Admin: list & create partner API credentials.
 *
 * Gated by the admin session (proxy.ts) — this lives under /api coverage, so no
 * per-route auth check is needed (same as the settings routes). Creating a
 * partner returns the plaintext secret EXACTLY ONCE; it is scrypt-hashed at rest
 * and can never be retrieved again (only rotated).
 */
export const runtime = 'nodejs';

export async function GET() {
  const partners = await listPartners();
  return NextResponse.json({ partners });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
  const displayName = String((body as Record<string, unknown>).displayName ?? '').trim();
  const businessEmail = String((body as Record<string, unknown>).businessEmail ?? '').trim();
  if (!displayName) {
    return NextResponse.json({ error: 'displayName is required' }, { status: 400 });
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(businessEmail)) {
    return NextResponse.json({ error: 'A valid businessEmail is required' }, { status: 400 });
  }

  const { partner, secret } = await createPartner({ displayName, businessEmail });
  // Surface the credential once. The caller (admin UI) must copy it now.
  return NextResponse.json({
    partner,
    credential: { keyId: partner.keyId, secret },
    note: 'Copy the secret now — it is not retrievable again and can only be rotated.',
  });
}
