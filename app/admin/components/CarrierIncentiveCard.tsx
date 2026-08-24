"use client";

import { useEffect, useState } from 'react';
import {
  DEFAULT_CARRIER_INCENTIVES,
  INCENTIVE_CARRIERS,
  MAX_INCENTIVE,
  normalizeCarrierIncentives,
  type CarrierIncentives,
  type IncentiveCarrier,
} from '@/lib/carrierIncentive';
import { SERVICE_CLASS_LABELS, SERVICE_CLASS_ORDER, type ServiceClass } from '@/lib/serviceClass';

/**
 * Our negotiated discount off each carrier's published list price, per service.
 *
 * These only matter when a carrier's rate reply carries no account rate — then
 * the only figure available is the published list price, and marking THAT up
 * prices off a number we never pay. The incentive converts list back into a
 * realistic cost so the counter always has a price it can stand behind.
 *
 * A worked preview sits beside the inputs because the effect isn't obvious from
 * a percentage: on a $120.79 list overnight, 38% off is the difference between
 * charging the customer $187 and charging them $116.
 */

/** Percent in the UI, fraction on the wire — nobody wants to type 0.38. */
const toPct = (fraction: number) => String(Math.round(fraction * 1000) / 10);
const fromPct = (pct: string) => (Number(pct) || 0) / 100;

/** The real quote that prompted this feature — see carrier_rate_pricing_notes.md. */
const PREVIEW_LIST_USD = 120.79;

const CARRIER_LABELS: Record<IncentiveCarrier, string> = { ups: 'UPS', fedex: 'FedEx' };

type TextTable = Record<IncentiveCarrier, Record<ServiceClass, string>>;

function toText(inc: CarrierIncentives): TextTable {
  return Object.fromEntries(
    INCENTIVE_CARRIERS.map((c) => [
      c,
      Object.fromEntries(SERVICE_CLASS_ORDER.map((s) => [s, toPct(inc[c][s])])),
    ])
  ) as TextTable;
}

function toFractions(text: TextTable): CarrierIncentives {
  return normalizeCarrierIncentives(
    Object.fromEntries(
      INCENTIVE_CARRIERS.map((c) => [
        c,
        Object.fromEntries(SERVICE_CLASS_ORDER.map((s) => [s, fromPct(text[c][s])])),
      ])
    )
  );
}

export default function CarrierIncentiveCard() {
  const [text, setText] = useState<TextTable>(() => toText(DEFAULT_CARRIER_INCENTIVES));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  function apply(incentives: unknown) {
    setText(toText(normalizeCarrierIncentives(incentives)));
  }

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/admin/settings/carrier-incentives', { cache: 'no-store' });
        if (res.ok) apply((await res.json()).incentives);
      } catch {
        /* leave defaults */
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function handleSave() {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch('/api/admin/settings/carrier-incentives', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ incentives: toFractions(text) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Server error ${res.status}`);
      apply(data.incentives);
      setMessage({ kind: 'ok', text: 'Carrier incentives saved.' });
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
      const res = await fetch('/api/admin/settings/carrier-incentives', { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Server error ${res.status}`);
      apply(data.incentives);
      setMessage({ kind: 'ok', text: 'Reset — no discount assumed.' });
    } catch (err: unknown) {
      setMessage({ kind: 'err', text: err instanceof Error ? err.message : 'Reset failed' });
    } finally {
      setSaving(false);
    }
  }

  const lbl = 'mb-1 block text-xs font-semibold uppercase tracking-wide text-navy/50';
  const input =
    'w-full rounded-lg border border-navy/20 bg-white px-2 py-1.5 text-sm text-navy focus:border-blue focus:outline-none focus:ring-1 focus:ring-blue';

  const current = toFractions(text);
  const previewPct = current.ups.overnight;
  const previewCost = Math.round(PREVIEW_LIST_USD * (1 - previewPct) * 100) / 100;

  return (
    <section className="mt-6 max-w-2xl rounded-2xl border border-navy/10 bg-white p-6 shadow-sm">
      <h2 className="text-base font-semibold text-navy">Carrier incentives</h2>
      <p className="mt-0.5 text-xs text-navy/50">
        Our discount off each carrier&apos;s published list price. Used only when the carrier returns
        no account rate — then list minus the incentive becomes the cost we price from. Read the
        measured spread in <strong>Reports → Margin</strong> and enter it here.
      </p>

      {loading ? (
        <p className="mt-4 text-sm text-navy/50">Loading…</p>
      ) : (
        <div className="mt-4 space-y-4">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className={`${lbl} text-left`}>Carrier</th>
                  {SERVICE_CLASS_ORDER.map((s) => (
                    <th key={s} className={`${lbl} text-left`}>
                      {SERVICE_CLASS_LABELS[s]} %
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {INCENTIVE_CARRIERS.map((c) => (
                  <tr key={c}>
                    <td className="pr-3 font-semibold text-navy">{CARRIER_LABELS[c]}</td>
                    {SERVICE_CLASS_ORDER.map((s) => (
                      <td key={s} className="pr-2 pb-2">
                        <input
                          className={input}
                          type="number"
                          min="0"
                          max={MAX_INCENTIVE * 100}
                          step="0.5"
                          value={text[c][s]}
                          onChange={(e) =>
                            setText((prev) => ({
                              ...prev,
                              [c]: { ...prev[c], [s]: e.target.value },
                            }))
                          }
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="rounded-lg bg-cream px-3 py-2 text-xs text-navy/60">
            <strong>UPS overnight preview.</strong> A ${PREVIEW_LIST_USD.toFixed(2)} list rate at{' '}
            {(previewPct * 100).toFixed(1)}% off becomes a{' '}
            <strong className="text-navy">${previewCost.toFixed(2)}</strong> cost basis.
            {previewPct === 0 && ' Zero means we assume no discount — safe, but over-prices.'}
          </p>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="rounded-lg bg-blue px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-navy disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              onClick={handleReset}
              disabled={saving}
              className="rounded-lg border border-navy/20 px-4 py-2 text-sm font-medium text-navy/70 transition-colors hover:bg-cream disabled:opacity-50"
            >
              Reset
            </button>
            {message && (
              <span className={`text-xs ${message.kind === 'ok' ? 'text-green-700' : 'text-red'}`}>
                {message.text}
              </span>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
