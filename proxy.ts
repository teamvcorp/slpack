import { NextRequest, NextResponse } from 'next/server';
import { sessionMode, verifySession, signSession, SESSION_TTL_SECONDS } from '@/lib/session';

/** SHA-256 hex of the passcode — the legacy admin_session cookie value. */
async function expectedToken(passcode: string): Promise<string> {
  const encoded = new TextEncoder().encode(passcode);
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Public paths reachable without a session — the login page, the auth endpoint,
 * and the public forms.
 *
 * EXACT match, deliberately (bug fix 2026-09-10). This was a chain of
 * `pathname.startsWith(...)`, and `'/api/contacts/senders'.startsWith('/api/contact')`
 * is TRUE — so the entire customer address book, including stored ID-verification
 * data, was anonymously readable. A prefix is never the right test for an
 * allowlist: list the exact paths, and add each new one on purpose.
 */
const PUBLIC_PATHS = new Set<string>([
  '/admin/login',
  '/api/admin/auth',
  '/api/contact',
  '/api/website-quote',
  '/api/print-order',
  '/api/print-order/upload',
  '/api/identity/webhook',
  '/api/webhooks/stripe',
]);

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const isApi = pathname.startsWith('/api');
  const isAdminPage = pathname.startsWith('/admin');

  if (PUBLIC_PATHS.has(pathname)) {
    return NextResponse.next();
  }

  // Partner API (server-to-server) self-authenticates in each Node route with a
  // static credential (X-Partner-Id / X-Partner-Secret), verified against Mongo
  // via scrypt — which the Edge proxy cannot do. So the proxy steps aside for
  // the whole /api/partner/ prefix and lets withPartnerAuth do the checking.
  // This never weakens the admin gate: a partner credential is a pair of headers,
  // never the admin cookie or the x-admin-internal header, and there are no admin
  // routes under /api/partner. The feature is itself inert unless
  // PARTNER_API_SECRET is set (each route 404s otherwise).
  if (pathname.startsWith('/api/partner/')) {
    return NextResponse.next();
  }

  // Only /admin pages and /api routes are protected.
  if (!isApi && !isAdminPage) {
    return NextResponse.next();
  }

  const passcode = process.env.ADMIN_PASSCODE ?? '';
  if (!passcode) {
    // Fail CLOSED where it matters (fix 2026-09-10). This used to open the whole
    // app whenever ADMIN_PASSCODE was empty — meant as a local-dev convenience,
    // but a missing/typo'd var in a deployed environment would expose every
    // route (void, charge-saved-card, all reports) to the anonymous internet.
    // The open-access convenience is now confined to local, non-preview dev.
    const deployed =
      process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'preview';
    if (deployed) {
      return new NextResponse('Server misconfigured', { status: 500 });
    }
    return NextResponse.next();
  }

  const expected = await expectedToken(passcode);

  const cookie = req.cookies.get('admin_session')?.value;
  const internalHeader = req.headers.get('x-admin-internal');

  // A valid signed session token (session mode) is the preferred credential.
  // The legacy sha256(passcode) cookie is still accepted so live sessions
  // survive the cutover to session mode. Trusted server-to-server calls (e.g.
  // shipping/submit invoking the label route) present that same static value in
  // a header — unchanged, and unaffected by session mode.
  const sessionOk = await verifySession(cookie);
  const legacyCookieOk = cookie === expected;
  const authorized = sessionOk || legacyCookieOk || internalHeader === expected;

  if (authorized) {
    const res = NextResponse.next();
    // Sliding expiration: reissue the cookie on each authorized, cookie-based
    // request so an actively-used counter session doesn't expire mid-shift.
    if (sessionOk) {
      res.cookies.set('admin_session', await signSession(SESSION_TTL_SECONDS), {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: SESSION_TTL_SECONDS,
        path: '/',
      });
    } else if (legacyCookieOk && !sessionMode()) {
      // Only slide the legacy cookie while still in legacy mode; once session
      // mode is on, let legacy cookies age out rather than renewing them.
      res.cookies.set('admin_session', expected, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: SESSION_TTL_SECONDS,
        path: '/',
      });
    }
    return res;
  }

  // Unauthenticated: APIs get a 401, pages get redirected to login.
  if (isApi) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const loginUrl = new URL('/admin/login', req.url);
  loginUrl.searchParams.set('from', pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ['/admin/:path*', '/api/:path*'],
};
