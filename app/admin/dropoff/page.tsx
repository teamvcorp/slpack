"use client";

import { useMemo, useRef, useState } from 'react';
import { detectCarrier, trackingUrl, DROPOFF_CARRIER_LABELS, DROPOFF_CARRIERS } from '@/lib/dropoff';
import { buildDropoffReceiptHtml } from '@/lib/receipt';
import { printHtml } from '../components/printHtml';
import type { DropoffCarrier, DropoffRecord } from '../types/dropoff';

const CARRIER_OPTIONS: DropoffCarrier[] = DROPOFF_CARRIERS;

const CARRIER_COLORS: Record<DropoffCarrier, string> = {
  fedex: '#4D148C',
  ups: '#351C15',
  usps: '#004B87',
  dhl: '#D40511',
  other: '#64748b',
};

export default function DropoffScanPage() {
  const [tracking, setTracking] = useState('');
  const [carrierOverride, setCarrierOverride] = useState<DropoffCarrier | ''>('');
  const [customerName, setCustomerName] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [emailReceipt, setEmailReceipt] = useState(true);
  const [printReceipt, setPrintReceipt] = useState(false);

  const [scans, setScans] = useState<DropoffRecord[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const trackingRef = useRef<HTMLInputElement>(null);

  const detected = useMemo(() => detectCarrier(tracking), [tracking]);
  const effectiveCarrier: DropoffCarrier = carrierOverride || detected;

  async function handleSubmit() {
    const tn = tracking.replace(/\s+/g, '').trim();
    if (!tn || submitting) return;

    setSubmitting(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch('/api/dropoff/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          trackingNumber: tn,
          carrier: effectiveCarrier,
          customerName: customerName.trim() || undefined,
          customerEmail: customerEmail.trim() || undefined,
          customerPhone: customerPhone.trim() || undefined,
          sendEmail: emailReceipt,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.record) {
        throw new Error(data.error ?? `Server error ${res.status}`);
      }

      const record = data.record as DropoffRecord;
      setScans((prev) => [record, ...prev]);
      if (printReceipt) printHtml(buildDropoffReceiptHtml(record));

      const label = DROPOFF_CARRIER_LABELS[record.carrier] ?? record.carrier;
      setMessage(
        `Logged ${label} ${record.trackingNumber}` +
          (record.receiptEmailed ? ` · emailed ${record.customerEmail}` : '')
      );

      // Reset for the next scan; keep customer info for batch drop-offs.
      setTracking('');
      setCarrierOverride('');
      trackingRef.current?.focus();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to record drop-off.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="py-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-navy">Drop-off Scan</h1>
        <p className="mt-1 text-sm text-navy/50">
          Scan a prepaid package barcode to log it and send the customer a receipt.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_380px]">
        {/* ── Scan form ─────────────────────────────────────────────────────── */}
        <div className="rounded-2xl border border-navy/10 bg-white p-6 shadow-sm">
          {/* Tracking number */}
          <label htmlFor="tracking" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-navy/50">
            Tracking number
          </label>
          <input
            id="tracking"
            ref={trackingRef}
            type="text"
            autoFocus
            autoComplete="off"
            placeholder="Scan or type barcode…"
            value={tracking}
            onChange={(e) => setTracking(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleSubmit();
              }
            }}
            className="w-full rounded-xl border border-navy/20 bg-white px-4 py-3 font-mono text-lg text-navy shadow-sm focus:border-blue focus:outline-none focus:ring-1 focus:ring-blue"
          />

          {/* Carrier */}
          <div className="mt-4">
            <label htmlFor="carrier" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-navy/50">
              Carrier
              {tracking && carrierOverride === '' && (
                <span className="ml-2 font-normal normal-case text-navy/40">
                  auto-detected: {DROPOFF_CARRIER_LABELS[detected]}
                </span>
              )}
            </label>
            <select
              id="carrier"
              value={carrierOverride || detected}
              onChange={(e) => setCarrierOverride(e.target.value as DropoffCarrier)}
              className="w-full rounded-xl border border-navy/20 bg-white px-4 py-2.5 text-sm text-navy shadow-sm focus:border-blue focus:outline-none focus:ring-1 focus:ring-blue"
            >
              {CARRIER_OPTIONS.map((c) => (
                <option key={c} value={c}>
                  {DROPOFF_CARRIER_LABELS[c]}
                </option>
              ))}
            </select>
          </div>

          {/* Customer (optional) */}
          <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label htmlFor="custName" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-navy/50">
                Customer name (optional)
              </label>
              <input
                id="custName"
                type="text"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                className="w-full rounded-lg border border-navy/20 bg-white px-3 py-2 text-sm text-navy focus:border-blue focus:outline-none focus:ring-1 focus:ring-blue"
              />
            </div>
            <div>
              <label htmlFor="custEmail" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-navy/50">
                Email (for receipt)
              </label>
              <input
                id="custEmail"
                type="email"
                inputMode="email"
                placeholder="customer@example.com"
                value={customerEmail}
                onChange={(e) => setCustomerEmail(e.target.value)}
                className="w-full rounded-lg border border-navy/20 bg-white px-3 py-2 text-sm text-navy focus:border-blue focus:outline-none focus:ring-1 focus:ring-blue"
              />
            </div>
            <div>
              <label htmlFor="custPhone" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-navy/50">
                Phone (optional)
              </label>
              <input
                id="custPhone"
                type="tel"
                inputMode="tel"
                value={customerPhone}
                onChange={(e) => setCustomerPhone(e.target.value)}
                className="w-full rounded-lg border border-navy/20 bg-white px-3 py-2 text-sm text-navy focus:border-blue focus:outline-none focus:ring-1 focus:ring-blue"
              />
            </div>
          </div>

          {/* Receipt options */}
          <div className="mt-5 flex flex-wrap items-center gap-4 rounded-xl bg-navy/5 px-4 py-3">
            <span className="text-xs font-semibold uppercase tracking-wide text-navy/50">Receipt</span>
            <label className="flex items-center gap-2 text-sm text-navy/80">
              <input
                type="checkbox"
                checked={emailReceipt}
                onChange={(e) => setEmailReceipt(e.target.checked)}
                className="h-4 w-4 rounded border-navy/30 text-blue focus:ring-blue"
              />
              Email customer
              <span className="text-[11px] text-navy/40">(preferred)</span>
            </label>
            <label className="flex items-center gap-2 text-sm text-navy/80">
              <input
                type="checkbox"
                checked={printReceipt}
                onChange={(e) => setPrintReceipt(e.target.checked)}
                className="h-4 w-4 rounded border-navy/30 text-blue focus:ring-blue"
              />
              Print
            </label>
          </div>

          {error && <p className="mt-4 rounded-lg bg-red/10 px-3 py-2 text-sm text-red">{error}</p>}
          {message && !error && (
            <p className="mt-4 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">{message}</p>
          )}

          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting || !tracking.trim()}
            className="mt-5 w-full rounded-xl bg-blue px-4 py-3 text-sm font-bold text-white shadow-sm transition-all hover:bg-navy active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {submitting ? 'Saving…' : 'Log drop-off'}
          </button>
          <p className="mt-2 text-center text-[11px] text-navy/40">
            Tip: a barcode scanner submits automatically — just keep scanning.
          </p>
        </div>

        {/* ── Session list ──────────────────────────────────────────────────── */}
        <div className="lg:sticky lg:top-6 lg:self-start">
          <div className="rounded-2xl border border-navy/10 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-navy/10 px-5 py-4">
              <h2 className="text-base font-semibold text-navy">
                This session {scans.length > 0 && <span className="text-navy/40">· {scans.length}</span>}
              </h2>
            </div>
            <div className="max-h-[60vh] overflow-y-auto px-5 py-3">
              {scans.length === 0 ? (
                <p className="py-8 text-center text-sm text-navy/40">Scanned packages appear here.</p>
              ) : (
                <ul className="space-y-3">
                  {scans.map((s) => {
                    const color = CARRIER_COLORS[s.carrier] ?? '#64748b';
                    const url = trackingUrl(s.carrier, s.trackingNumber);
                    return (
                      <li key={s.id} className="rounded-xl border border-navy/10 bg-cream p-3">
                        <div className="flex items-center justify-between">
                          <span
                            className="inline-block rounded-full px-2 py-0.5 text-[11px] font-bold text-white"
                            style={{ backgroundColor: color }}
                          >
                            {DROPOFF_CARRIER_LABELS[s.carrier]}
                          </span>
                          <span className="text-[11px] text-navy/40">
                            {new Date(s.timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                          </span>
                        </div>
                        <p className="mt-1 break-all font-mono text-sm text-navy">{s.trackingNumber}</p>
                        <div className="mt-2 flex items-center justify-between text-xs">
                          {url ? (
                            <a href={url} target="_blank" rel="noopener noreferrer" className="font-medium text-blue hover:underline">
                              Track →
                            </a>
                          ) : (
                            <span className="text-navy/30">No track link</span>
                          )}
                          <div className="flex items-center gap-2">
                            {s.receiptEmailed && <span className="text-green-700">✓ emailed</span>}
                            <button
                              type="button"
                              onClick={() => printHtml(buildDropoffReceiptHtml(s))}
                              className="rounded-md border border-navy/15 bg-white px-2 py-0.5 font-medium text-navy/70 hover:bg-cream"
                            >
                              Print
                            </button>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
