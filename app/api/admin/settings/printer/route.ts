import { NextRequest, NextResponse } from 'next/server';
import client from '@/lib/mongodb';

/**
 * Receipt-printer configuration (Epson TM-T20IV-SP). Persisted as a single doc
 * in slpack.settings so the shop can change the printer's LAN address without a
 * redeploy. Access is gated by the admin session (see proxy.ts) — this route
 * lives under /api and /admin coverage, so no per-route auth check is needed.
 *
 * The IP is only ever served back to the authenticated admin browser, which is
 * where the ePOS SDK opens the LAN connection (the cloud server can't reach it).
 */
export const runtime = 'nodejs';

const DB = 'slpack';
const COLLECTION = 'settings';
const ID = 'receiptPrinter';
const DEFAULT_PORT = 8043; // Epson ePOS SSL port (required from an HTTPS page)

interface PrinterSettingsDoc {
  _id: string;
  ip: string;
  port: number;
  enabled: boolean;
}

function col() {
  return client.db(DB).collection<PrinterSettingsDoc>(COLLECTION);
}

/** Accept an IPv4 address or a hostname; reject anything else (defense in depth). */
function isValidHost(host: string): boolean {
  if (/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.test(host)) {
    return host.split('.').every((o) => Number(o) >= 0 && Number(o) <= 255);
  }
  // Hostname: letters, digits, dots and hyphens, no leading/trailing dot.
  return /^(?!-)[A-Za-z0-9-]{1,63}(\.[A-Za-z0-9-]{1,63})*$/.test(host);
}

export async function GET() {
  await client.connect();
  const doc = await col().findOne({ _id: ID });
  return NextResponse.json({
    ip: doc?.ip ?? '',
    port: doc?.port ?? DEFAULT_PORT,
    enabled: doc?.enabled ?? false,
  });
}

export async function PUT(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const ip = String(body.ip ?? '').trim();
  const enabled = Boolean(body.enabled);
  const portNum = Number(body.port);
  const port =
    Number.isFinite(portNum) && portNum > 0 && portNum < 65536 ? Math.floor(portNum) : DEFAULT_PORT;

  if (ip && !isValidHost(ip)) {
    return NextResponse.json({ error: 'Enter a valid IP address or hostname.' }, { status: 400 });
  }
  if (enabled && !ip) {
    return NextResponse.json({ error: 'A printer IP is required to enable printing.' }, { status: 400 });
  }

  await client.connect();
  await col().updateOne({ _id: ID }, { $set: { ip, port, enabled } }, { upsert: true });
  return NextResponse.json({ ip, port, enabled });
}
