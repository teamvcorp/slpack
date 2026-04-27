"use client";

import { useState, useRef, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

export default function AdminLoginPage() {
  const [passcode, setPasscode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const searchParams = useSearchParams();
  const from = searchParams.get('from') ?? '/admin';

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
      router.push(from);
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
