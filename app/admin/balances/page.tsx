"use client";

import { useState, useEffect, useCallback } from 'react';
import type { CarrierBalance, CarrierKey, SettlementEntry } from '../types/shipping';

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
  return `$${n.toFixed(2)}`;
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString();
}

interface SettleForm {
  amountUSD: string;
  paidAt: string;
  periodEnd: string;
  invoiceRef: string;
  note: string;
}

const EMPTY_FORM: SettleForm = {
  amountUSD: '',
  paidAt: '',
  periodEnd: '',
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
          periodEnd: form.periodEnd ? new Date(form.periodEnd).toISOString() : undefined,
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
            Estimated amount owed to each carrier since the last recorded payment.
          </p>
        </div>
        <button
          type="button"
          onClick={refresh}
          className="rounded-xl border border-navy/15 bg-white px-3 py-1.5 text-sm font-medium text-navy shadow-sm hover:bg-cream"
        >
          Refresh
        </button>
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
                    <span className="text-[10px] text-navy/40">{b.shipmentCount} shipments</span>
                  </div>
                  <p className="mt-2 text-3xl font-extrabold text-navy">{fmtMoney(b.owedUSD)}</p>
                  <p className="mt-1 text-[11px] text-navy/40">
                    {b.oldestUnsettledAt
                      ? `Since ${fmtDate(b.oldestUnsettledAt)}`
                      : 'Nothing unsettled'}
                  </p>
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
                        Invoice covers shipments through (optional)
                        <input
                          type="date"
                          value={form.periodEnd}
                          onChange={(e) => setForm({ ...form, periodEnd: e.target.value })}
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
