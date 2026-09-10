import { NextRequest, NextResponse } from 'next/server';
import { createHash, timingSafeEqual } from 'crypto';
import { clientIp, peek, hit, reset } from '@/lib/rateLimit';
import { sessionMode, signSession, SESSION_TTL_SECONDS } from '@/lib/session';
import { logAuthAttempt } from '@/lib/authLog';

// This route reads Mongo (auth log) and uses Node crypto — force the Node
// runtime so it never gets bundled for the Edge.
export const runtime = 'nodejs';

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
  const ua = req.headers.get('user-agent') ?? undefined;
  const key = `login:${ip}`;

  // Already locked out?
  const fails = await peek(key, WINDOW_MS);
  if (fails >= MAX_FAILURES) {
    await logAuthAttempt({ ok: false, ip, ua, reason: 'locked_out' });
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
    await logAuthAttempt({ ok: false, ip, ua, reason: expected ? 'bad_passcode' : 'no_passcode_configured' });
    return NextResponse.json(
      {
        error: remaining > 0 ? 'Invalid passcode' : 'Too many attempts. Please wait a few minutes.',
      },
      { status: 401 }
    );
  }

  // Success — clear the failure counter, record the login, issue the cookie.
  await reset(key);
  await logAuthAttempt({ ok: true, ip, ua });

  // Session mode (SESSION_SECRET set): a signed, self-expiring token that does
  // not reveal the passcode. Legacy mode (unset): the historical
  // sha256(passcode) cookie, so nothing changes until the secret is configured.
  const token = sessionMode()
    ? await signSession(SESSION_TTL_SECONDS)
    : createHash('sha256').update(expected).digest('hex');

  const res = NextResponse.json({ ok: true });
  res.cookies.set('admin_session', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: SESSION_TTL_SECONDS,
    path: '/',
  });
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.delete('admin_session');
  return res;
}
