"use client";

import { useState } from 'react';
import type { ShipmentInput } from '../types/shipping';

interface Props {
  onSubmit: (data: ShipmentInput) => void;
  loading: boolean;
}

interface AddressResult {
  valid: boolean;
  status: string;
  suggested: { streetLine: string; city: string; state: string; zip: string; country: string } | null;
  messages: string[];
}

const DEFAULTS: ShipmentInput = {
  originZip: '50588',
  originCountry: 'US',
  destZip: '',
  destCity: '',
  destState: '',
  destCountry: 'US',
  weightLbs: 2,
  lengthIn: 12,
  widthIn: 9,
  heightIn: 6,
  declaredValueUSD: 0,
  customerName: '',
  customerEmail: '',
};

const COUNTRIES = [
  { code: 'US', label: 'United States' },
  { code: 'CA', label: 'Canada' },
  { code: 'MX', label: 'Mexico' },
  { code: 'GB', label: 'United Kingdom' },
  { code: 'DE', label: 'Germany' },
  { code: 'FR', label: 'France' },
  { code: 'AU', label: 'Australia' },
  { code: 'JP', label: 'Japan' },
  { code: 'CN', label: 'China' },
  { code: 'IN', label: 'India' },
];

export default function ShipmentForm({ onSubmit, loading }: Props) {
  const [form, setForm] = useState<ShipmentInput>(DEFAULTS);
  const [validating, setValidating] = useState(false);
  const [addrResult, setAddrResult] = useState<AddressResult | null>(null);
  const [addrError, setAddrError] = useState<string | null>(null);

  function set<K extends keyof ShipmentInput>(key: K, value: ShipmentInput[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    // Clear validation result if address fields change
    if (['destZip', 'destCity', 'destState', 'destCountry'].includes(key as string)) {
      setAddrResult(null);
      setAddrError(null);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSubmit(form);
  }

  async function handleValidateAddress() {
    if (!form.destZip) return;
    setValidating(true);
    setAddrResult(null);
    setAddrError(null);
    try {
      const res = await fetch('/api/shipping/fedex/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          city: form.destCity,
          state: form.destState,
          zip: form.destZip,
          country: form.destCountry,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        setAddrError(data.error ?? `Validation error (${res.status})`);
      } else {
        setAddrResult(data as AddressResult);
      }
    } catch (err) {
      setAddrError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setValidating(false);
    }
  }

  function applysuggested() {
    if (!addrResult?.suggested) return;
    const s = addrResult.suggested;
    setForm((prev) => ({
      ...prev,
      destCity: s.city || prev.destCity,
      destState: s.state || prev.destState,
      destZip: s.zip || prev.destZip,
      destCountry: s.country || prev.destCountry,
    }));
    setAddrResult(null);
  }

  const input =
    'w-full rounded-lg border border-navy/20 bg-white px-3 py-2 text-sm text-navy placeholder-navy/30 focus:border-blue focus:outline-none focus:ring-1 focus:ring-blue';
  const lbl = 'mb-1 block text-[11px] font-semibold uppercase tracking-wide text-navy/50';

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-xl border border-navy/10 bg-white p-5 shadow-sm"
    >
      <h2 className="mb-4 text-sm font-bold uppercase tracking-wider text-navy">
        Package &amp; Shipment Details
      </h2>

      {/* â”€â”€ Row 1: Address fields â”€â”€ */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <div>
          <label className={lbl}>Origin ZIP</label>
          <input
            className={input}
            value={form.originZip}
            onChange={(e) => set('originZip', e.target.value)}
            maxLength={10}
            placeholder="50588"
            required
          />
        </div>

        <div>
          <label className={lbl}>Dest ZIP</label>
          <input
            className={input}
            value={form.destZip}
            onChange={(e) => set('destZip', e.target.value)}
            maxLength={10}
            placeholder="90210"
            required
          />
        </div>

        <div>
          <label className={lbl}>Dest City</label>
          <input
            className={input}
            value={form.destCity}
            onChange={(e) => set('destCity', e.target.value)}
            maxLength={60}
            placeholder="Beverly Hills"
          />
        </div>

        <div>
          <label className={lbl}>Dest State</label>
          <input
            className={input}
            value={form.destState}
            onChange={(e) => set('destState', e.target.value.toUpperCase())}
            maxLength={3}
            placeholder="CA"
          />
        </div>

        <div>
          <label className={lbl}>Country</label>
          <select
            className={input}
            value={form.destCountry}
            onChange={(e) => set('destCountry', e.target.value)}
          >
            {COUNTRIES.map((c) => (
              <option key={c.code} value={c.code}>{c.label}</option>
            ))}
          </select>
        </div>

        {/* Validate address button in the 6th column */}
        <div className="flex flex-col justify-end">
          <label className={lbl}>Address Check</label>
          <button
            type="button"
            onClick={handleValidateAddress}
            disabled={validating || !form.destZip}
            className="flex items-center justify-center gap-1.5 rounded-lg border border-navy/20 px-3 py-2 text-sm font-medium text-navy/70 transition-colors hover:bg-cream disabled:opacity-40"
          >
            {validating ? (
              <>
                <svg className="h-3.5 w-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
                Checkingâ€¦
              </>
            ) : (
              <>âœ” Validate</>
            )}
          </button>
        </div>
      </div>

      {/* Address validation result banner */}
      {addrError && (
        <div className="mt-2 rounded-lg bg-red/10 px-3 py-2 text-xs text-red">
          Address validation unavailable: {addrError}
        </div>
      )}
      {addrResult && (
        <div
          className={`mt-2 rounded-lg px-4 py-3 text-xs ${
            addrResult.valid
              ? 'border border-green-200 bg-green-50'
              : 'border border-yellow-200 bg-yellow-50'
          }`}
        >
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className={`font-semibold ${addrResult.valid ? 'text-green-700' : 'text-yellow-700'}`}>
                {addrResult.valid ? 'âœ” Address validated by FedEx' : 'âš  Address could not be fully validated'}
              </p>
              {addrResult.messages.map((m, i) => (
                <p key={i} className="mt-0.5 text-yellow-700">{m}</p>
              ))}
              {addrResult.suggested && (
                <p className="mt-1 text-navy/60">
                  Suggested:{' '}
                  <span className="font-medium text-navy">
                    {[addrResult.suggested.city, addrResult.suggested.state, addrResult.suggested.zip]
                      .filter(Boolean)
                      .join(', ')}
                  </span>
                </p>
              )}
            </div>
            {addrResult.suggested && (
              <button
                type="button"
                onClick={applysuggested}
                className="shrink-0 rounded-lg border border-navy/20 bg-white px-2 py-1 text-[11px] font-semibold text-navy/70 hover:bg-cream"
              >
                Apply
              </button>
            )}
          </div>
        </div>
      )}

      {/* â”€â”€ Row 2: Package dimensions â”€â”€ */}
      <div className="mt-3 grid grid-cols-3 gap-3 sm:grid-cols-6">
        <div>
          <label className={lbl}>Weight (lbs)</label>
          <input
            className={input}
            type="number"
            min="0.1"
            step="0.1"
            value={form.weightLbs}
            onChange={(e) => set('weightLbs', parseFloat(e.target.value) || 0)}
            required
          />
        </div>
        <div>
          <label className={lbl}>Length (in)</label>
          <input
            className={input}
            type="number"
            min="1"
            step="0.5"
            value={form.lengthIn}
            onChange={(e) => set('lengthIn', parseFloat(e.target.value) || 0)}
            required
          />
        </div>
        <div>
          <label className={lbl}>Width (in)</label>
          <input
            className={input}
            type="number"
            min="1"
            step="0.5"
            value={form.widthIn}
            onChange={(e) => set('widthIn', parseFloat(e.target.value) || 0)}
            required
          />
        </div>
        <div>
          <label className={lbl}>Height (in)</label>
          <input
            className={input}
            type="number"
            min="1"
            step="0.5"
            value={form.heightIn}
            onChange={(e) => set('heightIn', parseFloat(e.target.value) || 0)}
            required
          />
        </div>
        <div>
          <label className={lbl}>Value ($)</label>
          <input
            className={input}
            type="number"
            min="0"
            step="0.01"
            value={form.declaredValueUSD}
            onChange={(e) => set('declaredValueUSD', parseFloat(e.target.value) || 0)}
          />
        </div>
      </div>

      {/* â”€â”€ Row 3: Customer info â”€â”€ */}
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className={lbl}>Customer Name</label>
          <input
            className={input}
            value={form.customerName}
            onChange={(e) => set('customerName', e.target.value)}
            maxLength={100}
            placeholder="Jane Smith"
          />
        </div>
        <div>
          <label className={lbl}>Customer Email</label>
          <input
            className={input}
            type="email"
            value={form.customerEmail}
            onChange={(e) => set('customerEmail', e.target.value)}
            maxLength={200}
            placeholder="jane@example.com"
          />
        </div>
      </div>

      <div className="mt-4 flex items-center gap-4">
        <button
          type="submit"
          disabled={loading}
          className="rounded-lg bg-blue px-7 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-navy active:scale-95 disabled:opacity-50"
        >
          {loading ? (
            <span className="flex items-center gap-2">
              <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
              Fetching Ratesâ€¦
            </span>
          ) : (
            'Compare All Carriers'
          )}
        </button>
        <p className="text-xs text-navy/40">
          Queries FedEx, UPS, USPS, and DHL simultaneously
        </p>
      </div>
    </form>
  );
}
