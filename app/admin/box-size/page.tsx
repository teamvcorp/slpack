"use client";

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { mergeIntoShippingDraft } from '@/lib/shippingDraft';
import { simpleRateEligibility } from '@/lib/upsSimpleRate';
import {
  DEFAULT_PACKING_RATES,
  calculateBox,
  maxSafeThickness,
  normalizePackingRates,
  recommendFreight,
  type PackingRates,
} from '@/lib/boxOptimizer';
import ItemForm from '../components/boxsize/ItemForm';
import PackingPicker from '../components/boxsize/PackingPicker';
import ResultSummary from '../components/boxsize/ResultSummary';
import PackingPriceCard from '../components/boxsize/PackingPriceCard';
import WarningList from '../components/boxsize/WarningList';
import SuggestionList from '../components/boxsize/SuggestionList';
import LiveRatePanel from '../components/boxsize/LiveRatePanel';
import {
  INITIAL_FORM,
  hasUsableZip,
  toCalcInput,
  type BoxFormState,
} from '../components/boxsize/formState';

/**
 * Box Size Calculator.
 *
 * Enter the bare item and how much protection it needs; get the outside box
 * dimensions, the UPS/FedEx surcharge classification, and how to get back
 * under a threshold. See box_surcharge_notes.md for the tariffs behind it.
 *
 * calculateBox() is pure and microsecond-scale, so everything derives in a
 * useMemo on each keystroke — no debounce, no effect, no loading state.
 */
export default function BoxSizePage() {
  const router = useRouter();
  const [form, setForm] = useState<BoxFormState>(INITIAL_FORM);
  const [liveCheapestUSD, setLiveCheapestUSD] = useState<number | null>(null);
  /** Shop packing rates from Settings; the shipped defaults until they load. */
  const [rates, setRates] = useState<PackingRates>(DEFAULT_PACKING_RATES);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/admin/settings/packing-pricing', { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setRates(normalizePackingRates(data));
      } catch {
        // Pricing is not worth blocking the calculator over — defaults stand.
      }
    })();
    return () => { cancelled = true; };
  }, []);

  function patch(p: Partial<BoxFormState>) {
    setForm((prev) => ({ ...prev, ...p }));
    // Any input change invalidates a live-rate-derived freight verdict.
    if (!('destZip' in p)) setLiveCheapestUSD(null);
  }

  const input = useMemo(() => ({ ...toCalcInput(form), rates }), [form, rates]);
  const result = useMemo(() => calculateBox(input), [input]);

  // Recompute the freight verdict once a live rate exists — the >$400 rule
  // cannot be evaluated from static constants alone.
  const freight = useMemo(
    () => (result.ok && liveCheapestUSD !== null
      ? recommendFreight(result.carriers, input.weightLbs, liveCheapestUSD)
      : result.freight),
    [result, input.weightLbs, liveCheapestUSD]
  );

  const maxSafeIn = useMemo(() => maxSafeThickness(input.item), [input.item]);

  const zipOk = hasUsableZip(form.destZip);
  const liveEnabled = result.ok && zipOk;
  const disabledReason = !result.ok
    ? 'Complete the item details first.'
    : 'Enter a destination ZIP to get live rates.';

  return (
    <div>
      <h1 className="text-2xl font-bold text-navy">Box Size Calculator</h1>
      <p className="mt-1 text-sm text-navy/50">
        Find the box that ships this item safely without tipping into a size surcharge.
      </p>

      <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <div className="space-y-5">
          <ItemForm value={form} onChange={patch} />
          <PackingPicker value={form} onChange={patch} maxSafeIn={maxSafeIn} />
        </div>

        <div className="space-y-5">
          {result.ok && <SimpleRateHandoff grossDims={result.grossDims} router={router} />}
          <ResultSummary result={result} />
          <PackingPriceCard price={result.packingPrice} profile={form.profile} ready={result.ok} />
          {result.ok && <WarningList warnings={result.warnings} />}
          {result.ok && <SuggestionList suggestions={result.suggestions} freight={freight} />}
          <LiveRatePanel
            grossDims={result.grossDims}
            weightLbs={input.weightLbs}
            destZip={form.destZip}
            residential={form.residential}
            enabled={liveEnabled}
            disabledReason={disabledReason}
            onCheapestChange={setLiveCheapestUSD}
          />
        </div>
      </div>
    </div>
  );
}

/**
 * Hands the calculated box to an in-progress shipment.
 *
 * DIMENSIONS ONLY, deliberately. The calculator knows the BARE ITEM weight; the
 * box, padding and tape add real ounces, so carrying the weight over would
 * under-weigh the parcel — the exact leak closed by making weight a required
 * entry. Weight comes from the scale.
 *
 * The Simple Rate tier is shown here because this is the last moment the box can
 * still change: once the tape is on, a parcel one cubic inch over its cap is a
 * re-rate on the weekly invoice.
 */
function SimpleRateHandoff({
  grossDims,
  router,
}: {
  grossDims: { lengthIn: number; widthIn: number; heightIn: number };
  router: ReturnType<typeof useRouter>;
}) {
  // Weight is irrelevant to the tier, so pass the max to isolate the size rules.
  const simple = simpleRateEligibility({ ...grossDims, weightLbs: 1, destCountry: 'US' });

  function handleAdd() {
    mergeIntoShippingDraft({
      lengthIn: grossDims.lengthIn,
      widthIn: grossDims.widthIn,
      heightIn: grossDims.heightIn,
    });
    router.push('/admin/shipping');
  }

  return (
    <section className="rounded-2xl border border-blue/30 bg-blue/5 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-navy">
            Finished box {grossDims.lengthIn} × {grossDims.widthIn} × {grossDims.heightIn} in
          </p>
          <p className="mt-0.5 text-[11px] text-navy/60">
            {simple.eligible ? (
              <>
                UPS Simple Rate tier <strong className="text-navy">{simple.tier}</strong> at{' '}
                {simple.cubicIn} cu in
                {simple.nearBoundary && (
                  <span className="ml-1 font-semibold text-amber-700">
                    — near the tier cap, re-measure before taping
                  </span>
                )}
              </>
            ) : (
              <>Not Simple Rate eligible — {simple.reason.toLowerCase()}</>
            )}
          </p>
        </div>
        <button
          type="button"
          onClick={handleAdd}
          className="shrink-0 rounded-lg bg-blue px-3 py-2 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-navy"
          title="Send these dimensions to the shipping screen. Weight still comes from the scale."
        >
          Add to current shipment
        </button>
      </div>
    </section>
  );
}
