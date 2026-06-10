"use client";

import { useState, useRef, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';

function LoginForm() {
  const [passcode, setPasscode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const searchParams = useSearchParams();
  // Only allow same-site relative redirects (block open-redirect via ?from=).
  const rawFrom = searchParams.get('from') ?? '/admin';
  const from = rawFrom.startsWith('/') && !rawFrom.startsWith('//') ? rawFrom : '/admin';

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const res = await fetch('/api/admin/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ passcode }),
    });

    if (res.ok) {
      // Full-page navigation (not router.push): the auth cookie was just set,
      // and the client router has a cached, pre-auth RSC entry for /admin from
      // prefetch — pushing to it serves that stale (redirect) entry and appears
      // to freeze until a manual refresh. A hard navigation re-runs the proxy
      // with the new cookie and bypasses the stale cache.
      window.location.assign(from);
    } else {
      setError('Incorrect passcode.');
      setPasscode('');
      setLoading(false);
      inputRef.current?.focus();
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-cream px-4">
      <div className="w-full max-w-sm">
        <div className="rounded-2xl border border-navy/10 bg-white p-8 shadow-sm">
          <div className="mb-6 text-center">
            <p className="text-xs font-semibold uppercase tracking-widest text-navy/40">
              Storm Lake Pack &amp; Ship
            </p>
            <h1 className="mt-1 text-xl font-bold text-navy">Admin Access</h1>
          </div>

          <form onSubmit={handleSubmit}>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-navy/50">
              Passcode
            </label>
            <input
              ref={inputRef}
              type="password"
              value={passcode}
              onChange={(e) => setPasscode(e.target.value)}
              className="w-full rounded-lg border border-navy/20 bg-white px-3 py-2.5 text-sm text-navy placeholder-navy/30 focus:border-blue focus:outline-none focus:ring-1 focus:ring-blue"
              placeholder="Enter admin passcode"
              autoComplete="current-password"
              required
            />

            {error && (
              <p className="mt-2 text-xs text-red-600">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading || !passcode}
              className="mt-4 w-full rounded-lg bg-blue px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-navy active:scale-95 disabled:opacity-50"
            >
              {loading ? 'Verifying…' : 'Enter'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

export default function AdminLoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
