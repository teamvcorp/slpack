import { NextRequest, NextResponse } from 'next/server';
import { searchSenders } from '@/lib/contacts';

// GET /api/contacts/senders?q=term — typeahead search of senders
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q')?.trim() ?? '';
  if (q.length < 2) return NextResponse.json({ results: [] });
  try {
    const results = await searchSenders(q);
    return NextResponse.json({ results });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message, results: [] }, { status: 500 });
  }
}
