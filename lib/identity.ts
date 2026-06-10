import type Stripe from 'stripe';
import { attachIdCheckToSender, type IdCheck } from '@/lib/contacts';

interface DateParts { day?: number | null; month?: number | null; year?: number | null }
interface VerifiedOutputsLite {
  first_name?: string | null;
  last_name?: string | null;
  address?: {
    line1?: string | null;
    city?: string | null;
    state?: string | null;
    postal_code?: string | null;
    country?: string | null;
  } | null;
  dob?: DateParts | null;
  id_number?: string | null;
}
interface DocumentLite {
  type?: string | null;
  expiration_date?: DateParts | null;
}

function over21(dob?: DateParts | null): boolean | undefined {
  if (!dob?.year) return undefined;
  const birth = new Date(Date.UTC(dob.year, (dob.month ?? 1) - 1, dob.day ?? 1));
  const now = new Date();
  let age = now.getUTCFullYear() - birth.getUTCFullYear();
  const m = now.getUTCMonth() - birth.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < birth.getUTCDate())) age -= 1;
  return age >= 21;
}

function yyyymm(d?: DateParts | null): string | undefined {
  if (!d?.year) return undefined;
  return `${d.year}-${String(d.month ?? 1).padStart(2, '0')}`;
}

/** Maps a verified VerificationSession (verified_outputs + last_verification_report expanded) → minimized idCheck. */
export function extractIdCheck(session: Stripe.Identity.VerificationSession): IdCheck {
  const vo = (session.verified_outputs ?? null) as VerifiedOutputsLite | null;
  const report = session.last_verification_report;
  const doc =
    report && typeof report !== 'string'
      ? ((report as { document?: DocumentLite }).document ?? null)
      : null;

  const verifiedName = [vo?.first_name, vo?.last_name].filter(Boolean).join(' ').trim() || undefined;
  const address = vo?.address
    ? {
        line1: vo.address.line1 ?? '',
        city: vo.address.city ?? '',
        state: vo.address.state ?? '',
        zip: vo.address.postal_code ?? '',
        country: vo.address.country ?? '',
      }
    : undefined;
  const idNumberLast4 = vo?.id_number ? vo.id_number.replace(/\D/g, '').slice(-4) || undefined : undefined;

  return {
    status: 'verified',
    method: 'stripe_identity',
    verificationSessionId: session.id,
    verifiedName,
    address,
    over21: over21(vo?.dob),
    idNumberLast4,
    documentType: doc?.type ?? undefined,
    documentExpiration: yyyymm(doc?.expiration_date),
    verifiedAt: new Date().toISOString(),
  };
}

/** Persists a verified session's minimized result onto the matching sender. */
export async function persistVerified(session: Stripe.Identity.VerificationSession): Promise<IdCheck> {
  const idCheck = extractIdCheck(session);
  const md = (session.metadata ?? {}) as Record<string, string>;
  await attachIdCheckToSender({
    name: md.senderName || idCheck.verifiedName,
    phone: md.senderPhone || undefined,
    email: md.senderEmail || undefined,
    idCheck,
  });
  return idCheck;
}
