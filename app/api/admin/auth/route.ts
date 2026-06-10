import { NextRequest, NextResponse } from 'next/server';
import { createHash, timingSafeEqual } from 'crypto';
import { clientIp, peek, hit, reset } from '@/lib/rateLimit';

// After MAX_FAILURES wrong passcodes within WINDOW_MS, the IP is locked out
// until the window rolls over — slows passcode brute-forcing to a crawl.
const MAX_FAILURES = 5;
const WINDOW_MS = 15 * 60 * 1000;

/** Constant-time string comparison (avoids leaking the passcode via timing). */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  const key = `login:${ip}`;

  // Already locked out?
  const fails = await peek(key, WINDOW_MS);
  if (fails >= MAX_FAILURES) {
    return NextResponse.json(
      { error: 'Too many attempts. Please wait a few minutes and try again.' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(WINDOW_MS / 1000)) } }
    );
  }

  const { passcode } = await req.json();
  const expected = process.env.ADMIN_PASSCODE ?? '';

  if (!expected || typeof passcode !== 'string' || !safeEqual(passcode, expected)) {
    const count = await hit(key, WINDOW_MS);
    const remaining = Math.max(0, MAX_FAILURES - count);
    return NextResponse.json(
      {
        error: remaining > 0 ? 'Invalid passcode' : 'Too many attempts. Please wait a few minutes.',
      },
      { status: 401 }
    );
  }

  // Success — clear the failure counter and issue the session cookie.
  await reset(key);
  const token = createHash('sha256').update(expected).digest('hex');

  const res = NextResponse.json({ ok: true });
  res.cookies.set('admin_session', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 8, // 8 hours
    path: '/',
  });
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.delete('admin_session');
  return res;
}
