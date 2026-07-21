import { NextRequest, NextResponse } from 'next/server';
import client from '@/lib/mongodb';
import { SITE } from '@/lib/siteConfig';

/**
 * Pair a Stripe Terminal reader (S700/S710) from the admin Settings page.
 *
 * The merchant generates a short registration code on the reader
 * (Settings → Generate pairing code) and submits it here. We ensure a Terminal
 * Location exists (created once from the shop address), register the reader to it,
 * and store the ids in slpack.settings. Server-driven — no connection token.
 */
export const runtime = 'nodejs';

const DB = 'slpack';
const COLLECTION = 'settings';
const ID = 'stripeTerminal';

interface TerminalSettingsDoc {
  _id: string;
  readerId: string;
  locationId: string;
  label: string;
  enabled: boolean;
}

function col() {
  return client.db(DB).collection<TerminalSettingsDoc>(COLLECTION);
}

export async function POST(req: NextRequest) {
  if (!process.env.STRIPE_SECRET_KEY) {
    return NextResponse.json({ error: 'Stripe not configured (STRIPE_SECRET_KEY missing)' }, { status: 503 });
  }

  const body = await req.json().catch(() => null);
  const registrationCode = String(body?.registrationCode ?? '').trim();
  const label = String(body?.label ?? '').trim() || 'Counter reader';
  if (!registrationCode) {
    return NextResponse.json({ error: 'Enter the pairing code shown on the reader.' }, { status: 400 });
  }

  try {
    const Stripe = (await import('stripe')).default;
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2025-02-24.acacia' });

    await client.connect();
    const existing = await col().findOne({ _id: ID });

    // Reuse the stored Location, else create one from the shop address.
    let locationId = existing?.locationId ?? '';
    if (!locationId) {
      const location = await stripe.terminal.locations.create({
        display_name: SITE.name,
        address: {
          line1: SITE.address.street,
          city: SITE.address.city,
          state: SITE.address.region,
          postal_code: SITE.address.postalCode,
          country: SITE.address.country,
        },
      });
      locationId = location.id;
    }

    const reader = await stripe.terminal.readers.create({
      registration_code: registrationCode,
      label,
      location: locationId,
    });

    await col().updateOne(
      { _id: ID },
      { $set: { readerId: reader.id, locationId, label, enabled: true } },
      { upsert: true }
    );

    return NextResponse.json({
      readerId: reader.id,
      locationId,
      label: reader.label ?? label,
      readerStatus: reader.status ?? 'unknown',
      deviceType: reader.device_type ?? null,
      enabled: true,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Could not register the reader.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
