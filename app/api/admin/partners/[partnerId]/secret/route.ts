import { NextRequest, NextResponse } from 'next/server';
import { rotatePartnerSecret } from '@/lib/partners';

/**
 * Admin: rotate a partner's secret. Admin-gated by the proxy.
 *
 * Returns the new plaintext secret ONCE. The old secret stops working the moment
 * this succeeds (fresh salt + hash overwrite the record). Use when a credential
 * may have leaked.
 */
export const runtime = 'nodejs';

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ partnerId: string }> }
) {
  const { partnerId } = await params;
  const result = await rotatePartnerSecret(partnerId);
  if (!result) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({
    credential: { secret: result.secret },
    note: 'Copy the secret now — it is not retrievable again. The previous secret no longer works.',
  });
}
