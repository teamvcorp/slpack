import { NextRequest, NextResponse } from 'next/server';
import client from '@/lib/mongodb';

/**
 * Stripe Terminal (card reader S700/S710) configuration. Persisted as a single
 * doc in slpack.settings, mirroring the receipt-printer settings. Access is gated
 * by the admin session (see proxy.ts) — no per-route auth check needed.
 *
 * Unlike the printer IP, the reader id/location are used SERVER-side (charges are
 * driven from our API routes), so they never need to reach the browser. The GET
 * still returns them for the Settings page, but the checkout enabled-check only
 * relies on `enabled`.
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

export async function GET(req: NextRequest) {
  await client.connect();
  const doc = await col().findOne({ _id: ID });
  const base = {
    readerId: doc?.readerId ?? '',
    locationId: doc?.locationId ?? '',
    label: doc?.label ?? '',
    enabled: doc?.enabled ?? false,
  };

  // ?status=1 — the Settings page asks for the live online/offline state.
  const wantStatus = req.nextUrl.searchParams.get('status') === '1';
  if (wantStatus && base.readerId && process.env.STRIPE_SECRET_KEY) {
    try {
      const Stripe = (await import('stripe')).default;
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2025-02-24.acacia' });
      const reader = await stripe.terminal.readers.retrieve(base.readerId);
      if ('deleted' in reader) {
        return NextResponse.json({ ...base, readerStatus: 'deleted' });
      }
      const action = reader.action;
      return NextResponse.json({
        ...base,
        readerStatus: reader.status ?? 'unknown',
        deviceType: reader.device_type ?? null,
        // Diagnostics — what Stripe support asks for + what reveals a stale update.
        serialNumber: reader.serial_number ?? null,
        firmware: reader.device_sw_version ?? null,
        ipAddress: reader.ip_address ?? null,
        livemode: reader.livemode ?? null,
        lastAction: action
          ? {
              type: action.type,
              status: action.status,
              failureCode: action.failure_code ?? null,
              failureMessage: action.failure_message ?? null,
            }
          : null,
      });
    } catch (err) {
      return NextResponse.json({
        ...base,
        readerStatus: 'error',
        readerError: err instanceof Error ? err.message : 'Could not reach reader',
      });
    }
  }

  return NextResponse.json(base);
}

export async function PUT(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  await client.connect();
  const existing = await col().findOne({ _id: ID });

  // The reader is selected from the shared account (terminal.readers.list), not
  // registered here. `readerId` is optional: present when changing the selection,
  // omitted when only toggling `enabled`.
  const hasReaderField = typeof body.readerId === 'string';
  const readerId = hasReaderField ? String(body.readerId).trim() : existing?.readerId ?? '';
  const label = typeof body.label === 'string' ? String(body.label).trim() : existing?.label ?? '';
  const enabled = Boolean(body.enabled);

  if (enabled && !readerId) {
    return NextResponse.json({ error: 'Select a reader before enabling.' }, { status: 400 });
  }

  const set: Record<string, unknown> = { enabled };
  if (hasReaderField) {
    set.readerId = readerId;
    set.label = label;
  }

  await col().updateOne({ _id: ID }, { $set: set }, { upsert: true });
  return NextResponse.json({ readerId, label, enabled });
}

/**
 * Clear the stored pairing (reader id + label), disable, and keep the Location for
 * easy re-pairing. Use this to recover from a stale/mismatched reader. The physical
 * reader stays registered in Stripe; generate a fresh pairing code to re-link it.
 */
export async function DELETE() {
  await client.connect();
  await col().updateOne(
    { _id: ID },
    { $set: { readerId: '', label: '', enabled: false } },
    { upsert: true }
  );
  return NextResponse.json({ readerId: '', label: '', enabled: false });
}
