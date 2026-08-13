"use client";

import { useEffect, useState } from 'react';
import {
  DEFAULT_PACKING_RATES,
  computePackingPrice,
  money,
  normalizePackingRates,
  type PackingRates,
} from '@/lib/boxOptimizer';

/**
 * Packing-charge pricing for the box size calculator (/admin/box-size).
 *
 * Rates are per square inch of the finished box's outside surface; retail is
 * cost × the multiplier. A live preview on a 12 × 9 × 6 box sits next to the
 * inputs so staff can see what a change actually does to a quote before saving
 * — the compounding is not obvious from the cent figures alone.
 */

/** Cents in the UI, dollars on the wire — nobody wants to type 0.035. */
const toCents = (dollars: number) => String(Math.round(dollars * 1000) / 10);
const fromCents = (cents: string) => (Number(cents) || 0) / 100;

const PREVIEW_BOX = { lengthIn: 12, widthIn: 9, heightIn: 6 };

export default function PackingPricingCard() {
  const [light, setLight] = useState(toCents(DEFAULT_PACKING_RATES.light));
  const [standard, setStandard] = useState(toCents(DEFAULT_PACKING_RATES.standard));
  const [fragile, setFragile] = useState(toCents(DEFAULT_PACKING_RATES.fragile));
  const [box, setBox] = useState(toCents(DEFAULT_PACKING_RATES.box));
  const [multiplier, setMultiplier] = useState(String(DEFAULT_PACKING_RATES.retailMultiplier));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  function apply(d: Partial<PackingRates>) {
    const r = normalizePackingRates(d);
    setLight(toCents(r.light));
    setStandard(toCents(r.standard));
    setFragile(toCents(r.fragile));
    setBox(toCents(r.box));
    setMultiplier(String(r.retailMultiplier));
  }

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/admin/settings/packing-pricing', { cache: 'no-store' });
        if (res.ok) apply(await res.json());
      } catch {
        /* leave defaults */
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const current: PackingRates = normalizePackingRates({
    light: fromCents(light),
    standard: fromCents(standard),
    fragile: fromCents(fragile),
    box: fromCents(box),
    retailMultiplier: Number(multiplier),
  });

  async function handleSave() {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch('/api/admin/settings/packing-pricing', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          light: fromCents(light),
          standard: fromCents(standard),
          fragile: fromCents(fragile),
          box: fromCents(box),
          retailMultiplier: Number(multiplier),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Server error ${res.status}`);
      apply(data);
      setMessage({ kind: 'ok', text: 'Packing pricing saved.' });
    } catch (err: unknown) {
      setMessage({ kind: 'err', text: err instanceof Error ? err.message : 'Save failed' });
    } finally {
      setSaving(false);
    }
  }

  async function handleReset() {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch('/api/admin/settings/packing-pricing', { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Server error ${res.status}`);
      apply(data);
      setMessage({ kind: 'ok', text: 'Reset to default pricing.' });
    } catch (err: unknown) {
      setMessage({ kind: 'err', text: err instanceof Error ? err.message : 'Reset failed' });
    } finally {
      setSaving(false);
    }
  }

  const lbl = 'mb-1 block text-xs font-semibold uppercase tracking-wide text-navy/50';
  const input =
    'w-full rounded-lg border border-navy/20 bg-white px-3 py-2 text-sm text-navy focus:border-blue focus:outline-none focus:ring-1 focus:ring-blue';

  return (
    <section className="mt-6 max-w-lg rounded-2xl border border-navy/10 bg-white p-6 shadow-sm">
      <h2 className="text-base font-semibold text-navy">Packing pricing</h2>
      <p className="mt-0.5 text-xs text-navy/50">
        Charged per square inch of the finished box&apos;s outside surface. Used by the Box Size
        Calculator.
      </p>

      {loading ? (
        <p className="mt-4 text-sm text-navy/50">Loading…</p>
      ) : (
        <div className="mt-4 space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div>
              <label className={lbl}>Light ¢</label>
              <input className={input} type="number" min="0" step="0.1" value={light} onChange={(e) => setLight(e.target.value)} />
            </div>
            <div>
              <label className={lbl}>Standard ¢</label>
              <input className={input} type="number" min="0" step="0.1" value={standard} onChange={(e) => setStandard(e.target.value)} />
            </div>
            <div>
              <label className={lbl}>Fragile ¢</label>
              <input className={input} type="number" min="0" step="0.1" value={fragile} onChange={(e) => setFragile(e.target.value)} />
            </div>
            <div>
              <label className={lbl}>Box ¢</label>
              <input className={input} type="number" min="0" step="0.1" value={box} onChange={(e) => setBox(e.target.value)} />
            </div>
          </div>

          <div>
            <label className={lbl}>Retail multiplier</label>
            <input
              className={input}
              type="number" min="1" max="20" step="0.05"
              value={multiplier}
              onChange={(e) => setMultiplier(e.target.value)}
            />
            <p className="mt-1 text-[11px] text-navy/40">
              What the customer pays = shop cost × this. Default {DEFAULT_PACKING_RATES.retailMultiplier}.
            </p>
          </div>

          <div className="rounded-xl bg-navy/5 px-4 py-3">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-navy/40">
              Preview — 12″ × 9″ × 6″ box (468 sq in)
            </div>
            <table className="mt-2 w-full text-[12px]">
              <thead>
                <tr className="text-left text-navy/40">
                  <th className="font-medium">Level</th>
                  <th className="font-medium">Rate</th>
                  <th className="font-medium">Cost</th>
                  <th className="font-medium">Customer</th>
                </tr>
              </thead>
              <tbody>
                {(['light', 'standard', 'fragile'] as const).map((p) => {
                  const price = computePackingPrice(PREVIEW_BOX, p, current);
                  return (
                    <tr key={p}>
                      <td className="capitalize text-navy/70">{p}</td>
                      <td className="text-navy/50">{Math.round(price.ratePerSqIn * 100)}¢</td>
                      <td className="text-navy/50">{money(price.costUSD)}</td>
                      <td className="font-semibold text-navy">{money(price.retailUSD)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {message && (
            <div
              className={`rounded-lg px-3 py-2 text-sm ${
                message.kind === 'ok' ? 'bg-green-50 text-green-700' : 'bg-red/10 text-red'
              }`}
            >
              {message.text}
            </div>
          )}

          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="rounded-lg bg-blue px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-navy disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              onClick={handleReset}
              disabled={saving}
              className="rounded-lg border border-navy/20 px-4 py-2.5 text-sm font-medium text-navy/70 transition-colors hover:bg-cream disabled:opacity-50"
            >
              Reset to defaults
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
