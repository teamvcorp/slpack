"use client";

import { useCallback, useEffect, useState } from 'react';
import Reconciliation from './Reconciliation';

/**
 * Admin → Partners. Issue and manage credentials for the Partner Shipping API
 * (e.g. mainstreet-shops.com), and work the pickup/review queue.
 *
 * The secret is shown EXACTLY ONCE at creation or rotation — it is scrypt-hashed
 * at rest and cannot be retrieved again. The page surfaces it in a copy banner
 * and never re-requests it.
 */

interface Partner {
  partnerId: string;
  keyId: string;
  displayName: string;
  businessEmail: string;
  active: boolean;
  createdAt: string;
  lastUsedAt?: string;
}

interface Pickup {
  id: string;
  createdAt: string;
  status: string;
  mode: string;
  carrier: string;
  serviceName: string;
  retailUSD: number;
  orderRef?: string;
  recipient?: { name?: string; city?: string; state?: string; zip?: string; street?: string };
}

const card = 'rounded-2xl border border-navy/10 bg-white p-6 shadow-sm';
const labelCls = 'mb-1 block text-xs font-semibold uppercase tracking-wide text-navy/50';
const inputCls =
  'w-full rounded-lg border border-navy/20 bg-white px-3 py-2 text-sm text-navy focus:border-blue focus:outline-none focus:ring-1 focus:ring-blue';
const btn = 'rounded-xl bg-blue px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-navy disabled:opacity-50';
const btnGhost = 'rounded-lg border border-navy/20 px-3 py-1.5 text-xs font-semibold text-navy/60 transition-colors hover:bg-cream';

export default function PartnersPage() {
  const [partners, setPartners] = useState<Partner[]>([]);
  const [pickups, setPickups] = useState<Pickup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [creating, setCreating] = useState(false);

  // The one-time credential to display after create/rotate.
  const [revealed, setRevealed] = useState<{ label: string; keyId?: string; secret: string } | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [pRes, qRes] = await Promise.all([
        fetch('/api/admin/partners'),
        fetch('/api/admin/partner-pickups'),
      ]);
      if (pRes.status === 401 || qRes.status === 401) {
        setError('Your admin session expired. Reload after logging in again.');
        return;
      }
      const pData = await pRes.json();
      const qData = await qRes.json();
      setPartners(pData.partners ?? []);
      setPickups(qData.shipments ?? []);
    } catch {
      setError('Could not load partners.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function createPartner() {
    setCreating(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/partners', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: name.trim(), businessEmail: email.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Error ${res.status}`);
      setRevealed({ label: data.partner.displayName, keyId: data.credential.keyId, secret: data.credential.secret });
      setName('');
      setEmail('');
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not create partner.');
    } finally {
      setCreating(false);
    }
  }

  async function toggleActive(p: Partner) {
    await fetch(`/api/admin/partners/${p.partnerId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: !p.active }),
    });
    await load();
  }

  async function rotate(p: Partner) {
    if (!confirm(`Rotate the secret for "${p.displayName}"? The current secret stops working immediately.`)) return;
    const res = await fetch(`/api/admin/partners/${p.partnerId}/secret`, { method: 'POST' });
    const data = await res.json();
    if (res.ok) setRevealed({ label: p.displayName, keyId: p.keyId, secret: data.credential.secret });
    else setError(data.error ?? 'Could not rotate secret.');
  }

  async function markShipped(id: string) {
    const trackingNumber = prompt('Tracking number (optional):') ?? undefined;
    const res = await fetch('/api/admin/partner-pickups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, trackingNumber: trackingNumber?.trim() || undefined }),
    });
    if (res.ok) await load();
    else setError('Could not update.');
  }

  return (
    <div className="py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-navy">Partners</h1>
        <p className="mt-1 text-sm text-navy/50">
          Credentials for the Partner Shipping API (server-to-server label buying). The API is inert until{' '}
          <code className="rounded bg-navy/5 px-1">PARTNER_API_SECRET</code> is set in the environment.
        </p>
      </div>

      {error && <div className="mb-4 rounded-xl bg-red/10 px-4 py-3 text-sm text-red">{error}</div>}

      {/* One-time credential reveal */}
      {revealed && (
        <div className="mb-6 rounded-2xl border-2 border-blue/40 bg-blue/5 p-6">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-base font-bold text-navy">Credential for “{revealed.label}”</h2>
              <p className="mt-1 text-sm text-red">
                Copy the secret now — it is shown once and cannot be retrieved again.
              </p>
            </div>
            <button type="button" onClick={() => setRevealed(null)} className={btnGhost}>Done</button>
          </div>
          <div className="mt-4 space-y-2 font-mono text-sm">
            {revealed.keyId && (
              <div className="flex items-center gap-2">
                <span className="w-28 shrink-0 text-navy/50">X-Partner-Id</span>
                <code className="flex-1 break-all rounded bg-white px-3 py-2 text-navy">{revealed.keyId}</code>
                <button type="button" className={btnGhost} onClick={() => navigator.clipboard?.writeText(revealed.keyId ?? '')}>Copy</button>
              </div>
            )}
            <div className="flex items-center gap-2">
              <span className="w-28 shrink-0 text-navy/50">X-Partner-Secret</span>
              <code className="flex-1 break-all rounded bg-white px-3 py-2 text-navy">{revealed.secret}</code>
              <button type="button" className={btnGhost} onClick={() => navigator.clipboard?.writeText(revealed.secret)}>Copy</button>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Create */}
        <div className={card}>
          <h2 className="mb-4 text-base font-semibold text-navy">Issue a credential</h2>
          <div className="space-y-3">
            <div>
              <label className={labelCls} htmlFor="pname">Partner name</label>
              <input id="pname" className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="Main Street Shops" />
            </div>
            <div>
              <label className={labelCls} htmlFor="pemail">Business email (label delivery)</label>
              <input id="pemail" type="email" className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="owner@mainstreet-shops.com" />
            </div>
            <button type="button" onClick={createPartner} disabled={creating || !name.trim() || !email.trim()} className={`${btn} w-full`}>
              {creating ? 'Creating…' : 'Create partner'}
            </button>
          </div>
        </div>

        {/* Partner list */}
        <div className={`${card} lg:col-span-2`}>
          <h2 className="mb-4 text-base font-semibold text-navy">Credentials</h2>
          {loading ? (
            <p className="text-sm text-navy/40">Loading…</p>
          ) : partners.length === 0 ? (
            <p className="text-sm text-navy/40">No partners yet.</p>
          ) : (
            <div className="space-y-3">
              {partners.map((p) => (
                <div key={p.partnerId} className="rounded-xl border border-navy/10 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-navy">{p.displayName}</span>
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${p.active ? 'bg-green-100 text-green-700' : 'bg-navy/10 text-navy/50'}`}>
                          {p.active ? 'Active' : 'Inactive'}
                        </span>
                      </div>
                      <div className="mt-1 font-mono text-xs text-navy/50">{p.keyId}</div>
                      <div className="text-xs text-navy/40">{p.businessEmail}</div>
                    </div>
                    <div className="flex gap-2">
                      <button type="button" className={btnGhost} onClick={() => toggleActive(p)}>
                        {p.active ? 'Deactivate' : 'Activate'}
                      </button>
                      <button type="button" className={btnGhost} onClick={() => rotate(p)}>Rotate secret</button>
                    </div>
                  </div>
                  {p.lastUsedAt && (
                    <div className="mt-2 text-[11px] text-navy/40">Last used {new Date(p.lastUsedAt).toLocaleString()}</div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Pickup & review queue */}
      <div className={`${card} mt-6`}>
        <h2 className="mb-1 text-base font-semibold text-navy">Pickup &amp; review queue</h2>
        <p className="mb-4 text-xs text-navy/50">
          Pickup &amp; pack requests, plus any self-ship label that needs manual completion.
        </p>
        {pickups.length === 0 ? (
          <p className="text-sm text-navy/40">Nothing waiting.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-navy/40">
                  <th className="py-2 pr-4">When</th>
                  <th className="py-2 pr-4">Status</th>
                  <th className="py-2 pr-4">Ship to</th>
                  <th className="py-2 pr-4">Service</th>
                  <th className="py-2 pr-4">Order</th>
                  <th className="py-2 pr-4"></th>
                </tr>
              </thead>
              <tbody>
                {pickups.map((s) => (
                  <tr key={s.id} className="border-t border-navy/5">
                    <td className="py-2 pr-4 text-navy/60">{new Date(s.createdAt).toLocaleString()}</td>
                    <td className="py-2 pr-4">
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${s.status === 'needs_review' ? 'bg-red/10 text-red' : 'bg-tan/30 text-navy/70'}`}>
                        {s.status === 'needs_review' ? 'Needs review' : 'Awaiting pack'}
                      </span>
                    </td>
                    <td className="py-2 pr-4 text-navy/70">
                      {s.recipient?.name}<br />
                      <span className="text-xs text-navy/40">
                        {s.recipient?.street ? `${s.recipient.street}, ` : ''}{s.recipient?.city}, {s.recipient?.state} {s.recipient?.zip}
                      </span>
                    </td>
                    <td className="py-2 pr-4 text-navy/60">{s.carrier?.toUpperCase()} {s.serviceName}</td>
                    <td className="py-2 pr-4 text-navy/50">{s.orderRef ?? '—'}</td>
                    <td className="py-2 pr-4">
                      <button type="button" className={btnGhost} onClick={() => markShipped(s.id)}>Mark shipped</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Carrier adjustment reconciliation — link a re-rated cost to its package */}
      <Reconciliation />
    </div>
  );
}
