import { NextRequest, NextResponse } from 'next/server';

/** SHA-256 hex of the passcode — the same value stored in the admin_session cookie. */
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
]);

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const isApi = pathname.startsWith('/api');
  const isAdminPage = pathname.startsWith('/admin');

  if (PUBLIC_PATHS.has(pathname)) {
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

  // Browser requests carry the session cookie; trusted server-to-server calls
  // (e.g. the shipping/submit route invoking the label + address-book routes)
  // present the same token in a header so they don't get locked out.
  const cookie = req.cookies.get('admin_session')?.value;
  const internalHeader = req.headers.get('x-admin-internal');
  const authorized = cookie === expected || internalHeader === expected;

  if (authorized) {
    const res = NextResponse.next();
    // Sliding expiration: refresh the session cookie on each authorized,
    // cookie-based request so an actively-used counter session doesn't expire
    // mid-shift (only true inactivity for the full window logs you out).
    if (cookie === expected) {
      res.cookies.set('admin_session', expected, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 60 * 60 * 8, // 8 hours from now
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
