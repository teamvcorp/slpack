"use client";

import { useState, useEffect, useRef } from 'react';
import QRCode from 'qrcode';
import type { IdCheck } from '@/lib/contacts';

interface Props {
  sender: { name: string; phone: string; email: string };
  onClose: () => void;
  onVerified: (idCheck: IdCheck) => void;
}

type Mode = 'phone' | 'manual';
type PhoneStatus = 'starting' | 'waiting' | 'verified' | 'error';

const DOC_TYPES = [
  { value: 'driving_license', label: "Driver's license" },
  { value: 'state_id', label: 'State ID' },
  { value: 'passport', label: 'Passport' },
  { value: 'military', label: 'Military ID' },
];

export default function IdentityVerifyModal({ sender, onClose, onVerified }: Props) {
  const [mode, setMode] = useState<Mode>('phone');

  // Phone (Stripe) path
  const [status, setStatus] = useState<PhoneStatus>('starting');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [emailMsg, setEmailMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const onVerifiedRef = useRef(onVerified);
  useEffect(() => { onVerifiedRef.current = onVerified; });

  // Manual path
  const [m, setM] = useState({
    documentType: 'driving_license',
    issuingState: '',
    idNumberLast4: '',
    documentExpiration: '',
    over21: false,
  });
  const [submitting, setSubmitting] = useState(false);

  // Start a Stripe session when entering phone mode.
  useEffect(() => {
    if (mode !== 'phone' || sessionId) return;
    let cancelled = false;
    (async () => {
      setStatus('starting');
      setError(null);
      try {
        const res = await fetch('/api/identity/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sender }),
        });
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok || !data.url) throw new Error(data.error ?? `Server error ${res.status}`);
        setSessionId(data.id);
        setUrl(data.url);
        setStatus('waiting');
        const dataUrl = await QRCode.toDataURL(data.url, { width: 220, margin: 1 });
        if (!cancelled) setQr(dataUrl);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Could not start verification');
          setStatus('error');
        }
      }
    })();
    return () => { cancelled = true; };
  }, [mode, sessionId, sender]);

  // Poll for completion while waiting.
  useEffect(() => {
    if (status !== 'waiting' || !sessionId) return;
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/identity/status?id=${encodeURIComponent(sessionId)}`);
        const data = await res.json();
        if (data.status === 'verified' && data.idCheck) {
          if (pollRef.current) clearInterval(pollRef.current);
          setStatus('verified');
          onVerifiedRef.current(data.idCheck);
        }
      } catch {
        // keep polling
      }
    }, 3500);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [status, sessionId]);

  async function emailLink() {
    if (!url) return;
    setEmailMsg(null);
    try {
      const res = await fetch('/api/identity/send-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: sender.email, url }),
      });
      const data = await res.json().catch(() => ({}));
      setEmailMsg(res.ok && data.ok ? `Link sent to ${sender.email}` : data.error ?? 'Could not send link');
    } catch {
      setEmailMsg('Could not send link');
    }
  }

  async function copyLink() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  }

  async function submitManual() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/identity/manual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sender, idCheck: m, verifiedBy: 'counter' }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error ?? `Server error ${res.status}`);
      onVerified(data.idCheck);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save');
      setSubmitting(false);
    }
  }

  const inputCls =
    'w-full rounded-lg border border-navy/20 bg-white px-3 py-2 text-sm text-navy focus:border-blue focus:outline-none focus:ring-1 focus:ring-blue';
  const lblCls = 'mb-1 block text-[11px] font-semibold uppercase tracking-wide text-navy/50';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy/60 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between bg-navy px-6 py-4">
          <div>
            <h3 className="text-lg font-bold text-white">Verify sender ID</h3>
            <p className="text-xs text-white/50">{sender.name || 'New sender'}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-white/60 transition-colors hover:bg-white/20 hover:text-white"
          >
            ✕
          </button>
        </div>

        {/* Mode switch */}
        <div className="flex gap-1 border-b border-navy/10 bg-cream px-6 py-3">
          <button
            type="button"
            onClick={() => setMode('phone')}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              mode === 'phone' ? 'bg-white text-navy shadow-sm' : 'text-navy/50 hover:text-navy'
            }`}
          >
            📱 Verify by phone
          </button>
          <button
            type="button"
            onClick={() => setMode('manual')}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              mode === 'manual' ? 'bg-white text-navy shadow-sm' : 'text-navy/50 hover:text-navy'
            }`}
          >
            ✍️ Manual ID check
          </button>
        </div>

        <div className="px-6 py-5">
          {/* ── Phone (Stripe) ── */}
          {mode === 'phone' && (
            <div className="text-center">
              {status === 'starting' && <p className="py-10 text-sm text-navy/50">Preparing secure verification…</p>}

              {status === 'error' && (
                <div className="py-6">
                  <p className="rounded-lg bg-red/10 px-3 py-2 text-sm text-red">{error}</p>
                  <p className="mt-3 text-xs text-navy/50">Use “Manual ID check” instead.</p>
                </div>
              )}

              {status === 'waiting' && (
                <>
                  <p className="text-sm text-navy/60">
                    Have {sender.name || 'the customer'} scan this with their phone camera to verify
                    their ID securely with Stripe.
                  </p>
                  <div className="mt-4 flex justify-center">
                    {qr ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={qr} alt="Verification QR code" className="h-52 w-52 rounded-lg border border-navy/10" />
                    ) : (
                      <div className="flex h-52 w-52 items-center justify-center text-sm text-navy/40">Loading QR…</div>
                    )}
                  </div>
                  <div className="mt-4 flex items-center justify-center gap-2">
                    {sender.email && (
                      <button
                        type="button"
                        onClick={emailLink}
                        className="rounded-lg border border-navy/20 px-3 py-1.5 text-xs font-medium text-navy/70 hover:bg-cream"
                      >
                        ✉️ Email link
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={copyLink}
                      className="rounded-lg border border-navy/20 px-3 py-1.5 text-xs font-medium text-navy/70 hover:bg-cream"
                    >
                      {copied ? 'Copied!' : '🔗 Copy link'}
                    </button>
                  </div>
                  {emailMsg && <p className="mt-2 text-xs text-navy/50">{emailMsg}</p>}
                  <div className="mt-4 flex items-center justify-center gap-2 text-sm text-navy/50">
                    <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                    </svg>
                    Waiting for verification…
                  </div>
                </>
              )}

              {status === 'verified' && (
                <div className="py-10">
                  <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-green-100">
                    <svg className="h-7 w-7 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <p className="mt-3 text-lg font-bold text-navy">Identity verified</p>
                </div>
              )}
            </div>
          )}

          {/* ── Manual ── */}
          {mode === 'manual' && (
            <div className="space-y-3">
              <p className="text-xs text-navy/50">
                Visually inspect the customer&apos;s physical photo ID and record the basics. Do not
                copy the full ID number — last 4 only.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={lblCls} htmlFor="docType">ID type</label>
                  <select id="docType" value={m.documentType} onChange={(e) => setM({ ...m, documentType: e.target.value })} className={inputCls}>
                    {DOC_TYPES.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className={lblCls} htmlFor="issState">Issuing state</label>
                  <input id="issState" type="text" maxLength={2} value={m.issuingState} onChange={(e) => setM({ ...m, issuingState: e.target.value.toUpperCase() })} placeholder="IA" className={inputCls} />
                </div>
                <div>
                  <label className={lblCls} htmlFor="last4">ID last 4 (optional)</label>
                  <input id="last4" type="text" inputMode="numeric" maxLength={4} value={m.idNumberLast4} onChange={(e) => setM({ ...m, idNumberLast4: e.target.value.replace(/\D/g, '') })} placeholder="1234" className={inputCls} />
                </div>
                <div>
                  <label className={lblCls} htmlFor="exp">Expiration</label>
                  <input id="exp" type="month" value={m.documentExpiration} onChange={(e) => setM({ ...m, documentExpiration: e.target.value })} className={inputCls} />
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm text-navy/80">
                <input type="checkbox" checked={m.over21} onChange={(e) => setM({ ...m, over21: e.target.checked })} className="h-4 w-4 rounded border-navy/30 text-blue focus:ring-blue" />
                Customer is 21 or older (DOB on ID)
              </label>
              {error && <p className="rounded-lg bg-red/10 px-3 py-2 text-sm text-red">{error}</p>}
              <button
                type="button"
                onClick={submitManual}
                disabled={submitting || !sender.name.trim()}
                className="w-full rounded-xl bg-blue px-4 py-2.5 text-sm font-bold text-white shadow-sm transition-colors hover:bg-navy disabled:opacity-50"
              >
                {submitting ? 'Saving…' : 'Record ID check'}
              </button>
              {!sender.name.trim() && (
                <p className="text-center text-[11px] text-navy/40">Enter the sender name first.</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
