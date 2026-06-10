import { NextRequest, NextResponse } from 'next/server';
import { searchRecipients } from '@/lib/contacts';

// GET /api/contacts/recipients?senderId=...&q=term
// With senderId: returns that sender's address book (client filters as you type).
// Without: a global recipient lookup by query.
export async function GET(req: NextRequest) {
  const senderId = req.nextUrl.searchParams.get('senderId')?.trim() || undefined;
  const q = req.nextUrl.searchParams.get('q')?.trim() || undefined;

  if (!senderId && (!q || q.length < 2)) return NextResponse.json({ results: [] });

  try {
    const results = await searchRecipients({ senderId, q });
    return NextResponse.json({ results });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message, results: [] }, { status: 500 });
  }
}
