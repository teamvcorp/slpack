import { NextRequest, NextResponse } from 'next/server';

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Only protect /admin routes; let /admin/login through
  if (!pathname.startsWith('/admin') || pathname.startsWith('/admin/login')) {
    return NextResponse.next();
  }

  const cookie = req.cookies.get('admin_session')?.value;
  const passcode = process.env.ADMIN_PASSCODE ?? '';

  if (!passcode) {
    // No passcode configured — allow access in dev
    return NextResponse.next();
  }

  // Derive expected token: SHA-256 of the passcode
  const encoded = new TextEncoder().encode(passcode);
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
  const expected = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  if (cookie !== expected) {
    const loginUrl = new URL('/admin/login', req.url);
    loginUrl.searchParams.set('from', pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/admin/:path*'],
};
