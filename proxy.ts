import { NextRequest, NextResponse } from 'next/server';

/** SHA-256 hex of the passcode — the same value stored in the admin_session cookie. */
async function expectedToken(passcode: string): Promise<string> {
  const encoded = new TextEncoder().encode(passcode);
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const isApi = pathname.startsWith('/api');
  const isAdminPage = pathname.startsWith('/admin');

  // Public endpoints: the login page, the auth endpoint, and the public
  // contact form must stay reachable without a session.
  if (
    pathname.startsWith('/admin/login') ||
    pathname.startsWith('/api/admin/auth') ||
    pathname.startsWith('/api/contact') ||
    pathname.startsWith('/api/identity/webhook')
  ) {
    return NextResponse.next();
  }

  // Only /admin pages and /api routes are protected.
  if (!isApi && !isAdminPage) {
    return NextResponse.next();
  }

  const passcode = process.env.ADMIN_PASSCODE ?? '';
  if (!passcode) {
    // No passcode configured — allow access (local dev).
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
    return NextResponse.next();
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
