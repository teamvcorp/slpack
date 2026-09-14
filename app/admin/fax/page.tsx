"use client";

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Admin → Fax. Send a fax (upload a PDF) and browse the local archive of
 * outgoing + incoming faxes (Sinch Fax API). PDFs open through the admin-gated
 * /api/admin/fax/[id]/file route. Inbound faxes are marked read on open.
 */

interface FaxEntry {
  sinchId: string;
  direction: 'INBOUND' | 'OUTBOUND';
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';
  from?: string;
  to?: string;
  numberOfPages?: number;
  priceUSD?: number;
  errorType?: string;
  errorMessage?: string;
  headerText?: string;
  createdAt: string;
  completedAt?: string;
  read?: boolean;
}

const card = 'rounded-2xl border border-navy/10 bg-white p-6 shadow-sm';
const labelCls = 'mb-1 block text-xs font-semibold uppercase tracking-wide text-navy/50';
const inputCls =
  'w-full rounded-lg border border-navy/20 bg-white px-3 py-2 text-sm text-navy focus:border-blue focus:outline-none focus:ring-1 focus:ring-blue';
const btn = 'rounded-xl bg-blue px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-navy disabled:opacity-50';
const btnGhost = 'rounded-lg border border-navy/20 px-3 py-1.5 text-xs font-semibold text-navy/60 transition-colors hover:bg-cream';

function statusPill(status: FaxEntry['status']) {
  const map: Record<FaxEntry['status'], string> = {
    COMPLETED: 'bg-green-500/10 text-green-700',
    PENDING: 'bg-tan/30 text-navy/70',
    IN_PROGRESS: 'bg-tan/30 text-navy/70',
    FAILED: 'bg-red/10 text-red',
  };
  const label = status === 'IN_PROGRESS' ? 'Sending' : status.charAt(0) + status.slice(1).toLowerCase();
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${map[status]}`}>{label}</span>;
}

export default function FaxPage() {
  const [tab, setTab] = useState<'INBOUND' | 'OUTBOUND'>('INBOUND');
  const [entries, setEntries] = useState<FaxEntry[]>([]);
  const [unread, setUnread] = useState(0);
  const [configured, setConfigured] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);

  const [to, setTo] = useState('');
  const [headerText, setHeaderText] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const [sending, setSending] = useState(false);
  const [sendMsg, setSendMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`/api/admin/fax?direction=${tab}`, { cache: 'no-store' });
      if (res.status === 401) { setSessionExpired(true); return; }
      const data = await res.json();
      setEntries(data.entries ?? []);
      setUnread(data.unread ?? 0);
      setConfigured(data.configured !== false);
    } catch {
      setError('Could not load faxes.');
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => { void load(); }, [load]);

  async function handleSend() {
    const file = fileRef.current?.files?.[0];
    if (!to.trim()) { setSendMsg('Enter a destination fax number.'); return; }
    if (!file) { setSendMsg('Choose a PDF to fax.'); return; }
    setSending(true); setSendMsg(null); setError(null);
    try {
      const fd = new FormData();
      fd.set('to', to.trim());
      if (headerText.trim()) fd.set('headerText', headerText.trim());
      fd.set('file', file);
      const res = await fetch('/api/admin/fax', { method: 'POST', body: fd });
      if (res.status === 401) { setSessionExpired(true); setSending(false); return; }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Error ${res.status}`);
      setSendMsg(`Fax queued to ${data.fax.to}.`);
      setTo(''); setHeaderText('');
      if (fileRef.current) fileRef.current.value = '';
      setTab('OUTBOUND');
    } catch (err: unknown) {
      setSendMsg(err instanceof Error ? err.message : 'Send failed.');
    } finally {
      setSending(false);
    }
  }

  async function viewFax(f: FaxEntry) {
    window.open(`/api/admin/fax/${f.sinchId}/file`, '_blank', 'noopener,noreferrer');
    if (f.direction === 'INBOUND' && !f.read) {
      await fetch(`/api/admin/fax/${f.sinchId}`, { method: 'PATCH' });
      await load();
    }
  }

  return (
    <div className="py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-navy">Fax</h1>
        <p className="mt-1 text-sm text-navy/50">Send a fax and view incoming &amp; outgoing faxes.</p>
      </div>

      {!configured && (
        <div className="mb-4 rounded-xl border border-yellow-200 bg-yellow-50 px-4 py-3 text-sm text-yellow-800">
          Fax isn&apos;t configured yet. Set <code className="rounded bg-black/5 px-1">SINCH_PROJECT_ID</code>,{' '}
          <code className="rounded bg-black/5 px-1">SINCH_KEY_ID</code>,{' '}
          <code className="rounded bg-black/5 px-1">SINCH_KEY_SECRET</code>, and{' '}
          <code className="rounded bg-black/5 px-1">SINCH_FAX_NUMBER</code> to enable sending.
        </div>
      )}

      {sessionExpired && (
        <div className="mb-4 flex flex-col gap-2 rounded-xl border border-yellow-200 bg-yellow-50 px-4 py-3 text-sm text-yellow-800 sm:flex-row sm:items-center sm:justify-between">
          <span>Your admin session expired. Log in again — your entries here are kept — then retry.</span>
          <a href="/admin/login" target="_blank" rel="noopener noreferrer" className="shrink-0 rounded-lg bg-navy px-3 py-1.5 text-xs font-semibold text-white hover:bg-navy/90">
            Log in (new tab) ↗
          </a>
        </div>
      )}

      {error && <div className="mb-4 rounded-xl bg-red/10 px-4 py-3 text-sm text-red">{error}</div>}

      {/* Send a fax */}
      <div className={`${card} mb-6`}>
        <h2 className="mb-4 text-base font-semibold text-navy">Send a fax</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr]">
          <div>
            <label className={labelCls} htmlFor="fax-to">To (fax number)</label>
            <input id="fax-to" className={inputCls} value={to} onChange={(e) => setTo(e.target.value)} placeholder="(712) 555-0134" inputMode="tel" />
          </div>
          <div>
            <label className={labelCls} htmlFor="fax-header">Header text (optional)</label>
            <input id="fax-header" className={inputCls} value={headerText} onChange={(e) => setHeaderText(e.target.value)} maxLength={50} placeholder="Storm Lake Pack & Ship" />
          </div>
          <div className="sm:col-span-2">
            <label className={labelCls} htmlFor="fax-file">PDF to fax</label>
            <input id="fax-file" ref={fileRef} type="file" accept="application/pdf" className="block w-full text-sm text-navy/70 file:mr-3 file:rounded-lg file:border-0 file:bg-navy/10 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-navy hover:file:bg-navy/15" />
            <p className="mt-1 text-[11px] text-navy/40">PDF only, up to 4 MB.</p>
          </div>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <button type="button" onClick={handleSend} disabled={sending || !configured} className={btn}>
            {sending ? 'Sending…' : 'Send fax'}
          </button>
          {sendMsg && <span className="text-sm text-navy/60">{sendMsg}</span>}
        </div>
      </div>

      {/* Tabs */}
      <div className="mb-3 flex gap-1 rounded-xl border border-navy/10 bg-cream p-1">
        {[
          { key: 'INBOUND' as const, label: `Inbox${unread ? ` (${unread})` : ''}` },
          { key: 'OUTBOUND' as const, label: 'Sent' },
        ].map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`rounded-lg px-4 py-1.5 text-sm font-semibold transition-colors ${
              tab === t.key ? 'bg-white text-navy shadow-sm' : 'text-navy/50 hover:text-navy'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* List */}
      <div className="overflow-hidden rounded-xl border border-navy/10 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-navy/10 bg-cream text-left">
                <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-navy/40">When</th>
                <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-navy/40">{tab === 'INBOUND' ? 'From' : 'To'}</th>
                <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-navy/40">Pages</th>
                <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-navy/40">Status</th>
                <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-navy/40"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-navy/5">
              {loading ? (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-navy/40">Loading…</td></tr>
              ) : entries.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-navy/40">{tab === 'INBOUND' ? 'No incoming faxes.' : 'No sent faxes.'}</td></tr>
              ) : (
                entries.map((f) => {
                  const unreadRow = f.direction === 'INBOUND' && !f.read;
                  return (
                    <tr key={f.sinchId} className={`hover:bg-cream/50 ${unreadRow ? 'bg-blue/5' : ''}`}>
                      <td className="px-4 py-3 text-navy/70">
                        {unreadRow && <span className="mr-1 inline-block h-2 w-2 rounded-full bg-blue align-middle" title="Unread" />}
                        {new Date(f.createdAt).toLocaleString()}
                      </td>
                      <td className="px-4 py-3 font-medium text-navy">{tab === 'INBOUND' ? (f.from || 'unknown') : (f.to || '—')}</td>
                      <td className="px-4 py-3 text-navy/60">{f.numberOfPages ?? '—'}</td>
                      <td className="px-4 py-3">
                        {statusPill(f.status)}
                        {f.status === 'FAILED' && f.errorMessage && (
                          <span className="ml-2 text-[11px] text-red">{f.errorMessage}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button type="button" onClick={() => viewFax(f)} className={btnGhost}>View PDF</button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
