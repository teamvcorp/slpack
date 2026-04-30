import { NextRequest, NextResponse } from 'next/server';
import client from '@/lib/mongodb';

export interface AddressBookEntry {
  _id?: string;
  name: string;
  phone: string;
  email: string;
  street: string;
  city: string;
  state: string;
  zip: string;
  country: string;
  lastShipped: string; // ISO
  shipCount: number;
}

function db() {
  return client.db().collection<AddressBookEntry>('addressBook');
}

// GET /api/address-book?q=searchTerm
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q')?.trim() ?? '';
  if (!q) return NextResponse.json({ results: [] });

  const regex = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  const results = await db()
    .find({ $or: [{ name: regex }, { phone: regex }, { email: regex }] })
    .sort({ lastShipped: -1 })
    .limit(8)
    .toArray();

  return NextResponse.json({ results });
}

// POST /api/address-book — upsert by phone or email, fallback to name+zip
export async function POST(req: NextRequest) {
  const body: Omit<AddressBookEntry, '_id' | 'shipCount'> & { shipCount?: number } = await req.json();
  if (!body.name || !body.zip) {
    return NextResponse.json({ error: 'name and zip required' }, { status: 400 });
  }

  // Build a unique key: prefer phone, then email, then name+zip
  const filter = body.phone
    ? { phone: body.phone }
    : body.email
    ? { email: body.email }
    : { name: body.name, zip: body.zip };

  await db().updateOne(
    filter,
    {
      $set: {
        name: body.name,
        phone: body.phone ?? '',
        email: body.email ?? '',
        street: body.street ?? '',
        city: body.city ?? '',
        state: body.state ?? '',
        zip: body.zip,
        country: body.country ?? 'US',
        lastShipped: body.lastShipped,
      },
      $inc: { shipCount: 1 },
    },
    { upsert: true }
  );

  return NextResponse.json({ ok: true });
}
