"use client";

import { useState, useEffect, useCallback } from 'react';
import type { CarrierBalance, CarrierKey } from '../types/shipping';

interface BalancesResponse {
  balances: CarrierBalance[];
  uspsPrepaid: { balanceUSD: number; asOf: string } | null;
}

const CARRIER_LABELS: Record<CarrierKey, string> = {
  fedex: 'FedEx',
  ups: 'UPS',
  usps: 'USPS',
  dhl: 'DHL',
};

const CARRIER_COLORS: Record<CarrierKey, string> = {
  fedex: '#4D148C',
  ups: '#351C15',
  usps: '#004B87',
  dhl: '#D40511',
};

function fmtMoney(n: number): string {
  const abs = Math.abs(n).toFixed(2);
  return n < 0 ? `−$${abs}` : `$${abs}`;
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString();
}

interface SettleForm {
  amountUSD: string;
  paidAt: string;
  invoiceRef: string;
  note: string;
}

const EMPTY_FORM: SettleForm = {
  amountUSD: '',
  paidAt: '',
  invoiceRef: '',
  note: '',
};

export default function BalancesPage() {
  const [data, setData] = useState<BalancesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openCarrier, setOpenCarrier] = useState<CarrierKey | null>(null);
  const [form, setForm] = useState<SettleForm>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [refreshingTracking, setRefreshingTracking] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/shipping/balances');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load balances');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  async function refreshTracking() {
    setRefreshingTracking(true);
    setActionMessage(null);
    try {
      const res = await fetch('/api/shipping/tracking/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: 50 }),
      });
      const body: { ok?: boolean; checked?: number; accepted?: number; pending?: number; error?: string } =
        await res.json().catch(() => ({}));
      if (!res.ok || !body.ok) {
        setActionMessage(body.error ?? `Tracking refresh failed (HTTP ${res.status})`);
        return;
      }
      setActionMessage(
        `Checked ${body.checked} shipment(s) — ${body.accepted} newly accepted, ${body.pending} still pending.`
      );
      await refresh();
    } catch (e) {
      setActionMessage(e instanceof Error ? e.message : 'Tracking refresh failed');
    } finally {
      setRefreshingTracking(false);
    }
  }

  function openSettleFor(c: CarrierKey, prefilledAmount: number) {
    setOpenCarrier(c);
    setForm({
      ...EMPTY_FORM,
      amountUSD: prefilledAmount > 0 ? prefilledAmount.toFixed(2) : '',
      paidAt: new Date().toISOString().slice(0, 10),
    });
    setActionMessage(null);
  }

  async function submitSettle() {
    if (!openCarrier) return;
    const amt = Number(form.amountUSD);
    if (!Number.isFinite(amt) || amt <= 0) {
      setActionMessage('Enter a positive amount.');
      return;
    }
    setSubmitting(true);
    setActionMessage(null);
    try {
      const res = await fetch('/api/shipping/balances/settle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          carrier: openCarrier,
          amountUSD: amt,
          paidAt: form.paidAt ? new Date(form.paidAt).toISOString() : undefined,
          invoiceRef: form.invoiceRef || undefined,
          note: form.note || undefined,
        }),
      });
      const body: { ok?: boolean; error?: string } = await res.json().catch(() => ({}));
      if (!res.ok || !body.ok) {
        setActionMessage(body.error ?? `Failed (HTTP ${res.status})`);
        return;
      }
      setActionMessage(`Settlement recorded for ${CARRIER_LABELS[openCarrier]}.`);
      setOpenCarrier(null);
      setForm(EMPTY_FORM);
      await refresh();
    } catch (e) {
      setActionMessage(e instanceof Error ? e.message : 'Failed to record');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="py-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-navy">Carrier Balances</h1>
          <p className="mt-1 text-sm text-navy/50">
            Confirmed (carrier-scanned) shipment charges minus the payments you&apos;ve recorded.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={refreshTracking}
            disabled={refreshingTracking}
            className="rounded-xl border border-navy/15 bg-white px-3 py-1.5 text-sm font-medium text-navy shadow-sm hover:bg-cream disabled:opacity-50"
            title="Poll FedEx/UPS/USPS tracking to confirm packages have been tendered"
          >
            {refreshingTracking ? 'Checking tracking…' : 'Refresh tracking'}
          </button>
          <button
            type="button"
            onClick={refresh}
            className="rounded-xl border border-navy/15 bg-white px-3 py-1.5 text-sm font-medium text-navy shadow-sm hover:bg-cream"
          >
            Reload
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-xl bg-red/10 px-4 py-3 text-sm text-red">{error}</div>
      )}
      {actionMessage && (
        <div className="mb-4 flex items-start justify-between gap-3 rounded-xl border border-navy/10 bg-cream px-4 py-3 text-sm text-navy">
          <span>{actionMessage}</span>
          <button type="button" onClick={() => setActionMessage(null)} className="text-navy/40 hover:text-navy">✕</button>
        </div>
      )}

      {loading && !data && (
        <div className="flex items-center justify-center py-20 text-navy/40">Loading balances…</div>
      )}

      {data && (
        <>
          {/* Carrier balance cards */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {data.balances.map((b) => {
              const color = CARRIER_COLORS[b.carrier];
              const isOpen = openCarrier === b.carrier;
              return (
                <div
                  key={b.carrier}
                  className="rounded-xl border border-navy/10 bg-white p-4 shadow-sm"
                  style={{ borderTopColor: color, borderTopWidth: 4 }}
                >
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold uppercase tracking-wide text-navy/40">
                      {CARRIER_LABELS[b.carrier]}
                    </p>
                    <span className="text-[10px] text-navy/40">{b.shipmentCount} confirmed</span>
                  </div>
                  <p className="mt-2 text-3xl font-extrabold text-navy">{fmtMoney(b.owedUSD)}</p>
                  <p className="mt-1 text-[11px] text-navy/40">
                    {b.owedUSD < 0
                      ? 'Credit balance'
                      : b.oldestUnsettledAt
                        ? `Oldest confirmed ${fmtDate(b.oldestUnsettledAt)}`
                        : 'Nothing owed'}
                  </p>

                  {/* Ledger: confirmed charges − payments made */}
                  <div className="mt-2 space-y-1 border-t border-navy/5 pt-2 text-[11px]">
                    <div className="flex items-center justify-between text-navy/60">
                      <span>Confirmed charges</span>
                      <span className="font-semibold text-navy">{fmtMoney(b.confirmedUSD)}</span>
                    </div>
                    <div className="flex items-center justify-between text-navy/60">
                      <span>Payments made</span>
                      <span className="font-semibold text-navy">−{fmtMoney(b.paidUSD)}</span>
                    </div>
                    {b.pendingCount > 0 && (
                      <p className="pt-1 text-[10px] text-navy/40">
                        {b.pendingCount} label(s) awaiting scan — not included
                      </p>
                    )}
                  </div>
                  <p className="mt-2 text-[11px] text-navy/50">
                    Last paid:{' '}
                    {b.lastSettlement
                      ? `${fmtMoney(b.lastSettlement.amountUSD)} on ${fmtDate(b.lastSettlement.paidAt)}`
                      : '—'}
                  </p>
                  {b.lastSettlement?.invoiceRef && (
                    <p className="text-[10px] text-navy/40">Ref: {b.lastSettlement.invoiceRef}</p>
                  )}
                  <button
                    type="button"
                    onClick={() => (isOpen ? setOpenCarrier(null) : openSettleFor(b.carrier, b.owedUSD))}
                    className="mt-3 w-full rounded-lg border border-navy/15 bg-cream px-2 py-1.5 text-xs font-semibold text-navy hover:bg-cream/70"
                  >
                    {isOpen ? 'Cancel' : 'Record Payment'}
                  </button>

                  {isOpen && (
                    <div className="mt-3 space-y-2 border-t border-navy/10 pt-3">
                      <label className="block text-[10px] font-semibold uppercase tracking-wider text-navy/40">
                        Amount paid (USD)
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={form.amountUSD}
                          onChange={(e) => setForm({ ...form, amountUSD: e.target.value })}
                          className="mt-1 w-full rounded-md border border-navy/15 bg-white px-2 py-1 text-sm text-navy"
                        />
                      </label>
                      <label className="block text-[10px] font-semibold uppercase tracking-wider text-navy/40">
                        Paid on
                        <input
                          type="date"
                          value={form.paidAt}
                          onChange={(e) => setForm({ ...form, paidAt: e.target.value })}
                          className="mt-1 w-full rounded-md border border-navy/15 bg-white px-2 py-1 text-sm text-navy"
                        />
                      </label>
                      <label className="block text-[10px] font-semibold uppercase tracking-wider text-navy/40">
                        Invoice reference
                        <input
                          type="text"
                          value={form.invoiceRef}
                          onChange={(e) => setForm({ ...form, invoiceRef: e.target.value })}
                          className="mt-1 w-full rounded-md border border-navy/15 bg-white px-2 py-1 text-sm text-navy"
                        />
                      </label>
                      <label className="block text-[10px] font-semibold uppercase tracking-wider text-navy/40">
                        Note
                        <textarea
                          value={form.note}
                          onChange={(e) => setForm({ ...form, note: e.target.value })}
                          rows={2}
                          className="mt-1 w-full rounded-md border border-navy/15 bg-white px-2 py-1 text-sm text-navy"
                        />
                      </label>
                      <button
                        type="button"
                        onClick={submitSettle}
                        disabled={submitting}
                        className="w-full rounded-lg bg-navy px-2 py-2 text-xs font-semibold text-white shadow-sm hover:bg-navy/90 disabled:opacity-50"
                      >
                        {submitting ? 'Saving…' : 'Save settlement'}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* USPS prepaid bonus tile */}
          {data.uspsPrepaid && (
            <div className="mt-6 rounded-xl border border-navy/10 bg-white p-4 shadow-sm" style={{ borderLeftColor: CARRIER_COLORS.usps, borderLeftWidth: 4 }}>
              <p className="text-xs font-semibold uppercase tracking-wide text-navy/40">
                USPS Prepaid Funds (EPS)
              </p>
              <p className="mt-1 text-2xl font-extrabold text-navy">
                {fmtMoney(data.uspsPrepaid.balanceUSD)}
              </p>
              <p className="text-[11px] text-navy/40">
                Live balance as of {new Date(data.uspsPrepaid.asOf).toLocaleString()}
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
