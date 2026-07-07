"use client";

import { useState } from 'react';
import type { ShipmentInput } from '../../types/shipping';

/**
 * International shipment form. A focused clone of the domestic ShipmentForm —
 * kept SEPARATE so nothing here can affect domestic shipping. Differences:
 *  - Destination country defaults to Mexico and is limited to non-US countries.
 *  - State/province and postal fields are relaxed (not US-shaped).
 *  - Sender (exporter) contact is required — needed on the commercial invoice.
 *  - No US-only ZIP autofill; FedEx address validation still works cross-border.
 */

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

// Destination countries — Mexico + South America first (the primary lanes),
// then other common international destinations. Never 'US' (that's domestic).
const COUNTRIES = [
  { code: 'MX', label: 'Mexico' },
  { code: 'BR', label: 'Brazil' },
  { code: 'CO', label: 'Colombia' },
  { code: 'AR', label: 'Argentina' },
  { code: 'CL', label: 'Chile' },
  { code: 'PE', label: 'Peru' },
  { code: 'EC', label: 'Ecuador' },
  { code: 'BO', label: 'Bolivia' },
  { code: 'PY', label: 'Paraguay' },
  { code: 'UY', label: 'Uruguay' },
  { code: 'VE', label: 'Venezuela' },
  { code: 'CA', label: 'Canada' },
  { code: 'GB', label: 'United Kingdom' },
  { code: 'DE', label: 'Germany' },
  { code: 'FR', label: 'France' },
  { code: 'AU', label: 'Australia' },
  { code: 'JP', label: 'Japan' },
];

const DEFAULTS: ShipmentInput = {
  originZip: '50588',
  originCountry: 'US',
  destStreet: '',
  destStreet2: '',
  destZip: '',
  destCity: '',
  destState: '',
  destCountry: 'MX',
  destAttention: '',
  residential: true,
  weightLbs: 2,
  lengthIn: 12,
  widthIn: 9,
  heightIn: 6,
  declaredValueUSD: 0,
  customerName: '',
  customerPhone: '',
  customerEmail: '',
  senderName: '',
  senderPhone: '',
  senderEmail: '',
};

export default function IntlShipmentForm({ onSubmit, loading }: Props) {
  const [form, setForm] = useState<ShipmentInput>(DEFAULTS);
  const [validating, setValidating] = useState(false);
  const [addrResult, setAddrResult] = useState<AddressResult | null>(null);
  const [addrError, setAddrError] = useState<string | null>(null);

  function set<K extends keyof ShipmentInput>(key: K, value: ShipmentInput[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    if (['destStreet', 'destZip', 'destCity', 'destState', 'destCountry'].includes(key as string)) {
      setAddrResult(null);
      setAddrError(null);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSubmit(form);
  }

  // FedEx address validation works internationally (UPS validate is US-only).
  async function handleValidateAddress() {
    if (!form.destStreet && !form.destCity) return;
    setValidating(true);
    setAddrResult(null);
    setAddrError(null);
    try {
      const res = await fetch('/api/shipping/fedex/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          streetLine: form.destStreet,
          city: form.destCity,
          state: form.destState,
          zip: form.destZip,
          country: form.destCountry,
        }),
      });
      const data = await res.json();
      if (data?.error) { setAddrError(String(data.error)); return; }
      setAddrResult({
        valid: Boolean(data.valid),
        status: data.status ?? '',
        suggested: data.suggested ?? null,
        messages: (data.messages ?? []).filter((m: string) => !m.includes('only available for')),
      });
    } catch (err) {
      setAddrError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setValidating(false);
    }
  }

  function applySuggested() {
    if (!addrResult?.suggested) return;
    const s = addrResult.suggested;
    setForm((prev) => ({
      ...prev,
      destStreet: s.streetLine || prev.destStreet,
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

  const senderComplete = Boolean(form.senderName?.trim() && (form.senderPhone?.trim() || form.senderEmail?.trim()));

  return (
    <form onSubmit={handleSubmit} className="rounded-xl border border-navy/10 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center gap-2">
        <h2 className="text-sm font-bold uppercase tracking-wider text-navy">
          International Package &amp; Shipment Details
        </h2>
        <span className="rounded-full bg-blue/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-blue">
          Cross-border
        </span>
      </div>

      {/* Destination street + apt */}
      <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-[1fr_220px]">
        <div>
          <label className={lbl}>Dest Street Address</label>
          <input className={input} value={form.destStreet} onChange={(e) => set('destStreet', e.target.value)} maxLength={100} placeholder="Av. Insurgentes Sur 1234" required />
        </div>
        <div>
          <label className={lbl}>Apt / Suite / Neighborhood (Colonia / Bairro)</label>
          <input className={input} value={form.destStreet2 ?? ''} onChange={(e) => set('destStreet2', e.target.value)} maxLength={100} placeholder="Col. Del Valle · Int. 5B" />
          <p className="mt-1 text-[10px] text-navy/40">Mexico/South America: enter the colonia/neighborhood here — required for customs clearance.</p>
        </div>
      </div>

      <div className="mb-3">
        <label className={lbl}>Attention (optional)</label>
        <input className={input} value={form.destAttention ?? ''} onChange={(e) => set('destAttention', e.target.value)} maxLength={35} placeholder="ATTN: Receiving" />
      </div>

      {/* Country / postal / city / state / validate */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <div>
          <label className={lbl}>Country</label>
          <select className={input} value={form.destCountry} onChange={(e) => set('destCountry', e.target.value)}>
            {COUNTRIES.map((c) => (
              <option key={c.code} value={c.code}>{c.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={lbl}>Postal Code</label>
          <input className={input} value={form.destZip} onChange={(e) => set('destZip', e.target.value)} maxLength={16} placeholder="01000" required />
        </div>
        <div>
          <label className={lbl}>City</label>
          <input className={input} value={form.destCity} onChange={(e) => set('destCity', e.target.value)} maxLength={60} placeholder="Ciudad de México" required />
        </div>
        <div>
          <label className={lbl}>State / Province</label>
          <input className={input} value={form.destState} onChange={(e) => set('destState', e.target.value)} maxLength={40} placeholder="CDMX" />
        </div>
        <div>
          <label className={lbl}>Origin ZIP</label>
          <input className={`${input} cursor-not-allowed opacity-60`} value="50588" readOnly />
        </div>
        <div className="flex flex-col justify-end">
          <label className={lbl}>Address Check</label>
          <button
            type="button"
            onClick={handleValidateAddress}
            disabled={validating || (!form.destStreet && !form.destCity)}
            className="flex items-center justify-center gap-1.5 rounded-lg border border-navy/20 px-3 py-2 text-sm font-medium text-navy/70 transition-colors hover:bg-cream disabled:opacity-40"
          >
            {validating ? 'Checking…' : '✔ Validate'}
          </button>
        </div>
      </div>

      {/* Delivery type */}
      <div className="mt-3 flex items-center gap-2">
        <span className={lbl + ' mb-0'}>Delivery type</span>
        <button type="button" onClick={() => set('residential', true)} className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-all ${form.residential ? 'border-green-600 bg-green-600 text-white' : 'border-navy/20 bg-white text-navy/60 hover:border-navy/40'}`}>🏠 Residential</button>
        <button type="button" onClick={() => set('residential', false)} className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-all ${!form.residential ? 'border-navy bg-navy text-white' : 'border-navy/20 bg-white text-navy/60 hover:border-navy/40'}`}>🏢 Business</button>
        <span className="text-[11px] text-navy/40">Residential adds a carrier surcharge</span>
      </div>

      {addrError && (
        <div className="mt-2 rounded-lg bg-red/10 px-3 py-2 text-xs text-red">Address validation unavailable: {addrError}</div>
      )}
      {addrResult && (
        <div className={`mt-2 rounded-lg px-4 py-3 text-xs ${addrResult.valid ? 'border border-green-200 bg-green-50' : 'border border-yellow-200 bg-yellow-50'}`}>
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className={`font-semibold ${addrResult.valid ? 'text-green-700' : 'text-yellow-700'}`}>
                {addrResult.valid ? '✔ Address validated' : '⚠ Address could not be fully validated'}
              </p>
              {addrResult.messages.map((m, i) => (<p key={i} className="mt-0.5 text-yellow-700">{m}</p>))}
              {addrResult.suggested && (
                <p className="mt-1 text-navy/60">Suggested: <span className="font-medium text-navy">{[addrResult.suggested.city, addrResult.suggested.state, addrResult.suggested.zip].filter(Boolean).join(', ')}</span></p>
              )}
            </div>
            {addrResult.suggested && (
              <button type="button" onClick={applySuggested} className="shrink-0 rounded-lg border border-navy/20 bg-white px-2 py-1 text-[11px] font-semibold text-navy/70 hover:bg-cream">Apply</button>
            )}
          </div>
        </div>
      )}

      {/* Package dimensions */}
      <div className="mt-3 grid grid-cols-3 gap-3 sm:grid-cols-6">
        <div>
          <label className={lbl}>Weight (lbs)</label>
          <input className={input} type="number" min="0.1" step="0.1" value={form.weightLbs} onChange={(e) => set('weightLbs', parseFloat(e.target.value) || 0)} required />
        </div>
        <div>
          <label className={lbl}>Length (in)</label>
          <input className={input} type="number" min="1" step="0.5" value={form.lengthIn} onChange={(e) => set('lengthIn', parseFloat(e.target.value) || 0)} required />
        </div>
        <div>
          <label className={lbl}>Width (in)</label>
          <input className={input} type="number" min="1" step="0.5" value={form.widthIn} onChange={(e) => set('widthIn', parseFloat(e.target.value) || 0)} required />
        </div>
        <div>
          <label className={lbl}>Height (in)</label>
          <input className={input} type="number" min="1" step="0.5" value={form.heightIn} onChange={(e) => set('heightIn', parseFloat(e.target.value) || 0)} required />
        </div>
        <div>
          <label className={lbl}>Value ($)</label>
          <input className={input} type="number" min="0" step="0.01" value={form.declaredValueUSD} onChange={(e) => set('declaredValueUSD', parseFloat(e.target.value) || 0)} />
        </div>
      </div>

      {/* Sender (exporter) — required on the commercial invoice */}
      <h2 className="mt-5 mb-2 text-sm font-bold uppercase tracking-wider text-navy">
        Sender / Exporter (paying customer)
      </h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <label className={lbl}>Sender Name</label>
          <input className={input} value={form.senderName ?? ''} onChange={(e) => set('senderName', e.target.value)} maxLength={100} placeholder="John Doe" required />
        </div>
        <div>
          <label className={lbl}>Sender Phone</label>
          <input className={input} type="tel" value={form.senderPhone ?? ''} onChange={(e) => set('senderPhone', e.target.value)} maxLength={20} placeholder="(712) 555-0199" required />
        </div>
        <div>
          <label className={lbl}>Sender Email</label>
          <input className={input} type="email" value={form.senderEmail ?? ''} onChange={(e) => set('senderEmail', e.target.value)} maxLength={200} placeholder="john@example.com" />
          <p className="mt-1 text-[10px] text-navy/40">Used for the credit-card receipt.</p>
        </div>
      </div>

      {/* Recipient (importer) */}
      <h2 className="mt-5 mb-2 text-sm font-bold uppercase tracking-wider text-navy">Recipient / Importer (ship-to)</h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <label className={lbl}>Recipient Name</label>
          <input className={input} value={form.customerName} onChange={(e) => set('customerName', e.target.value)} maxLength={100} placeholder="Jane Smith" required />
        </div>
        <div>
          <label className={lbl}>Recipient Phone</label>
          <input className={input} type="tel" value={form.customerPhone} onChange={(e) => set('customerPhone', e.target.value)} maxLength={20} placeholder="+52 55 1234 5678" required />
        </div>
        <div>
          <label className={lbl}>Recipient Email</label>
          <input className={input} type="email" value={form.customerEmail} onChange={(e) => set('customerEmail', e.target.value)} maxLength={200} placeholder="jane@example.com" />
          <p className="mt-1 text-[10px] text-navy/40">Tracking + customs notifications sent here.</p>
        </div>
      </div>

      <div className="mt-4 flex items-center gap-4">
        <button
          type="submit"
          disabled={loading || !senderComplete}
          title={senderComplete ? undefined : 'Sender name + phone/email are required for customs'}
          className="rounded-lg bg-blue px-7 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-navy active:scale-95 disabled:opacity-50"
        >
          {loading ? 'Fetching Rates…' : 'Compare FedEx & UPS'}
        </button>
        <p className="text-xs text-navy/40">Queries FedEx &amp; UPS international services</p>
      </div>
    </form>
  );
}
