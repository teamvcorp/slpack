"use client";

import { useState } from 'react';

/**
 * Partner shipment reconciliation.
 *
 * When a carrier invoice bills a higher "adjusted" cost — because a partner's
 * declared box didn't match what the carrier measured — this is where the shop
 * links that adjustment to the exact package (by tracking number), sees the
 * declared vs. corrected dimensions and the margin hit, and records it against
 * the partner for billback.
 */

interface Adjustment {
  adjustmentId: string;
  recordedAt: string;
  adjustedCostUSD?: number;
  deltaUSD: number;
  reason?: string;
  correctedWeightLbs?: number;
  correctedLengthIn?: number;
  correctedWidthIn?: number;
  correctedHeightIn?: number;
  carrierInvoiceRef?: string;
  note?: string;
  billbackStatus: 'pending' | 'billed' | 'absorbed';
}
interface Shipment {
  id: string;
  partnerId: string;
  createdAt: string;
  carrier: string;
  serviceName: string;
  status: string;
  trackingNumber?: string;
  retailUSD: number;
  freightRetailUSD: number;
  packingFeeUSD: number;
  carrierCostUSD?: number;
  quotedCostBasisUSD?: number;
  declaredPackage?: { weightLbs?: number; lengthIn?: number; widthIn?: number; heightIn?: number };
  residential?: boolean;
  orderRef?: string;
  recipient?: { name?: string; city?: string; state?: string; zip?: string };
  adjustments?: Adjustment[];
  reconcile?: { totalAdjustmentsUSD: number; effectiveCarrierCostUSD: number; freightMarginUSD: number; underwater: boolean };
}

const card = 'rounded-2xl border border-navy/10 bg-white p-6 shadow-sm';
const inputCls = 'w-full rounded-lg border border-navy/20 bg-white px-3 py-2 text-sm text-navy focus:border-blue focus:outline-none focus:ring-1 focus:ring-blue';
const labelCls = 'mb-1 block text-[11px] font-semibold uppercase tracking-wide text-navy/50';
const btn = 'rounded-xl bg-blue px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-navy disabled:opacity-50';
const btnGhost = 'rounded-lg border border-navy/20 px-3 py-1.5 text-xs font-semibold text-navy/60 transition-colors hover:bg-cream';

const money = (n: number | undefined) => (typeof n === 'number' ? `$${n.toFixed(2)}` : '—');
const dims = (p?: Shipment['declaredPackage']) => (p ? `${p.lengthIn}×${p.widthIn}×${p.heightIn} in, ${p.weightLbs} lb` : '—');

const REASONS = ['dimensional_reweigh', 'additional_handling', 'residential', 'correction', 'other'];
const REASON_LABEL: Record<string, string> = {
  dimensional_reweigh: 'Dimensional reweigh',
  additional_handling: 'Additional handling',
  residential: 'Residential surcharge',
  correction: 'Correction',
  other: 'Other',
};

export default function Reconciliation() {
  const [tracking, setTracking] = useState('');
  const [onlyAdjusted, setOnlyAdjusted] = useState(false);
  const [rows, setRows] = useState<Shipment[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const [openForm, setOpenForm] = useState<string | null>(null);

  async function search() {
    setLoading(true);
    setError(null);
    setSearched(true);
    try {
      const qs = new URLSearchParams();
      if (tracking.trim()) qs.set('tracking', tracking.trim());
      if (onlyAdjusted) qs.set('adjusted', '1');
      const res = await fetch(`/api/admin/partner-shipments?${qs.toString()}`);
      if (res.status === 401) { setError('Session expired — log in again.'); return; }
      const data = await res.json();
      setRows(data.shipments ?? []);
    } catch {
      setError('Search failed.');
    } finally {
      setLoading(false);
    }
  }

  function replaceRow(updated: Shipment) {
    setRows((rs) => rs.map((r) => (r.id === updated.id ? updated : r)));
  }

  return (
    <div className={`${card} mt-6`}>
      <h2 className="mb-1 text-base font-semibold text-navy">Shipment reconciliation &amp; carrier adjustments</h2>
      <p className="mb-4 text-xs text-navy/50">
        A carrier invoice bills by <strong>tracking number</strong>. Look up the package, compare the declared box to what
        the carrier measured, and record the adjusted cost against the partner.
      </p>

      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[240px] flex-1">
          <label className={labelCls} htmlFor="trk">Tracking number (from the carrier invoice)</label>
          <input id="trk" className={inputCls} value={tracking} onChange={(e) => setTracking(e.target.value)} placeholder="1ZXXXXXXXXXXXXXXXX" onKeyDown={(e) => e.key === 'Enter' && search()} />
        </div>
        <label className="flex items-center gap-2 pb-2 text-xs text-navy/60">
          <input type="checkbox" checked={onlyAdjusted} onChange={(e) => setOnlyAdjusted(e.target.checked)} />
          Only shipments with adjustments
        </label>
        <button type="button" className={btn} onClick={search} disabled={loading}>{loading ? 'Searching…' : 'Search'}</button>
      </div>

      {error && <div className="mt-3 rounded-xl bg-red/10 px-4 py-3 text-sm text-red">{error}</div>}

      {searched && !loading && rows.length === 0 && (
        <p className="mt-4 text-sm text-navy/40">No matching shipments.</p>
      )}

      {rows.length > 0 && (
        <div className="mt-4 space-y-3">
          {rows.map((s) => {
            const rec = s.reconcile;
            return (
              <div key={s.id} className={`rounded-xl border p-4 ${rec?.underwater ? 'border-red/40 bg-red/5' : 'border-navy/10'}`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="text-sm">
                    <div className="font-semibold text-navy">{s.carrier?.toUpperCase()} {s.serviceName} · <span className="font-mono">{s.trackingNumber ?? 'no tracking'}</span></div>
                    <div className="mt-1 text-xs text-navy/50">
                      {new Date(s.createdAt).toLocaleString()} · order {s.orderRef ?? '—'} · to {s.recipient?.name} ({s.recipient?.city}, {s.recipient?.state} {s.recipient?.zip})
                    </div>
                    <div className="mt-1 text-xs text-navy/50">partner <span className="font-mono">{s.partnerId.slice(0, 8)}…</span> · {s.residential ? 'residential' : 'commercial'}</div>
                  </div>
                  <button type="button" className={btnGhost} onClick={() => setOpenForm(openForm === s.id ? null : s.id)}>
                    {openForm === s.id ? 'Cancel' : '+ Record adjustment'}
                  </button>
                </div>

                {/* declared vs cost snapshot */}
                <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-xs sm:grid-cols-4">
                  <Fact label="Declared box" value={dims(s.declaredPackage)} />
                  <Fact label="Freight retail" value={money(s.freightRetailUSD)} />
                  <Fact label="Carrier cost (label)" value={money(s.carrierCostUSD)} />
                  <Fact label="Effective cost" value={money(rec?.effectiveCarrierCostUSD)} highlight={Boolean(rec && rec.totalAdjustmentsUSD > 0)} />
                  {rec && rec.totalAdjustmentsUSD > 0 && <Fact label="Adjustments" value={`+${money(rec.totalAdjustmentsUSD)}`} highlight />}
                  <Fact label="Freight margin" value={money(rec?.freightMarginUSD)} danger={rec?.underwater} />
                </div>

                {/* existing adjustments */}
                {s.adjustments && s.adjustments.length > 0 && (
                  <div className="mt-3 border-t border-navy/10 pt-3">
                    <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-navy/40">Recorded adjustments</div>
                    <div className="space-y-1">
                      {s.adjustments.map((a) => (
                        <div key={a.adjustmentId} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-navy/5 px-3 py-2 text-xs">
                          <span>
                            <span className="font-semibold text-red">+{money(a.deltaUSD)}</span>{' '}
                            {a.reason ? REASON_LABEL[a.reason] ?? a.reason : 'adjustment'}
                            {(a.correctedLengthIn || a.correctedWeightLbs) ? ` · measured ${a.correctedLengthIn ?? '?'}×${a.correctedWidthIn ?? '?'}×${a.correctedHeightIn ?? '?'} in, ${a.correctedWeightLbs ?? '?'} lb` : ''}
                            {a.carrierInvoiceRef ? ` · inv ${a.carrierInvoiceRef}` : ''}
                            <span className="text-navy/40"> · {new Date(a.recordedAt).toLocaleDateString()}</span>
                          </span>
                          <BillbackBadge shipmentId={s.id} a={a} onChanged={search} />
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {openForm === s.id && (
                  <AdjustmentForm shipment={s} onDone={(updated) => { setOpenForm(null); replaceRow(updated); }} onError={setError} />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Fact({ label, value, highlight, danger }: { label: string; value: string; highlight?: boolean; danger?: boolean }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-navy/40">{label}</div>
      <div className={`font-semibold ${danger ? 'text-red' : highlight ? 'text-navy' : 'text-navy/80'}`}>{value}</div>
    </div>
  );
}

function BillbackBadge({ shipmentId, a, onChanged }: { shipmentId: string; a: Adjustment; onChanged: () => void }) {
  const color = a.billbackStatus === 'billed' ? 'bg-green-100 text-green-700' : a.billbackStatus === 'absorbed' ? 'bg-navy/10 text-navy/50' : 'bg-tan/30 text-navy/70';
  const next: Record<string, Adjustment['billbackStatus']> = { pending: 'billed', billed: 'absorbed', absorbed: 'pending' };
  async function cycle() {
    await fetch('/api/admin/partner-shipments', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shipmentId, adjustmentId: a.adjustmentId, billbackStatus: next[a.billbackStatus] }),
    });
    onChanged();
  }
  return (
    <button type="button" onClick={cycle} className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${color}`} title="Click to change billback status">
      {a.billbackStatus}
    </button>
  );
}

function AdjustmentForm({ shipment, onDone, onError }: { shipment: Shipment; onDone: (s: Shipment) => void; onError: (m: string) => void }) {
  const [f, setF] = useState({ adjustedCostUSD: '', deltaUSD: '', reason: 'dimensional_reweigh', correctedLengthIn: '', correctedWidthIn: '', correctedHeightIn: '', correctedWeightLbs: '', carrierInvoiceRef: '', note: '', billbackStatus: 'pending' });
  const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof f, v: string) => setF((s) => ({ ...s, [k]: v }));

  async function save() {
    if (!f.adjustedCostUSD && !f.deltaUSD) { onError('Enter the adjusted total or the extra amount billed.'); return; }
    setSaving(true);
    try {
      const res = await fetch('/api/admin/partner-shipments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: shipment.id,
          adjustedCostUSD: f.adjustedCostUSD || undefined,
          deltaUSD: f.deltaUSD || undefined,
          reason: f.reason,
          correctedLengthIn: f.correctedLengthIn || undefined,
          correctedWidthIn: f.correctedWidthIn || undefined,
          correctedHeightIn: f.correctedHeightIn || undefined,
          correctedWeightLbs: f.correctedWeightLbs || undefined,
          carrierInvoiceRef: f.carrierInvoiceRef || undefined,
          note: f.note || undefined,
          billbackStatus: f.billbackStatus,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Error ${res.status}`);
      onDone(data.shipment);
    } catch (err: unknown) {
      onError(err instanceof Error ? err.message : 'Could not record adjustment.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-3 rounded-xl border border-blue/30 bg-blue/5 p-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div>
          <label className={labelCls}>Adjusted total $</label>
          <input className={inputCls} inputMode="decimal" value={f.adjustedCostUSD} onChange={(e) => set('adjustedCostUSD', e.target.value)} placeholder="e.g. 58.20" />
        </div>
        <div>
          <label className={labelCls}>…or extra billed $</label>
          <input className={inputCls} inputMode="decimal" value={f.deltaUSD} onChange={(e) => set('deltaUSD', e.target.value)} placeholder="e.g. 18.49" />
        </div>
        <div className="col-span-2">
          <label className={labelCls}>Reason</label>
          <select className={inputCls} value={f.reason} onChange={(e) => set('reason', e.target.value)}>
            {REASONS.map((r) => <option key={r} value={r}>{REASON_LABEL[r]}</option>)}
          </select>
        </div>
        <div><label className={labelCls}>Meas. L</label><input className={inputCls} inputMode="decimal" value={f.correctedLengthIn} onChange={(e) => set('correctedLengthIn', e.target.value)} /></div>
        <div><label className={labelCls}>Meas. W</label><input className={inputCls} inputMode="decimal" value={f.correctedWidthIn} onChange={(e) => set('correctedWidthIn', e.target.value)} /></div>
        <div><label className={labelCls}>Meas. H</label><input className={inputCls} inputMode="decimal" value={f.correctedHeightIn} onChange={(e) => set('correctedHeightIn', e.target.value)} /></div>
        <div><label className={labelCls}>Meas. lb</label><input className={inputCls} inputMode="decimal" value={f.correctedWeightLbs} onChange={(e) => set('correctedWeightLbs', e.target.value)} /></div>
        <div className="col-span-2"><label className={labelCls}>Carrier invoice #</label><input className={inputCls} value={f.carrierInvoiceRef} onChange={(e) => set('carrierInvoiceRef', e.target.value)} /></div>
        <div className="col-span-2"><label className={labelCls}>Billback</label>
          <select className={inputCls} value={f.billbackStatus} onChange={(e) => set('billbackStatus', e.target.value)}>
            <option value="pending">Pending</option><option value="billed">Billed to partner</option><option value="absorbed">Absorbed</option>
          </select>
        </div>
        <div className="col-span-2 sm:col-span-4"><label className={labelCls}>Note</label><input className={inputCls} value={f.note} onChange={(e) => set('note', e.target.value)} placeholder="optional" /></div>
      </div>
      <div className="mt-3 flex justify-end">
        <button type="button" className={btn} onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Record adjustment'}</button>
      </div>
      <p className="mt-2 text-[11px] text-navy/40">
        Declared box: {dims(shipment.declaredPackage)} · label cost {money(shipment.carrierCostUSD)}. Enter the corrected total OR just the extra billed — the delta is computed either way.
      </p>
    </div>
  );
}
