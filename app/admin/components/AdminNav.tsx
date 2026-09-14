"use client";

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

type NavLink = { label: string; href: string };
type NavGroup = { label: string; children: NavLink[] };
type NavItem = NavLink | NavGroup;

const isGroup = (i: NavItem): i is NavGroup => 'children' in i;

// Grouped to keep the header uncluttered: daily items stay top-level; the rest
// tuck into two dropdowns. Adjust freely — the render handles links and groups.
const NAV: NavItem[] = [
  { label: 'Dashboard', href: '/admin' },
  { label: 'Register', href: '/admin/register' },
  {
    label: 'Shipping',
    children: [
      { label: 'Shipping Compare', href: '/admin/shipping' },
      { label: 'International', href: '/admin/shipping-intl' },
      { label: 'Box Size', href: '/admin/box-size' },
      { label: 'Pickup', href: '/admin/pickup' },
      { label: 'Drop-off', href: '/admin/dropoff' },
    ],
  },
  { label: 'Reports', href: '/admin/log' },
  { label: 'Fax', href: '/admin/fax' },
  {
    label: 'Admin',
    children: [
      { label: 'Partners', href: '/admin/partners' },
      { label: 'Settings', href: '/admin/settings' },
    ],
  },
];

const linkBase = 'rounded-md px-4 py-2 text-sm font-medium transition-colors';
const active = 'bg-blue text-white';
const idle = 'text-white/60 hover:bg-white/10 hover:text-white';

export default function AdminNav() {
  const pathname = usePathname();
  const router = useRouter();
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const navRef = useRef<HTMLDivElement>(null);

  // Close an open dropdown on outside click or on navigation.
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (navRef.current && !navRef.current.contains(e.target as Node)) setOpenMenu(null);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);
  useEffect(() => { setOpenMenu(null); }, [pathname]);

  async function handleLogout() {
    await fetch('/api/admin/auth', { method: 'DELETE' });
    router.push('/admin/login');
  }

  return (
    <nav className="border-b border-white/10 bg-navy px-6 py-3">
      <div ref={navRef} className="mx-auto flex max-w-7xl items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-base font-bold text-white">SL Pack &amp; Ship</span>
          <span className="rounded-md bg-tan/20 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-tan">
            Admin
          </span>
        </div>

        <ul className="flex items-center gap-1">
          {NAV.map((item) => {
            if (!isGroup(item)) {
              return (
                <li key={item.href}>
                  <Link href={item.href} className={`${linkBase} ${pathname === item.href ? active : idle}`}>
                    {item.label}
                  </Link>
                </li>
              );
            }
            const groupActive = item.children.some((c) => pathname === c.href);
            const open = openMenu === item.label;
            return (
              <li key={item.label} className="relative">
                <button
                  type="button"
                  onClick={() => setOpenMenu(open ? null : item.label)}
                  className={`${linkBase} inline-flex items-center gap-1 ${groupActive || open ? active : idle}`}
                  aria-expanded={open}
                  aria-haspopup="menu"
                >
                  {item.label}
                  <span className={`text-[10px] transition-transform ${open ? 'rotate-180' : ''}`}>▾</span>
                </button>
                {open && (
                  <div
                    role="menu"
                    className="absolute right-0 z-30 mt-1 min-w-[190px] overflow-hidden rounded-lg border border-white/10 bg-navy py-1 shadow-xl ring-1 ring-black/20"
                  >
                    {item.children.map((c) => (
                      <Link
                        key={c.href}
                        href={c.href}
                        role="menuitem"
                        className={`block px-4 py-2 text-sm transition-colors ${
                          pathname === c.href ? 'bg-blue text-white' : 'text-white/70 hover:bg-white/10 hover:text-white'
                        }`}
                      >
                        {c.label}
                      </Link>
                    ))}
                  </div>
                )}
              </li>
            );
          })}

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
