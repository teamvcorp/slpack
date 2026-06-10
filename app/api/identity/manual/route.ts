import { NextRequest, NextResponse } from 'next/server';
import { sanitizeEmail } from '@/lib/email';
import { attachIdCheckToSender, type IdCheck } from '@/lib/contacts';

// POST /api/identity/manual — record a cashier's visual ID check (no Stripe, no scan).
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const sender = body?.sender ?? {};
    const input = body?.idCheck ?? {};

    const name = String(sender.name ?? '').trim();
    if (!name) return NextResponse.json({ error: 'Sender name is required' }, { status: 400 });

    const last4 = String(input.idNumberLast4 ?? '').replace(/\D/g, '').slice(-4) || undefined;
    // Expect 'YYYY-MM'; keep only if it looks right.
    const exp = /^\d{4}-\d{2}$/.test(String(input.documentExpiration ?? ''))
      ? String(input.documentExpiration)
      : undefined;

    const idCheck: IdCheck = {
      status: 'verified',
      method: 'manual',
      verifiedBy: String(body.verifiedBy ?? 'counter').slice(0, 60),
      verifiedName: name,
      over21: input.over21 === true ? true : input.over21 === false ? false : undefined,
      idNumberLast4: last4,
      documentType: input.documentType ? String(input.documentType) : undefined,
      issuingState: input.issuingState ? String(input.issuingState).toUpperCase().slice(0, 3) : undefined,
      documentExpiration: exp,
      verifiedAt: new Date().toISOString(),
    };

    const { senderId } = await attachIdCheckToSender({
      name,
      phone: sender.phone ? String(sender.phone) : undefined,
      email: sanitizeEmail(sender.email),
      idCheck,
    });

    return NextResponse.json({ ok: true, senderId, idCheck });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
