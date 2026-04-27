"use client";

import { useState, useEffect, useCallback } from 'react';
import type { ShipmentLogEntry, CarrierKey } from '../types/shipping';

type Period = 'day' | 'week' | 'month' | 'all';

interface LogResponse {
  entries: ShipmentLogEntry[];
  totalRevenue: number;
  totalShipments: number;
  byCarrier: Record<string, number>;
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
  const [period, setPeriod] = useState<Period>('day');
  const [data, setData] = useState<LogResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  useEffect(() => { fetchLog(period); }, [period, fetchLog]);

  return (
    <div className="py-8">
      {/* Header */}
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-navy">Shipping Log</h1>
          <p className="mt-1 text-sm text-navy/50">Activity summary by day, week, and month</p>
        </div>
        {/* Period tabs */}
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
      </div>

      {error && (
        <div className="mb-4 rounded-xl bg-red/10 px-4 py-3 text-sm text-red">{error}</div>
      )}

      {/* Summary cards */}
      {data && !loading && (
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
          {data.entries.length === 0 ? (
            <div className="rounded-xl border border-navy/10 bg-white p-10 text-center text-navy/40">
              No shipments for this period.
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
                      <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-navy/40">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-navy/5">
                    {data.entries.map((entry) => {
                      const dt = new Date(entry.timestamp);
                      const color = CARRIER_COLORS[entry.carrier] ?? '#ccc';
                      return (
                        <tr key={entry.id} className="transition-colors hover:bg-cream/50">
                          <td className="px-4 py-3 text-navy/60">
                            <p>{dt.toLocaleDateString()}</p>
                            <p className="text-xs text-navy/30">{dt.toLocaleTimeString()}</p>
                          </td>
                          <td className="px-4 py-3">
                            <span
                              className="inline-block rounded-full px-2 py-0.5 text-xs font-bold text-white"
                              style={{ backgroundColor: color }}
                            >
                              {CARRIER_LABELS[entry.carrier] ?? entry.carrier.toUpperCase()}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-navy">{entry.serviceName}</td>
                          <td className="px-4 py-3">
                            <p className="font-medium text-navy">{entry.customerName || '—'}</p>
                            <p className="text-xs text-navy/40">{entry.customerEmail || ''}</p>
                          </td>
                          <td className="px-4 py-3 text-navy/60">
                            {entry.originZip} → {entry.destCity ? `${entry.destCity}, ` : ''}{entry.destZip}
                          </td>
                          <td className="px-4 py-3">
                            <span className="font-mono text-xs text-navy">
                              {entry.trackingNumber || '—'}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <p className="font-bold text-navy">${entry.totalUSD.toFixed(2)}</p>
                            {entry.insuranceUSD > 0 && (
                              <p className="text-xs text-navy/40">+${entry.insuranceUSD.toFixed(2)} ins.</p>
                            )}
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

      {loading && (
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
