"use client";

import { useState, useEffect, useCallback, Fragment } from 'react';
import DropoffReport from '../components/DropoffReport';
import SalesReport from '../components/SalesReport';
import type { ShipmentLogEntry, CarrierKey, ErrorLogEntry } from '../types/shipping';

type Period = 'day' | 'week' | 'month' | 'all';
type Tab = 'shipments' | 'sales' | 'dropoffs' | 'errors';

const TAB_LABELS: Record<Tab, string> = {
  shipments: 'Shipments',
  sales: 'Sales',
  dropoffs: 'Drop-offs',
  errors: 'Errors',
};

/** Tabs that render a self-contained report component (own data + period). */
const SELF_FETCHING: Tab[] = ['sales', 'dropoffs'];

interface LogResponse {
  entries: ShipmentLogEntry[];
  totalRevenue: number;
  totalShipments: number;
  byCarrier: Record<string, number>;
}

interface ErrorsResponse {
  entries: ErrorLogEntry[];
  total: number;
  byRoute: Record<string, number>;
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

const PERIODS: { key: Period; label: string }[] = [
  { key: 'day', label: 'Today' },
  { key: 'week', label: 'This Week' },
  { key: 'month', label: 'This Month' },
  { key: 'all', label: 'All Time' },
];

export default function ShipmentLogPage() {
  const [tab, setTab] = useState<Tab>('shipments');
  const [period, setPeriod] = useState<Period>('day');
  const [data, setData] = useState<LogResponse | null>(null);
  const [errorsData, setErrorsData] = useState<ErrorsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [expandedErrorId, setExpandedErrorId] = useState<string | null>(null);
  const [voidingId, setVoidingId] = useState<string | null>(null);
  const [tenderingId, setTenderingId] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const fetchLog = useCallback(async (p: Period) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/shipping/log?period=${p}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load log');
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchErrors = useCallback(async (p: Period) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/shipping/errors?period=${p}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setErrorsData(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load errors');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tab === 'shipments') fetchLog(period);
    else if (tab === 'errors') fetchErrors(period);
    else setLoading(false); // sales/drop-offs tabs self-fetch in their components
  }, [tab, period, fetchLog, fetchErrors]);

  const handlePrintLabel = useCallback((id: string) => {
    window.open(`/api/shipping/label/${encodeURIComponent(id)}`, '_blank', 'noopener');
  }, []);

  const handleMarkTendered = useCallback(
    async (id: string) => {
      if (!window.confirm('Mark this shipment as tendered to the carrier?')) return;
      setTenderingId(id);
      setActionMessage(null);
      try {
        const res = await fetch('/api/shipping/tracking/mark-tendered', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id }),
        });
        const body: { ok?: boolean; error?: string } = await res.json().catch(() => ({}));
        if (!res.ok || !body.ok) {
          setActionMessage(body.error ?? `Failed (HTTP ${res.status})`);
          return;
        }
        setActionMessage('Marked as tendered.');
        await fetchLog(period);
      } catch (e) {
        setActionMessage(e instanceof Error ? e.message : 'Failed');
      } finally {
        setTenderingId(null);
      }
    },
    [fetchLog, period]
  );

  const handleVoid = useCallback(
    async (id: string, trackingNumber: string | null) => {
      const reason = window.prompt(
        `Void shipment ${trackingNumber ?? id}?\n\nThis will attempt to cancel the label with the carrier and mark the shipment as voided in the log. Enter a reason:`
      );
      if (reason === null) return;

      setVoidingId(id);
      setActionMessage(null);
      try {
        let res = await fetch('/api/shipping/void', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, reason }),
        });
        let data: { ok?: boolean; voidCarrierStatus?: string; voidCarrierMessage?: string; error?: string } =
          await res.json().catch(() => ({}));

        // Carrier-side cancel failed — offer to force-mark as voided in DB only.
        if (!res.ok && data?.error?.toLowerCase().includes('carrier cancel failed')) {
          const force = window.confirm(
            `${data.error}\n\nMark voided in the log anyway? (You will need to cancel/refund with the carrier manually.)`
          );
          if (!force) {
            setActionMessage(data.error);
            return;
          }
          res = await fetch('/api/shipping/void', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id, reason, force: true }),
          });
          data = await res.json().catch(() => ({}));
        }

        if (!res.ok) {
          setActionMessage(data?.error ?? `Failed (HTTP ${res.status})`);
          return;
        }
        setActionMessage(
          `Shipment voided. Carrier: ${data.voidCarrierStatus ?? 'n/a'}${
            data.voidCarrierMessage ? ` — ${data.voidCarrierMessage}` : ''
          }`
        );
        await fetchLog(period);
      } catch (e) {
        setActionMessage(e instanceof Error ? e.message : 'Void failed');
      } finally {
        setVoidingId(null);
      }
    },
    [fetchLog, period]
  );

  return (
    <div className="py-8">
      {/* Header */}
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-navy">
            {tab === 'shipments'
              ? 'Shipping Log'
              : tab === 'sales'
                ? 'Register Sales'
                : tab === 'dropoffs'
                  ? 'Drop-off Report'
                  : 'Error Log'}
          </h1>
          <p className="mt-1 text-sm text-navy/50">
            {tab === 'shipments'
              ? 'Activity summary by day, week, and month'
              : tab === 'sales'
                ? 'Register sales with receipt reprint & resend — today, month to date, year to date'
                : tab === 'dropoffs'
                  ? 'Scanned drop-off packages — today, month to date, year to date'
                  : 'Server-side API errors captured from /api/shipping/*'}
          </p>
        </div>
        {/* Tab switcher */}
        <div className="flex gap-1 rounded-xl border border-navy/10 bg-cream p-1">
          {(['shipments', 'sales', 'dropoffs', 'errors'] as Tab[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => { setTab(t); setSearch(''); }}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                tab === t
                  ? 'bg-white text-navy shadow-sm'
                  : 'text-navy/50 hover:text-navy'
              }`}
            >
              {TAB_LABELS[t]}
            </button>
          ))}
        </div>
        {/* Search (shipments tab only) */}
        {tab === 'shipments' && (
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search customer, tracking, carrier…"
            className="rounded-xl border border-navy/10 bg-white px-4 py-2 text-sm text-navy placeholder-navy/30 shadow-sm outline-none focus:border-navy/30 focus:ring-1 focus:ring-navy/20 sm:w-64"
          />
        )}
        {/* Period tabs — sales/drop-offs tabs manage their own period internally */}
        {!SELF_FETCHING.includes(tab) && (
        <div className="flex gap-1 rounded-xl border border-navy/10 bg-cream p-1">
          {PERIODS.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => setPeriod(p.key)}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                period === p.key
                  ? 'bg-white text-navy shadow-sm'
                  : 'text-navy/50 hover:text-navy'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        )}
      </div>

      {error && (
        <div className="mb-4 rounded-xl bg-red/10 px-4 py-3 text-sm text-red">{error}</div>
      )}
      {actionMessage && (
        <div className="mb-4 flex items-start justify-between gap-3 rounded-xl border border-navy/10 bg-cream px-4 py-3 text-sm text-navy">
          <span>{actionMessage}</span>
          <button
            type="button"
            onClick={() => setActionMessage(null)}
            className="text-navy/40 hover:text-navy"
          >
            ✕
          </button>
        </div>
      )}

      {/* Summary cards */}
      {tab === 'shipments' && data && !loading && (
        <>
          <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div className="rounded-xl border border-navy/10 bg-white p-4 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-wide text-navy/40">Shipments</p>
              <p className="mt-1 text-3xl font-extrabold text-navy">{data.totalShipments}</p>
            </div>
            <div className="rounded-xl border border-navy/10 bg-white p-4 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-wide text-navy/40">Revenue</p>
              <p className="mt-1 text-3xl font-extrabold text-navy">
                ${data.totalRevenue.toFixed(2)}
              </p>
            </div>
            {(Object.entries(data.byCarrier) as [CarrierKey, number][]).map(([c, count]) => (
              <div
                key={c}
                className="rounded-xl border border-navy/10 bg-white p-4 shadow-sm"
                style={{ borderLeftColor: CARRIER_COLORS[c] ?? '#ccc', borderLeftWidth: 4 }}
              >
                <p className="text-xs font-semibold uppercase tracking-wide text-navy/40">
                  {CARRIER_LABELS[c] ?? c}
                </p>
                <p className="mt-1 text-3xl font-extrabold text-navy">{count}</p>
              </div>
            ))}
          </div>

          {/* Entries table */}
          {(() => {
            const q = search.trim().toLowerCase();
            const filtered = q
              ? data.entries.filter((e) =>
                  (e.customerName ?? '').toLowerCase().includes(q) ||
                  (e.customerEmail ?? '').toLowerCase().includes(q) ||
                  (e.trackingNumber ?? '').toLowerCase().includes(q) ||
                  (e.carrier ?? '').toLowerCase().includes(q) ||
                  (CARRIER_LABELS[e.carrier] ?? '').toLowerCase().includes(q) ||
                  (e.serviceName ?? '').toLowerCase().includes(q) ||
                  (e.destCity ?? '').toLowerCase().includes(q) ||
                  String(e.destZip ?? '').includes(q)
                )
              : data.entries;
            return filtered.length === 0 ? (
              <div className="rounded-xl border border-navy/10 bg-white p-10 text-center text-navy/40">
                {search ? `No results for "${search}".` : 'No shipments for this period.'}
              </div>
            ) : (
            <div className="overflow-hidden rounded-xl border border-navy/10 bg-white shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-navy/10 bg-cream text-left">
                      <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-navy/40">Date/Time</th>
                      <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-navy/40">Carrier</th>
                      <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-navy/40">Service</th>
                      <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-navy/40">Customer</th>
                      <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-navy/40">Route</th>
                      <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-navy/40">Tracking</th>
                      <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-navy/40">Status</th>
                      <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-navy/40">Total</th>
                      <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-navy/40">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-navy/5">
                    {filtered.map((entry) => {
                      const dt = new Date(entry.timestamp);
                      const color = CARRIER_COLORS[entry.carrier] ?? '#ccc';
                      const isVoided = !!entry.voided;
                      const isVoiding = voidingId === entry.id;
                      return (
                        <tr
                          key={entry.id}
                          className={`transition-colors hover:bg-cream/50 ${isVoided ? 'bg-red/5 text-navy/40' : ''}`}
                        >
                          <td className={`px-4 py-3 ${isVoided ? 'text-navy/40' : 'text-navy/60'}`}>
                            <p className={isVoided ? 'line-through' : ''}>{dt.toLocaleDateString()}</p>
                            <p className="text-xs text-navy/30">{dt.toLocaleTimeString()}</p>
                          </td>
                          <td className="px-4 py-3">
                            <span
                              className="inline-block rounded-full px-2 py-0.5 text-xs font-bold text-white"
                              style={{ backgroundColor: color, opacity: isVoided ? 0.5 : 1 }}
                            >
                              {CARRIER_LABELS[entry.carrier] ?? entry.carrier.toUpperCase()}
                            </span>
                            {isVoided && (
                              <span className="ml-2 inline-block rounded-full bg-red/10 px-2 py-0.5 text-[10px] font-bold uppercase text-red">
                                Voided
                              </span>
                            )}
                          </td>
                          <td className={`px-4 py-3 ${isVoided ? 'text-navy/40 line-through' : 'text-navy'}`}>{entry.serviceName}</td>
                          <td className="px-4 py-3">
                            <p className={`font-medium ${isVoided ? 'text-navy/40 line-through' : 'text-navy'}`}>{entry.customerName || '—'}</p>
                            <p className="text-xs text-navy/40">{entry.customerEmail || ''}</p>
                          </td>
                          <td className={`px-4 py-3 ${isVoided ? 'text-navy/30' : 'text-navy/60'}`}>
                            {entry.originZip} → {entry.destCity ? `${entry.destCity}, ` : ''}{entry.destZip}
                          </td>
                          <td className="px-4 py-3">
                            <span className={`font-mono text-xs ${isVoided ? 'text-navy/40 line-through' : 'text-navy'}`}>
                              {entry.trackingNumber || '—'}
                            </span>
                            {isVoided && entry.voidReason && (
                              <p className="mt-1 text-[10px] text-red/80" title={entry.voidReason}>
                                {entry.voidReason.length > 40 ? `${entry.voidReason.slice(0, 40)}…` : entry.voidReason}
                              </p>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            {isVoided ? (
                              <span className="inline-block rounded-full bg-red/10 px-2 py-0.5 text-[10px] font-bold uppercase text-red">Voided</span>
                            ) : entry.accepted ? (
                              <span
                                className="inline-block rounded-full bg-green-500/10 px-2 py-0.5 text-[10px] font-bold uppercase text-green-700"
                                title={`Accepted ${entry.acceptedAt ? new Date(entry.acceptedAt).toLocaleString() : ''} via ${entry.acceptedSource ?? 'tracking'}`}
                              >
                                Accepted
                              </span>
                            ) : (
                              <span className="inline-block rounded-full bg-tan/30 px-2 py-0.5 text-[10px] font-bold uppercase text-navy/70">
                                Pending
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <p className={`font-bold ${isVoided ? 'text-navy/40 line-through' : 'text-navy'}`}>${entry.totalUSD.toFixed(2)}</p>
                            {entry.insuranceUSD > 0 && (
                              <p className="text-xs text-navy/40">+${entry.insuranceUSD.toFixed(2)} ins.</p>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <div className="flex justify-end gap-2">
                              <button
                                type="button"
                                onClick={() => handlePrintLabel(entry.id)}
                                disabled={!entry.labelBase64}
                                className="rounded-lg border border-navy/15 bg-white px-2 py-1 text-xs font-medium text-navy shadow-sm transition-colors hover:bg-cream disabled:cursor-not-allowed disabled:text-navy/30"
                                title={entry.labelBase64 ? 'Open label in new tab to reprint' : 'No stored label'}
                              >
                                Print
                              </button>
                              {!isVoided && !entry.accepted && (
                                <button
                                  type="button"
                                  onClick={() => handleMarkTendered(entry.id)}
                                  disabled={tenderingId === entry.id}
                                  className="rounded-lg border border-navy/15 bg-white px-2 py-1 text-xs font-medium text-navy shadow-sm transition-colors hover:bg-cream disabled:opacity-50"
                                  title="Manually mark as tendered to carrier"
                                >
                                  {tenderingId === entry.id ? 'Saving…' : 'Tender'}
                                </button>
                              )}
                              {!isVoided && (
                                <button
                                  type="button"
                                  onClick={() => handleVoid(entry.id, entry.trackingNumber)}
                                  disabled={isVoiding}
                                  className="rounded-lg border border-red/30 bg-white px-2 py-1 text-xs font-medium text-red shadow-sm transition-colors hover:bg-red/5 disabled:opacity-50"
                                >
                                  {isVoiding ? 'Voiding…' : 'Void'}
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
            );
          })()}
        </>
      )}

      {/* Errors tab content */}
      {tab === 'errors' && errorsData && !loading && (
        <>
          <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div className="rounded-xl border border-navy/10 bg-white p-4 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-wide text-navy/40">Errors</p>
              <p className="mt-1 text-3xl font-extrabold text-navy">{errorsData.total}</p>
            </div>
            {Object.entries(errorsData.byRoute).slice(0, 3).map(([route, count]) => (
              <div key={route} className="rounded-xl border border-navy/10 bg-white p-4 shadow-sm" style={{ borderLeftColor: '#D40511', borderLeftWidth: 4 }}>
                <p className="truncate text-xs font-semibold uppercase tracking-wide text-navy/40">{route}</p>
                <p className="mt-1 text-3xl font-extrabold text-navy">{count}</p>
              </div>
            ))}
          </div>

          {errorsData.entries.length === 0 ? (
            <div className="rounded-xl border border-navy/10 bg-white p-10 text-center text-navy/40">
              No errors recorded for this period.
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-navy/10 bg-white shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-navy/10 bg-cream text-left">
                      <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-navy/40">Time</th>
                      <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-navy/40">Route</th>
                      <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-navy/40">Carrier</th>
                      <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-navy/40">Status</th>
                      <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-navy/40">Upstream</th>
                      <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-navy/40">Message</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-navy/5">
                    {errorsData.entries.map((entry) => {
                      const dt = new Date(entry.timestamp);
                      const isOpen = expandedErrorId === entry.id;
                      return (
                        <Fragment key={entry.id}>
                          <tr
                            className="cursor-pointer transition-colors hover:bg-cream/50"
                            onClick={() => setExpandedErrorId(isOpen ? null : entry.id)}
                          >
                            <td className="px-4 py-3 text-navy/60">
                              <p>{dt.toLocaleDateString()}</p>
                              <p className="text-xs text-navy/30">{dt.toLocaleTimeString()}</p>
                            </td>
                            <td className="px-4 py-3 font-mono text-xs text-navy">{entry.route}</td>
                            <td className="px-4 py-3 text-navy/60">{entry.carrier ?? '—'}</td>
                            <td className="px-4 py-3">
                              <span className="inline-block rounded-full bg-red/10 px-2 py-0.5 text-xs font-bold text-red">
                                {entry.status}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-navy/60">{entry.upstreamStatus ?? '—'}</td>
                            <td className="px-4 py-3 text-navy">{entry.message}</td>
                          </tr>
                          {isOpen && (entry.upstreamBody || entry.requestSummary || entry.stack) && (
                            <tr key={`${entry.id}-detail`} className="bg-cream/30">
                              <td colSpan={6} className="px-4 py-3">
                                {entry.requestSummary && (
                                  <div className="mb-3">
                                    <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-navy/40">Request summary</p>
                                    <pre className="max-h-48 overflow-auto rounded bg-white p-2 text-xs text-navy/80">{JSON.stringify(entry.requestSummary, null, 2)}</pre>
                                  </div>
                                )}
                                {entry.upstreamBody && (
                                  <div className="mb-3">
                                    <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-navy/40">Upstream body</p>
                                    <pre className="max-h-64 overflow-auto rounded bg-white p-2 text-xs text-navy/80">{entry.upstreamBody}</pre>
                                  </div>
                                )}
                                {entry.stack && (
                                  <div>
                                    <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-navy/40">Stack</p>
                                    <pre className="max-h-48 overflow-auto rounded bg-white p-2 text-xs text-navy/60">{entry.stack}</pre>
                                  </div>
                                )}
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {/* Self-contained report tabs */}
      {tab === 'sales' && <SalesReport />}
      {tab === 'dropoffs' && <DropoffReport />}

      {loading && !SELF_FETCHING.includes(tab) && (
        <div className="flex items-center justify-center py-20 text-navy/40">
          <svg className="mr-2 h-5 w-5 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
          </svg>
          Loading log…
        </div>
      )}
    </div>
  );
}
