"use client";

import { useCallback, useEffect, useState } from 'react';
import { DROPOFF_CARRIER_LABELS, trackingUrl } from '@/lib/dropoff';
import { buildDropoffReportHtml } from '@/lib/receipt';
import { printHtml } from './printHtml';
import type { DropoffPeriod, DropoffRecord, DropoffCarrier } from '../types/dropoff';

interface ReportResponse {
  period: DropoffPeriod;
  entries: DropoffRecord[];
  total: number;
  byCarrier: Record<string, number>;
}

const PERIODS: { key: DropoffPeriod; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'mtd', label: 'Month to Date' },
  { key: 'ytd', label: 'Year to Date' },
];

const CARRIER_COLORS: Record<DropoffCarrier, string> = {
  fedex: '#4D148C',
  ups: '#351C15',
  usps: '#004B87',
  dhl: '#D40511',
  other: '#64748b',
};

export default function DropoffReport() {
  const [period, setPeriod] = useState<DropoffPeriod>('mtd');
  const [data, setData] = useState<ReportResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [emailTo, setEmailTo] = useState('');
  const [emailing, setEmailing] = useState(false);
  const [emailMsg, setEmailMsg] = useState<string | null>(null);

  const fetchReport = useCallback(async (p: DropoffPeriod) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/dropoff/report?period=${p}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load report');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchReport(period);
  }, [period, fetchReport]);

  function handlePrint() {
    if (!data) return;
    printHtml(buildDropoffReportHtml(data.entries, data.period, data.byCarrier));
  }

  async function handleEmail() {
    if (!emailTo.trim() || emailing) return;
    setEmailing(true);
    setEmailMsg(null);
    try {
      const res = await fetch('/api/dropoff/report/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ period, to: emailTo.trim() }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setEmailMsg(`Report emailed to ${emailTo.trim()} (${body.total} packages).`);
    } catch (e) {
      setEmailMsg(e instanceof Error ? e.message : 'Failed to email report');
    } finally {
      setEmailing(false);
    }
  }

  return (
    <div>
      {/* Controls */}
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-1 rounded-xl border border-navy/10 bg-cream p-1">
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

        <div className="flex flex-wrap items-center gap-2">
          <input
            type="email"
            inputMode="email"
            placeholder="Email report to…"
            value={emailTo}
            onChange={(e) => setEmailTo(e.target.value)}
            className="rounded-xl border border-navy/10 bg-white px-3 py-2 text-sm text-navy placeholder-navy/30 shadow-sm outline-none focus:border-navy/30 focus:ring-1 focus:ring-navy/20 sm:w-56"
          />
          <button
            type="button"
            onClick={handleEmail}
            disabled={emailing || !emailTo.trim()}
            className="rounded-xl bg-blue px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-navy disabled:opacity-40"
          >
            {emailing ? 'Sending…' : 'Email report'}
          </button>
          <button
            type="button"
            onClick={handlePrint}
            disabled={!data}
            className="rounded-xl border border-navy/20 px-4 py-2 text-sm font-medium text-navy/70 shadow-sm transition-colors hover:bg-cream disabled:opacity-40"
          >
            🖨 Print
          </button>
        </div>
      </div>

      {emailMsg && (
        <div className="mb-4 rounded-xl border border-navy/10 bg-cream px-4 py-3 text-sm text-navy">{emailMsg}</div>
      )}
      {error && <div className="mb-4 rounded-xl bg-red/10 px-4 py-3 text-sm text-red">{error}</div>}

      {loading && (
        <div className="flex items-center justify-center py-20 text-navy/40">
          <svg className="mr-2 h-5 w-5 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
          </svg>
          Loading report…
        </div>
      )}

      {data && !loading && (
        <>
          {/* Summary */}
          <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div className="rounded-xl border border-navy/10 bg-white p-4 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-wide text-navy/40">Packages</p>
              <p className="mt-1 text-3xl font-extrabold text-navy">{data.total}</p>
            </div>
            {(Object.entries(data.byCarrier) as [DropoffCarrier, number][]).map(([c, count]) => (
              <div
                key={c}
                className="rounded-xl border border-navy/10 bg-white p-4 shadow-sm"
                style={{ borderLeftColor: CARRIER_COLORS[c] ?? '#ccc', borderLeftWidth: 4 }}
              >
                <p className="text-xs font-semibold uppercase tracking-wide text-navy/40">
                  {DROPOFF_CARRIER_LABELS[c] ?? c}
                </p>
                <p className="mt-1 text-3xl font-extrabold text-navy">{count}</p>
              </div>
            ))}
          </div>

          {/* Table */}
          {data.entries.length === 0 ? (
            <div className="rounded-xl border border-navy/10 bg-white p-10 text-center text-navy/40">
              No drop-offs for this period.
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-navy/10 bg-white shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-navy/10 bg-cream text-left">
                      <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-navy/40">Date/Time</th>
                      <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-navy/40">Carrier</th>
                      <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-navy/40">Tracking</th>
                      <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-navy/40">Customer</th>
                      <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-navy/40">Track</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-navy/5">
                    {data.entries.map((e) => {
                      const dt = new Date(e.timestamp);
                      const color = CARRIER_COLORS[e.carrier] ?? '#ccc';
                      const url = trackingUrl(e.carrier, e.trackingNumber);
                      return (
                        <tr key={e.id} className="transition-colors hover:bg-cream/50">
                          <td className="px-4 py-3 text-navy/60">
                            <p>{dt.toLocaleDateString()}</p>
                            <p className="text-xs text-navy/30">{dt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</p>
                          </td>
                          <td className="px-4 py-3">
                            <span className="inline-block rounded-full px-2 py-0.5 text-xs font-bold text-white" style={{ backgroundColor: color }}>
                              {DROPOFF_CARRIER_LABELS[e.carrier] ?? e.carrier}
                            </span>
                          </td>
                          <td className="px-4 py-3 font-mono text-xs text-navy">{e.trackingNumber}</td>
                          <td className="px-4 py-3">
                            <p className="text-navy">{e.customerName || '—'}</p>
                            <p className="text-xs text-navy/40">{e.customerEmail || ''}</p>
                          </td>
                          <td className="px-4 py-3 text-right">
                            {url ? (
                              <a href={url} target="_blank" rel="noopener noreferrer" className="text-xs font-medium text-blue hover:underline">
                                Track →
                              </a>
                            ) : (
                              <span className="text-xs text-navy/30">—</span>
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
    </div>
  );
}
