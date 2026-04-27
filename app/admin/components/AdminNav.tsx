"use client";

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';

const NAV = [
  { label: 'Dashboard', href: '/admin' },
  { label: 'Shipping Compare', href: '/admin/shipping' },
];

export default function AdminNav() {
  const pathname = usePathname();
  const router = useRouter();

  async function handleLogout() {
    await fetch('/api/admin/auth', { method: 'DELETE' });
    router.push('/admin/login');
  }

  return (
    <nav className="border-b border-white/10 bg-navy px-6 py-3">
      <div className="mx-auto flex max-w-7xl items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-base font-bold text-white">
            SL Pack &amp; Ship
          </span>
          <span className="rounded-md bg-tan/20 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-tan">
            Admin
          </span>
        </div>

        <ul className="flex items-center gap-1">
          {NAV.map((link) => (
            <li key={link.href}>
              <Link
                href={link.href}
                className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
                  pathname === link.href
                    ? 'bg-blue text-white'
                    : 'text-white/60 hover:bg-white/10 hover:text-white'
                }`}
              >
                {link.label}
              </Link>
            </li>
          ))}
          <li>
            <Link
              href="/"
              className="ml-2 rounded-md border border-white/20 px-3 py-2 text-xs font-medium text-white/50 transition-colors hover:bg-white/10 hover:text-white"
            >
              ← Main Site
            </Link>
          </li>
          <li>
            <button
              type="button"
              onClick={handleLogout}
              className="ml-1 rounded-md border border-white/20 px-3 py-2 text-xs font-medium text-white/50 transition-colors hover:bg-white/10 hover:text-white"
            >
              Log Out
            </button>
          </li>
        </ul>
      </div>
    </nav>
  );
}
