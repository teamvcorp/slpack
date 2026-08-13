"use client";

import { moneyRange, type FreightRecommendation, type Suggestion } from '@/lib/boxOptimizer';
import { CARD, CARD_TITLE, CARD_SUB } from './styles';

interface Props {
  suggestions: Suggestion[];
  freight: FreightRecommendation;
}

/** Ranked ways to get the box under a threshold, plus the freight fallback. */
export default function SuggestionList({ suggestions, freight }: Props) {
  if (suggestions.length === 0 && !freight.recommended && !freight.needsLiveRate) return null;

  return (
    <section className={CARD}>
      <h2 className={CARD_TITLE}>How to get under the threshold</h2>
      <p className={CARD_SUB}>Ranked by what actually helps — achievable options first.</p>

      {freight.recommended && (
        <div className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-3">
          <div className="text-sm font-semibold text-amber-900">Consider LTL freight instead of parcel</div>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[12px] text-amber-900/80">
            {freight.reasons.map((r) => <li key={r}>{r}</li>)}
          </ul>
        </div>
      )}

      {freight.needsLiveRate && !freight.recommended && (
        <p className="mt-3 rounded-lg bg-navy/5 px-3 py-2 text-[12px] text-navy/60">
          Get live rates below to check this against the freight-comparison threshold.
        </p>
      )}

      <ul className="mt-3 space-y-2">
        {suggestions.map((s) => (
          <li
            key={s.id}
            className={`rounded-lg border p-3 ${
              s.achievable ? 'border-navy/15 bg-white' : 'border-navy/10 bg-navy/5'
            }`}
          >
            <div className="flex items-baseline justify-between gap-3">
              <span className={`text-sm font-semibold ${s.achievable ? 'text-navy' : 'text-navy/50'}`}>
                {s.achievable ? '' : 'Not achievable — '}{s.label}
              </span>
              {s.savings && (
                <span className="shrink-0 rounded-full bg-green-50 px-2 py-0.5 text-[11px] font-semibold text-green-700">
                  saves {moneyRange(s.savings)}
                </span>
              )}
            </div>
            <p className="mt-1 text-[12px] leading-relaxed text-navy/60">{s.detail}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
