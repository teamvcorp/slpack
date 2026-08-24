"use client";

import { useEffect, useState } from 'react';
import { SITE } from '@/lib/siteConfig';
import { freightPrice } from '@/lib/shippingPricing';
import type { Dims } from '@/lib/parcelGeometry';
import type { CarrierResult, ShippingRate } from '../../types/shipping';
import { CARD, CARD_TITLE, CARD_SUB, LABEL, INPUT, HELP, BTN_PRIMARY, NOTE } from './styles';

type LiveCarrier = 'ups' | 'fedex';
const CARRIERS: LiveCarrier[] = ['ups', 'fedex'];
const NAMES: Record<LiveCarrier, string> = { ups: 'UPS', fedex: 'FedEx' };

const BLANK: Record<LiveCarrier, CarrierResult> = {
  ups: { carrier: 'ups', rates: [], error: null, loading: false, lastFetched: null },
  fedex: { carrier: 'fedex', rates: [], error: null, loading: false, lastFetched: null },
};

interface Props {
  grossDims: Dims;
  weightLbs: number;
  destZip: string;
  residential: boolean;
  /** False when dimensions are incomplete or the ZIP isn't a valid 5-digit. */
  enabled: boolean;
  disabledReason: string;
  /** Cheapest live carrier cost, so the page can evaluate the freight rule. */
  onCheapestChange: (totalUSD: number | null) => void;
}

function cheapest(rates: ShippingRate[]): ShippingRate | null {
  if (rates.length === 0) return null;
  return rates.reduce((best, r) => (r.totalChargeUSD < best.totalChargeUSD ? r : best));
}

/**
 * UPS cannot resolve every ZIP from the postal code alone and answers with
 * 111539 / 111542 "Invalid Destination". It is not a bad ZIP and not a sandbox
 * artifact — it means UPS wants the city and state too. Detected here rather
 * than in the rate route so no existing quoting path is touched.
 */
function needsCityState(error: string | null): boolean {
  if (!error) return false;
  return /11153[0-9]|111542|invalid destination/i.test(error);
}

/**
 * Real carrier pricing for the computed box.
 *
 * Two details here are load-bearing and easy to get wrong:
 *  1. We send the ACTUAL weight, never the calculator's billed weight. The
 *     carrier applies dimensional weight and the 90 lb Large Package floor
 *     itself — sending our billed figure would double-count it.
 *  2. We send the GROSS box dimensions, not the bare item dimensions the
 *     operator typed. Every other form in this app takes final package dims.
 */
export default function LiveRatePanel({
  grossDims, weightLbs, destZip, residential, enabled, disabledReason, onCheapestChange,
}: Props) {
  const [results, setResults] = useState<Record<LiveCarrier, CarrierResult>>(BLANK);
  const [destCity, setDestCity] = useState('');
  const [destState, setDestState] = useState('');
  /** Result of the last completed ZIP lookup, tagged with the ZIP it was for. */
  const [zipResult, setZipResult] = useState<{ forZip: string; ok: boolean; note: string } | null>(null);
  /** Inputs the displayed rates were fetched for; null until the first fetch. */
  const [fetchedSignature, setFetchedSignature] = useState<string | null>(null);

  /**
   * Auto-fill city/state from the ZIP via USPS, so UPS never gets a bare postal
   * code it can't resolve. City/state are derived from the ZIP, so a new ZIP
   * overwrites them; the operator can still edit afterwards.
   */
  const zip5 = destZip.trim().slice(0, 5);
  const zipValid = /^\d{5}$/.test(zip5);
  // Derived, not stored — setting a "loading" flag synchronously in the effect
  // body would cascade an extra render on every keystroke.
  const zipLoading = zipValid && zipResult?.forZip !== zip5;

  useEffect(() => {
    if (!zipValid) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/shipping/zip-lookup?zip=${zip5}`, { cache: 'no-store' });
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok || data.error) {
          // Not fatal — the operator can type the city themselves.
          setZipResult({ forZip: zip5, ok: false, note: String(data.error ?? `Lookup failed (${res.status})`) });
          return;
        }
        setDestCity(data.city);
        setDestState(data.state);
        setZipResult({ forZip: zip5, ok: true, note: `${data.city}, ${data.state} — from USPS` });
      } catch {
        if (!cancelled) setZipResult({ forZip: zip5, ok: false, note: 'ZIP lookup unavailable' });
      }
    })();
    return () => { cancelled = true; };
  }, [zip5, zipValid]);

  const signature = JSON.stringify([grossDims, weightLbs, destZip, residential]);
  const fetched = fetchedSignature !== null;
  // Inputs changed after a fetch: dim the panel rather than clearing it, so a
  // number the operator is quoting from doesn't vanish mid-conversation.
  const stale = fetched && fetchedSignature !== signature;

  function set(carrier: LiveCarrier, patch: Partial<CarrierResult>) {
    setResults((prev) => ({ ...prev, [carrier]: { ...prev[carrier], ...patch } }));
  }

  async function fetchCarrier(carrier: LiveCarrier, body: Record<string, unknown>) {
    set(carrier, { loading: true, error: null });
    try {
      const res = await fetch(`/api/shipping/${carrier}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        cache: 'no-store',
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        set(carrier, { loading: false, rates: [], error: String(data.error ?? `Server error ${res.status}`), lastFetched: new Date().toLocaleTimeString() });
        return [] as ShippingRate[];
      }
      const rates: ShippingRate[] = data.rates ?? [];
      set(carrier, { loading: false, rates, error: null, lastFetched: new Date().toLocaleTimeString() });
      return rates;
    } catch (err: unknown) {
      set(carrier, { loading: false, rates: [], error: err instanceof Error ? err.message : 'Network error', lastFetched: null });
      return [] as ShippingRate[];
    }
  }

  async function handleFetch() {
    const body = {
      originZip: SITE.address.postalCode,
      destZip: destZip.trim(),
      destCity: destCity.trim(),
      destState: destState.trim().toUpperCase(),
      destCountry: 'US',
      residential,
      weightLbs,
      lengthIn: grossDims.lengthIn,
      widthIn: grossDims.widthIn,
      heightIn: grossDims.heightIn,
      packaging: 'YOUR_PACKAGING',
    };
    setFetchedSignature(signature);

    const all = await Promise.all(CARRIERS.map((c) => fetchCarrier(c, body)));
    const best = all.flat().reduce<number | null>(
      (min, r) => (min === null || r.totalChargeUSD < min ? r.totalChargeUSD : min),
      null
    );
    onCheapestChange(best);
  }

  const busy = CARRIERS.some((c) => results[c].loading);

  return (
    <section className={CARD}>
      <h2 className={CARD_TITLE}>Live carrier rates</h2>
      <p className={CARD_SUB}>Real pricing for the computed box, from {SITE.address.postalCode}.</p>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <div>
          <label className={LABEL}>Destination city</label>
          <input className={INPUT} value={destCity} onChange={(e) => setDestCity(e.target.value)} placeholder="Optional" />
        </div>
        <div>
          <label className={LABEL}>State</label>
          <input className={INPUT} maxLength={2} value={destState} onChange={(e) => setDestState(e.target.value)} placeholder="IA" />
        </div>
      </div>
      <p className={HELP}>
        {zipLoading && 'Looking up the ZIP…'}
        {!zipLoading && zipResult?.ok && `✓ ${zipResult.note}`}
        {!zipLoading && zipResult && !zipResult.ok && `${zipResult.note} — type the city and state manually.`}
        {!zipLoading && !zipResult &&
          'Filled in automatically from the ZIP. UPS cannot resolve some ZIPs from the postal code alone (error 111539 / 111542); FedEx does not need them.'}
      </p>

      <div className="mt-4 flex items-center gap-3">
        <button type="button" className={BTN_PRIMARY} onClick={handleFetch} disabled={!enabled || busy}>
          {busy ? 'Getting rates…' : 'Get live rates'}
        </button>
        {!enabled && <span className="text-[12px] text-navy/50">{disabledReason}</span>}
      </div>

      {stale && (
        <p className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[12px] text-amber-900">
          Inputs changed — the rates below are for the previous box.
        </p>
      )}

      {fetched && (
        <div className={`mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 ${stale ? 'opacity-50' : ''}`}>
          {CARRIERS.map((c) => {
            const r = results[c];
            const best = cheapest(r.rates);
            return (
              <div key={c} className="rounded-lg border border-navy/10 p-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-navy">{NAMES[c]}</span>
                  {r.lastFetched && <span className="text-[10px] text-navy/35">{r.lastFetched}</span>}
                </div>
                {r.loading && <p className="mt-2 text-[12px] text-navy/50">Loading…</p>}
                {r.error && (
                  <>
                    <p className="mt-2 rounded-lg border border-red/20 bg-red/5 px-2 py-1.5 text-[11px] text-red">
                      {r.error}
                    </p>
                    {needsCityState(r.error) && (
                      <p className="mt-1.5 rounded-lg border border-amber-300 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-900">
                        {NAMES[c]} could not resolve this ZIP on its own. Enter the destination city and
                        state above and try again — this is not a bad ZIP.
                      </p>
                    )}
                  </>
                )}
                {!r.loading && !r.error && !best && (
                  <p className="mt-2 text-[12px] text-navy/50">
                    No services returned for these dimensions — a strong sign this needs freight.
                  </p>
                )}
                {best && (
                  <div className="mt-2">
                    <div className="text-[12px] text-navy/60">{best.serviceName}</div>
                    <div className="text-lg font-bold text-navy">${best.totalChargeUSD.toFixed(2)}</div>
                    <div className="text-[11px] text-navy/50">
                      Customer price ${freightPrice(best.totalChargeUSD).toFixed(2)}
                    </div>
                    {r.rates.length > 1 && (
                      <div className="text-[10px] text-navy/35">
                        cheapest of {r.rates.length} services
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <p className={NOTE}>
        Live totals already include every carrier surcharge — do <strong>not</strong> add the estimate
        above to these figures.
      </p>
    </section>
  );
}
