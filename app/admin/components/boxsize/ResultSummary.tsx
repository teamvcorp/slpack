"use client";

import {
  LABELS,
  PARCEL_CARRIERS,
  moneyRange,
  FEE_SCHEDULE_YEAR,
  FEE_VERIFIED_ON,
  type BoxCalcResult,
  type CarrierAssessment,
  type SizeClass,
} from '@/lib/boxOptimizer';
import { CARD, CARD_TITLE, CARD_SUB, NOTE } from './styles';

const BADGE: Record<SizeClass, string> = {
  STANDARD: 'bg-green-50 text-green-700 border-green-200',
  ADDITIONAL_HANDLING: 'bg-amber-50 text-amber-900 border-amber-300',
  LARGE_PACKAGE: 'bg-red/10 text-red border-red/30',
  OVER_MAX: 'bg-red/10 text-red border-red/40',
};

function Metric({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg bg-navy/5 px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-navy/40">{label}</div>
      <div className="text-sm font-semibold text-navy">{value}</div>
      {sub && <div className="text-[10px] text-navy/40">{sub}</div>}
    </div>
  );
}

function CarrierBlock({ a }: { a: CarrierAssessment }) {
  return (
    <div className="rounded-lg border border-navy/10 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold text-navy">{a.label}</span>
        <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${BADGE[a.sizeClass]}`}>
          {LABELS[a.sizeClass]}
        </span>
      </div>

      <div className="mt-2 text-[12px] text-navy/60">
        Billed weight <strong className="text-navy">{a.billedWeightLbs} lb</strong>
        {a.billedWeightLbs !== a.actualWeightLbs && (
          <span className="text-navy/40">
            {' '}(actual {a.actualWeightLbs} lb, dimensional {a.dimWeightLbs} lb
            {a.sizeClass === 'LARGE_PACKAGE' && a.billedWeightLbs === 90 ? ', 90 lb minimum applied' : ''})
          </span>
        )}
      </div>

      {a.surcharges.length > 0 ? (
        <ul className="mt-2 space-y-1">
          {a.surcharges.map((s) => (
            <li key={s.code} className="flex items-baseline justify-between gap-3 text-[12px]">
              <span className="text-navy/70">
                {s.label}
                <span className="block text-[10px] text-navy/40">{s.reason}</span>
              </span>
              <span className="shrink-0 font-semibold text-navy">{moneyRange(s.fee)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-[12px] text-green-700">No size surcharges.</p>
      )}

      {a.suppressed.length > 0 && (
        <ul className="mt-2 space-y-0.5 border-t border-navy/10 pt-2">
          {a.suppressed.map((s) => (
            <li key={s.code} className="text-[11px] text-navy/35 line-through decoration-navy/20">
              {s.label} — not charged, superseded
            </li>
          ))}
        </ul>
      )}

      {a.surcharges.length > 0 && (
        <div className="mt-2 flex items-baseline justify-between border-t border-navy/10 pt-2 text-[12px]">
          <span className="font-semibold text-navy">Estimated surcharges</span>
          <span className="font-bold text-navy">{moneyRange(a.surchargeTotal)}</span>
        </div>
      )}

      {a.blockReason && (
        <p className="mt-2 rounded-lg border border-red/30 bg-red/5 px-2 py-1.5 text-[11px] text-red">
          {a.blockReason}
        </p>
      )}
    </div>
  );
}

export default function ResultSummary({ result }: { result: BoxCalcResult }) {
  if (!result.ok) {
    return (
      <section className={CARD}>
        <h2 className={CARD_TITLE}>Box size</h2>
        <p className="mt-6 text-center text-sm text-navy/40">
          {result.incompleteReason ?? "Enter the item's dimensions to begin."}
        </p>
      </section>
    );
  }

  const g = result.grossDims;
  const m = result.grossMeasure;

  return (
    <section className={CARD}>
      <h2 className={CARD_TITLE}>Box size</h2>
      <p className={CARD_SUB}>
        Smallest box that fits the item plus {result.packing.thicknessIn}&quot; of packing per side.
      </p>

      <div className="mt-3 rounded-xl bg-navy px-4 py-3 text-center">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-white/50">
          Outside box dimensions
        </div>
        <div className="text-2xl font-bold text-white">
          {g.lengthIn}&quot; × {g.widthIn}&quot; × {g.heightIn}&quot;
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Metric label="Length + girth" value={`${m.lengthPlusGirthIn}"`} sub="limit 130&quot;" />
        <Metric label="Longest side" value={`${m.longestIn}"`} sub="limit 96&quot;" />
        <Metric label="Cubic volume" value={`${Math.round(m.cubicIn).toLocaleString()} in³`} sub="limit 17,280" />
        <Metric label="Dimensional wt" value={`${m.dimWeightLbs} lb`} sub="÷ 139" />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {PARCEL_CARRIERS.map((c) => (
          <CarrierBlock key={c} a={result.carriers[c]} />
        ))}
      </div>

      <p className={NOTE}>
        <strong className="text-navy/70">Estimated surcharges only — base rate not included.</strong>{' '}
        These charges vary by zone, so a range is shown; the base rate depends on zone, billed weight and
        service, which only the carrier can price. Amounts are {FEE_SCHEDULE_YEAR} published figures
        (verified {FEE_VERIFIED_ON}) before fuel, and the shop&apos;s negotiated rates may differ. Use
        &ldquo;Get live rates&rdquo; below for real numbers.
        {result.isPeak && ' Peak season is active — carriers add a demand surcharge on top.'}
      </p>
    </section>
  );
}
