"use client";

import { useCallback, useEffect, useState } from 'react';
import { buildSaleReceiptHtml, buildShipmentReceiptHtml } from '@/lib/receipt';
import { printHtml } from './printHtml';
import { printReceipt } from './receiptPrinter';
import { renderSale } from '@/lib/eposReceipt';
import type { ReportPeriod } from '@/lib/reportPeriod';
import type { UnifiedSale, UnifiedSalesResponse } from '../types/reports';

const PERIODS: { key: ReportPeriod; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'mtd', label: 'Month to Date' },
  { key: 'ytd', label: 'Year to Date' },
];

function money(n: number): string {
  return `$${n.toFixed(2)}`;
}

export default function SalesReport() {
  const [period, setPeriod] = useState<ReportPeriod>('today');
  const [data, setData] = useState<UnifiedSalesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const fetchSales = useCallback(async (p: ReportPeriod) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/reports/sales?period=${p}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load sales');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSales(period);
  }, [period, fetchSales]);

  function handleReprint(sale: UnifiedSale) {
    if (sale.source === 'register' && sale.register) {
      // Reprint never opens the cash drawer (not a new transaction).
      const register = sale.register;
      printReceipt((p) => renderSale(p, register, { openDrawer: false }), buildSaleReceiptHtml(register));
    } else if (sale.source === 'shipping' && sale.shipment) {
      // Wide, email-style shipment receipt — stays on the browser print path.
      printHtml(buildShipmentReceiptHtml(sale.shipment));
    }
  }

  async function handleResend(sale: UnifiedSale) {
    const to =
      (sale.customerEmail || window.prompt('Email this receipt to:')?.trim()) ?? undefined;
    if (!to) return;

    setBusyId(sale.id);
    setMessage(null);
    try {
      const url = sale.source === 'register' ? '/api/register/receipt' : '/api/shipping/receipt';
      const payload = sale.source === 'register' ? { saleId: sale.id, to } : { id: sale.id, to };
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setMessage(`Receipt emailed to ${body.to}.`);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Failed to send receipt');
    } finally {
      setBusyId(null);
    }
  }

  const cash = data?.byPayment.cash;
  const card = data?.byPayment.card;

  return (
    <div>
      {/* Period selector */}
      <div className="mb-6 flex gap-1 rounded-xl border border-navy/10 bg-cream p-1 sm:w-fit">
        {PERIODS.map((p) => (
          <button
            key={p.key}
            type="button"
            onClick={() => setPeriod(p.key)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              period === p.key ? 'bg-white text-navy shadow-sm' : 'text-navy/50 hover:text-navy'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {message && (
        <div className="mb-4 flex items-start justify-between gap-3 rounded-xl border border-navy/10 bg-cream px-4 py-3 text-sm text-navy">
          <span>{message}</span>
          <button type="button" onClick={() => setMessage(null)} className="text-navy/40 hover:text-navy">✕</button>
        </div>
      )}
      {error && <div className="mb-4 rounded-xl bg-red/10 px-4 py-3 text-sm text-red">{error}</div>}

      {loading && (
        <div className="flex items-center justify-center py-20 text-navy/40">
          <svg className="mr-2 h-5 w-5 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
          </svg>
          Loading sales…
        </div>
      )}

      {data && !loading && (
        <>
          {/* Summary */}
          <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div className="rounded-xl border border-navy/10 bg-white p-4 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-wide text-navy/40">Sales</p>
              <p className="mt-1 text-3xl font-extrabold text-navy">{data.total}</p>
            </div>
            <div className="rounded-xl border border-navy/10 bg-white p-4 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-wide text-navy/40">Revenue</p>
              <p className="mt-1 text-3xl font-extrabold text-navy">{money(data.totalRevenue)}</p>
              <p className="mt-0.5 text-xs text-navy/40">incl. {money(data.totalTax)} tax</p>
            </div>
            <div className="rounded-xl border border-navy/10 bg-white p-4 shadow-sm" style={{ borderLeftColor: '#16a34a', borderLeftWidth: 4 }}>
              <p className="text-xs font-semibold uppercase tracking-wide text-navy/40">Cash</p>
              <p className="mt-1 text-3xl font-extrabold text-navy">{cash?.count ?? 0}</p>
              <p className="mt-0.5 text-xs text-navy/40">{money(cash?.revenue ?? 0)}</p>
            </div>
            <div className="rounded-xl border border-navy/10 bg-white p-4 shadow-sm" style={{ borderLeftColor: '#34aef8', borderLeftWidth: 4 }}>
              <p className="text-xs font-semibold uppercase tracking-wide text-navy/40">Card</p>
              <p className="mt-1 text-3xl font-extrabold text-navy">{card?.count ?? 0}</p>
              <p className="mt-0.5 text-xs text-navy/40">{money(card?.revenue ?? 0)}</p>
            </div>
          </div>

          {/* Table */}
          {data.entries.length === 0 ? (
            <div className="rounded-xl border border-navy/10 bg-white p-10 text-center text-navy/40">
              No sales for this period.
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-navy/10 bg-white shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-navy/10 bg-cream text-left">
                      <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-navy/40">Date/Time</th>
                      <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-navy/40">Type</th>
                      <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-navy/40">Items</th>
                      <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-navy/40">Payment</th>
                      <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-navy/40">Customer</th>
                      <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-navy/40">Total</th>
                      <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-navy/40">Receipt</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-navy/5">
                    {data.entries.map((sale) => {
                      const dt = new Date(sale.timestamp);
                      const isCash = sale.paymentMethod === 'cash';
                      const isShipping = sale.source === 'shipping';
                      const isVoided = !!sale.voided;
                      return (
                        <tr key={`${sale.source}-${sale.id}`} className={`transition-colors hover:bg-cream/50 ${isVoided ? 'bg-red/5' : ''}`}>
                          <td className="px-4 py-3 text-navy/60">
                            <p className={isVoided ? 'line-through' : ''}>{dt.toLocaleDateString()}</p>
                            <p className="text-xs text-navy/30">{dt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</p>
                          </td>
                          <td className="px-4 py-3">
                            <span
                              className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                                isShipping ? 'bg-purple-500/10 text-purple-700' : 'bg-navy/10 text-navy'
                              }`}
                            >
                              {isShipping ? 'Shipping' : 'Register'}
                            </span>
                            {isVoided && (
                              <span className="ml-1 inline-block rounded-full bg-red/10 px-2 py-0.5 text-[10px] font-bold uppercase text-red">
                                Voided
                              </span>
                            )}
                          </td>
                          <td className="max-w-xs px-4 py-3 text-navy">
                            <p className={`truncate ${isVoided ? 'line-through text-navy/40' : ''}`} title={sale.summary}>{sale.summary}</p>
                          </td>
                          <td className="px-4 py-3">
                            <span
                              className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                                isCash ? 'bg-green-500/10 text-green-700' : 'bg-blue/10 text-blue'
                              }`}
                            >
                              {isCash ? 'Cash' : 'Card'}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <p className="text-xs text-navy/60">{sale.customerName || '—'}</p>
                            <p className="text-xs text-navy/40">{sale.customerEmail || ''}</p>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <p className={`font-bold text-navy ${isVoided ? 'line-through text-navy/40' : ''}`}>{money(sale.totalUSD)}</p>
                            {sale.taxUSD > 0 && <p className="text-xs text-navy/40">+{money(sale.taxUSD)} tax</p>}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <div className="flex justify-end gap-2">
                              <button
                                type="button"
                                onClick={() => handleReprint(sale)}
                                className="rounded-lg border border-navy/15 bg-white px-2 py-1 text-xs font-medium text-navy shadow-sm transition-colors hover:bg-cream"
                                title="Reprint receipt to default printer"
                              >
                                Reprint
                              </button>
                              <button
                                type="button"
                                onClick={() => handleResend(sale)}
                                disabled={busyId === sale.id}
                                className="rounded-lg border border-navy/15 bg-white px-2 py-1 text-xs font-medium text-navy shadow-sm transition-colors hover:bg-cream disabled:opacity-50"
                                title="Email receipt to the customer"
                              >
                                {busyId === sale.id ? 'Sending…' : 'Resend'}
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
