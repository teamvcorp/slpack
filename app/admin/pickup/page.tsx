"use client";

import { useState } from 'react';
import { SITE } from '@/lib/siteConfig';

interface Alert {
  code?: string;
  alertType?: string;
  message?: string;
}

function todayLocal(): string {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().split('T')[0];
}

const PACKAGE_LOCATIONS = ['FRONT', 'REAR', 'SIDE', 'NONE'] as const;

export default function PickupPage() {
  const [form, setForm] = useState({
    carrierCode: 'FDXG',
    pickupDate: todayLocal(),
    readyTime: '09:00',
    closeTime: '18:00',
    packageCount: '1',
    totalWeightLbs: '1',
    packageLocation: 'FRONT',
    remarks: '',
    companyName: SITE.name,
    personName: '',
    phoneNumber: SITE.telephoneDisplay,
    street: SITE.address.street,
    city: SITE.address.city,
    state: SITE.address.region,
    postalCode: SITE.address.postalCode,
  });

  const [carrier, setCarrier] = useState<'fedex' | 'ups'>('fedex');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ code: string | null; location: string | null; alerts: Alert[] } | null>(null);

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSubmit() {
    setSubmitting(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(`/api/shipping/${carrier}/pickup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          carrierCode: form.carrierCode,
          pickupDate: form.pickupDate,
          readyTime: form.readyTime,
          closeTime: form.closeTime,
          packageCount: form.packageCount,
          totalWeightLbs: form.totalWeightLbs,
          packageLocation: form.packageLocation,
          remarks: form.remarks.trim() || undefined,
          contact: {
            companyName: form.companyName,
            personName: form.personName,
            phoneNumber: form.phoneNumber,
          },
          address: {
            streetLines: form.street,
            city: form.city,
            stateOrProvinceCode: form.state,
            postalCode: form.postalCode,
            countryCode: 'US',
          },
        }),
      });
      if (res.status === 401) {
        // Admin session expired — send the cashier to re-authenticate.
        window.location.href = `/admin/login?from=${encodeURIComponent('/admin/pickup')}`;
        return;
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Server error ${res.status}`);
      setResult({
        code: data.pickupConfirmationCode ?? null,
        location: data.location ?? null,
        alerts: data.alerts ?? [],
      });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to schedule pickup.');
    } finally {
      setSubmitting(false);
    }
  }

  const labelCls = 'mb-1 block text-xs font-semibold uppercase tracking-wide text-navy/50';
  const inputCls =
    'w-full rounded-lg border border-navy/20 bg-white px-3 py-2 text-sm text-navy focus:border-blue focus:outline-none focus:ring-1 focus:ring-blue';

  // ── Success screen ─────────────────────────────────────────────────────────
  if (result) {
    return (
      <div className="py-8">
        <div className="mx-auto max-w-md rounded-2xl border border-navy/10 bg-white p-8 text-center shadow-sm">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
            <svg className="h-8 w-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="mt-4 text-xl font-bold text-navy">Pickup Scheduled</h1>
          <p className="mt-2 text-sm text-navy/60">
            {carrier === 'ups'
              ? 'UPS'
              : form.carrierCode === 'FDXE'
                ? 'FedEx Express'
                : 'FedEx Ground'}{' '}
            · {new Date(`${form.pickupDate}T00:00:00`).toLocaleDateString()}
          </p>
          {result.code && (
            <div className="mt-4 rounded-xl bg-navy/5 px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-navy/40">Confirmation #</p>
              <p className="mt-1 text-2xl font-extrabold tracking-wide text-navy">{result.code}</p>
              {result.location && <p className="mt-1 text-xs text-navy/40">Location: {result.location}</p>}
            </div>
          )}
          {result.alerts.length > 0 && (
            <div className="mt-4 space-y-1 text-left">
              {result.alerts.map((a, i) => (
                <p key={i} className="rounded-lg bg-tan/20 px-3 py-2 text-xs text-navy/70">
                  {a.message ?? a.code}
                </p>
              ))}
            </div>
          )}
          <button
            type="button"
            onClick={() => setResult(null)}
            className="mt-6 w-full rounded-xl bg-blue px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-navy"
          >
            Schedule another pickup
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="py-8">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-navy">Schedule a Pickup</h1>
          <p className="mt-1 text-sm text-navy/50">Request a courier to collect outbound packages.</p>
        </div>
        <div className="flex gap-1 rounded-xl border border-navy/10 bg-cream p-1">
          {[
            { key: 'fedex' as const, label: 'FedEx' },
            { key: 'ups' as const, label: 'UPS' },
          ].map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => setCarrier(c.key)}
              className={`rounded-lg px-4 py-1.5 text-sm font-semibold transition-colors ${
                carrier === c.key ? 'bg-white text-navy shadow-sm' : 'text-navy/50 hover:text-navy'
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      {error && <div className="mb-4 rounded-xl bg-red/10 px-4 py-3 text-sm text-red">{error}</div>}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Pickup details */}
        <div className="rounded-2xl border border-navy/10 bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-base font-semibold text-navy">Pickup details</h2>

          {carrier === 'fedex' && (
            <div className="mb-4">
              <span className={labelCls}>Service</span>
              <div className="flex gap-2">
                {[
                  { code: 'FDXG', label: 'Ground' },
                  { code: 'FDXE', label: 'Express' },
                ].map((c) => (
                  <button
                    key={c.code}
                    type="button"
                    onClick={() => set('carrierCode', c.code)}
                    className={`flex-1 rounded-lg border px-3 py-2 text-sm font-semibold transition-colors ${
                      form.carrierCode === c.code
                        ? 'border-blue bg-blue/10 text-blue'
                        : 'border-navy/20 text-navy/60 hover:bg-cream'
                    }`}
                  >
                    FedEx {c.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls} htmlFor="pickupDate">Pickup date</label>
              <input id="pickupDate" type="date" min={todayLocal()} value={form.pickupDate} onChange={(e) => set('pickupDate', e.target.value)} className={inputCls} />
            </div>
            {carrier === 'fedex' && (
              <div>
                <label className={labelCls} htmlFor="packageLocation">Package location</label>
                <select id="packageLocation" value={form.packageLocation} onChange={(e) => set('packageLocation', e.target.value)} className={inputCls}>
                  {PACKAGE_LOCATIONS.map((l) => (
                    <option key={l} value={l}>{l.charAt(0) + l.slice(1).toLowerCase()}</option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label className={labelCls} htmlFor="readyTime">Ready time</label>
              <input id="readyTime" type="time" value={form.readyTime} onChange={(e) => set('readyTime', e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className={labelCls} htmlFor="closeTime">Latest access (close)</label>
              <input id="closeTime" type="time" value={form.closeTime} onChange={(e) => set('closeTime', e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className={labelCls} htmlFor="packageCount"># of packages</label>
              <input id="packageCount" type="number" min="1" value={form.packageCount} onChange={(e) => set('packageCount', e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className={labelCls} htmlFor="totalWeightLbs">Total weight (lbs)</label>
              <input id="totalWeightLbs" type="number" min="0.1" step="0.1" value={form.totalWeightLbs} onChange={(e) => set('totalWeightLbs', e.target.value)} className={inputCls} />
            </div>
          </div>

          <div className="mt-3">
            <label className={labelCls} htmlFor="remarks">Note for courier (optional, max 60)</label>
            <input id="remarks" type="text" maxLength={60} value={form.remarks} onChange={(e) => set('remarks', e.target.value)} placeholder="e.g. Ring bell at front desk" className={inputCls} />
          </div>
        </div>

        {/* Pickup address */}
        <div className="rounded-2xl border border-navy/10 bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-base font-semibold text-navy">Pickup address</h2>

          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls} htmlFor="companyName">Company</label>
                <input id="companyName" type="text" value={form.companyName} onChange={(e) => set('companyName', e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className={labelCls} htmlFor="personName">Contact name</label>
                <input id="personName" type="text" value={form.personName} onChange={(e) => set('personName', e.target.value)} className={inputCls} />
              </div>
            </div>
            <div>
              <label className={labelCls} htmlFor="phoneNumber">Phone</label>
              <input id="phoneNumber" type="tel" value={form.phoneNumber} onChange={(e) => set('phoneNumber', e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className={labelCls} htmlFor="street">Street</label>
              <input id="street" type="text" value={form.street} onChange={(e) => set('street', e.target.value)} className={inputCls} />
            </div>
            <div className="grid grid-cols-[1fr_80px_120px] gap-3">
              <div>
                <label className={labelCls} htmlFor="city">City</label>
                <input id="city" type="text" value={form.city} onChange={(e) => set('city', e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className={labelCls} htmlFor="state">State</label>
                <input id="state" type="text" maxLength={2} value={form.state} onChange={(e) => set('state', e.target.value.toUpperCase())} className={inputCls} />
              </div>
              <div>
                <label className={labelCls} htmlFor="postalCode">ZIP</label>
                <input id="postalCode" type="text" value={form.postalCode} onChange={(e) => set('postalCode', e.target.value)} className={inputCls} />
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className="mt-6 w-full rounded-xl bg-blue px-4 py-3 text-sm font-bold text-white shadow-sm transition-all hover:bg-navy active:scale-95 disabled:opacity-50"
          >
            {submitting ? 'Scheduling…' : 'Schedule pickup'}
          </button>
        </div>
      </div>
    </div>
  );
}
