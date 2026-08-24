"use client";

import { useCallback, useEffect, useState } from 'react';
import { SERVICE_CLASS_LABELS, SERVICE_CLASS_ORDER, type ServiceClass } from '@/lib/serviceClass';
import type { ReportPeriod } from '@/lib/reportPeriod';

const PERIODS: { key: ReportPeriod; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'mtd', label: 'Month to Date' },
  { key: 'ytd', label: 'Year to Date' },
];

interface MarginRow {
  carrier: string;
  carrierLabel: string;
  serviceClass: ServiceClass;
  count: number;
  revenueUSD: number;
  ratedCount: number;
  ratedRevenueUSD: number;
  costUSD: number;
  marginUSD: number;
  markupX: number | null;
  negativeCount: number;
  publishedCount: number;
  negotiatedCount: number;
  unknownSourceCount: number;
  overriddenCount: number;
  aboveCarrierRetailCount: number;
  listedRevenueUSD: number;
  listedRetailUSD: number;
  pctOfCarrierRetail: number | null;
}

interface MarginResponse {
  period: ReportPeriod;
  rows: MarginRow[];
  totals: {
    count: number;
    revenueUSD: number;
    ratedCount: number;
    ratedRevenueUSD: number;
    costUSD: number;
    marginUSD: number;
    markupX: number | null;
    negativeCount: number;
    publishedCount: number;
    overriddenCount: number;
    aboveCarrierRetailCount: number;
    listedRevenueUSD: number;
    listedRetailUSD: number;
    headroomUSD: number;
    pctOfCarrierRetail: number | null;
  };
  targetMarkupX: number;
  unratedCount: number;
}

const money = (n: number) => `$${n.toFixed(2)}`;

export default function MarginReport() {
  const [period, setPeriod] = useState<ReportPeriod>('mtd');
  const [data, setData] = useState<MarginResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchMargin = useCallback(async (p: ReportPeriod) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/reports/margin?period=${p}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load margin');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMargin(period);
  }, [period, fetchMargin]);

  const target = data?.targetMarkupX ?? 1.55;

  /** Colour the effective markup against the intended one. */
  function markupTone(x: number | null): string {
    if (x === null) return 'text-navy/30';
    if (x < 1.15) return 'text-red font-bold';             // barely covering cost
    if (x > target + 0.35) return 'text-amber-600 font-bold'; // well above intent
    return 'text-navy font-semibold';
  }

  // Fastest (priciest) service first — that's where a markup gap costs most.
  const rows = [...(data?.rows ?? [])].sort((a, b) => {
    const byClass =
      SERVICE_CLASS_ORDER.indexOf(a.serviceClass) - SERVICE_CLASS_ORDER.indexOf(b.serviceClass);
    return byClass !== 0 ? byClass : a.carrierLabel.localeCompare(b.carrierLabel);
  });

  return (
    <div className="mt-4">
      {/* Period switcher */}
      <div className="mb-4 flex gap-2">
        {PERIODS.map((p) => (
          <button
            key={p.key}
            type="button"
            onClick={() => setPeriod(p.key)}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
              period === p.key
                ? 'bg-navy text-white'
                : 'border border-navy/15 bg-white text-navy/60 hover:bg-cream'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {loading && <p className="text-sm text-navy/40">Loading margin…</p>}
      {error && (
        <p className="rounded-lg bg-red/10 px-3 py-2 text-sm text-red">{error}</p>
      )}

      {data && !loading && (
        <>
          {/* Headline tiles */}
          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Tile label="Freight revenue" value={money(data.totals.revenueUSD)} sub={`${data.totals.count} shipments`} />
            <Tile label="Carrier cost" value={money(data.totals.costUSD)} sub={`${data.totals.ratedCount} rated`} />
            <Tile
              label="Gross margin"
              value={money(data.totals.marginUSD)}
              sub={data.totals.negativeCount > 0 ? `${data.totals.negativeCount} below cost` : 'none below cost'}
              tone={data.totals.marginUSD < 0 ? 'text-red' : undefined}
            />
            <Tile
              label="Effective markup"
              value={data.totals.markupX === null ? '—' : `${data.totals.markupX.toFixed(2)}×`}
              sub={`target ${target.toFixed(2)}×`}
              tone={markupTone(data.totals.markupX)}
            />
          </div>

          {/* The finding this tab exists to surface. Our markup is a multiple
              of COST while the carriers price off their own retail, and on
              express those diverge hard — so we can be well under the carrier's
              own asking price without knowing it. That gap is revenue available
              without ever charging more than the customer would pay direct. */}
          {data.totals.headroomUSD > 0 && data.totals.pctOfCarrierRetail !== null && (
            <div className="mb-4 rounded-lg border border-green-300 bg-green-50 px-4 py-3 text-xs text-green-900">
              <p className="font-bold">
                We charged {data.totals.pctOfCarrierRetail.toFixed(0)}% of what the carriers ask
                their own walk-in customers — {money(data.totals.headroomUSD)} under their published
                retail this period.
              </p>
              <p className="mt-1">
                Not a loss: the {target.toFixed(2)}× markup is applied to our cost, and carriers
                discount express far more than ground, so our price lands furthest below theirs on
                the fastest services. Check the per-service row below before changing anything.
              </p>
            </div>
          )}

          {data.totals.publishedCount > 0 && (
            <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-xs text-amber-900">
              <p className="font-bold">
                {data.totals.publishedCount} of {data.totals.ratedCount} rated shipments were quoted
                off a carrier LIST price, not our account rate.
              </p>
              <p className="mt-1">
                Those were marked up from a price we never pay. Set the carrier&apos;s incentive in
                Settings so a list-only quote still prices off a realistic cost.
              </p>
            </div>
          )}

          <div className="overflow-x-auto rounded-xl border border-navy/10 bg-white">
            <table className="w-full text-sm">
              <thead className="border-b border-navy/10 bg-cream text-[11px] uppercase tracking-wide text-navy/50">
                <tr>
                  <th className="px-4 py-2 text-left">Service</th>
                  <th className="px-4 py-2 text-left">Carrier</th>
                  <th className="px-4 py-2 text-right">Shipments</th>
                  <th className="px-4 py-2 text-right">Freight rev.</th>
                  <th className="px-4 py-2 text-right">Carrier cost</th>
                  <th className="px-4 py-2 text-right">Margin</th>
                  <th className="px-4 py-2 text-right">Markup</th>
                  <th className="px-4 py-2 text-right">% of carrier retail</th>
                  <th className="px-4 py-2 text-left">Quote source</th>
                  <th className="px-4 py-2 text-right">Flags</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={10} className="px-4 py-6 text-center text-navy/40">
                      No shipments in this period.
                    </td>
                  </tr>
                )}
                {rows.map((r) => (
                  <tr key={`${r.carrier}-${r.serviceClass}`} className="border-b border-navy/5">
                    <td className="px-4 py-3 font-semibold text-navy">
                      {SERVICE_CLASS_LABELS[r.serviceClass]}
                    </td>
                    <td className="px-4 py-3 text-navy/60">{r.carrierLabel}</td>
                    <td className="px-4 py-3 text-right text-navy/60">
                      {r.count}
                      {r.ratedCount < r.count && (
                        <span className="block text-[10px] text-navy/30">{r.ratedCount} rated</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right text-navy/70">{money(r.revenueUSD)}</td>
                    <td className="px-4 py-3 text-right text-navy/70">
                      {r.ratedCount === 0 ? <span className="text-navy/25">n/a</span> : money(r.costUSD)}
                    </td>
                    <td className={`px-4 py-3 text-right ${r.marginUSD < 0 ? 'font-bold text-red' : 'text-navy'}`}>
                      {r.ratedCount === 0 ? <span className="text-navy/25">n/a</span> : money(r.marginUSD)}
                      {r.negativeCount > 0 && (
                        <span className="block text-[10px] font-semibold text-red">
                          {r.negativeCount} below cost
                        </span>
                      )}
                    </td>
                    <td className={`px-4 py-3 text-right ${markupTone(r.markupX)}`}>
                      {r.markupX === null ? 'n/a' : `${r.markupX.toFixed(2)}×`}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {r.pctOfCarrierRetail === null ? (
                        <span className="text-navy/25">n/a</span>
                      ) : (
                        <>
                          <span
                            className={
                              r.pctOfCarrierRetail < 75
                                ? 'font-bold text-green-700'
                                : 'font-semibold text-navy'
                            }
                          >
                            {r.pctOfCarrierRetail.toFixed(0)}%
                          </span>
                          {r.listedRetailUSD > r.listedRevenueUSD && (
                            <span className="block text-[10px] text-navy/35">
                              {money(r.listedRetailUSD - r.listedRevenueUSD)} under
                            </span>
                          )}
                        </>
                      )}
                    </td>
                    <td className="px-4 py-3 text-[11px]">
                      {r.ratedCount === 0 ? (
                        <span className="text-navy/25">no rating returned</span>
                      ) : (
                        <span className="flex flex-wrap gap-1">
                          {r.publishedCount > 0 && (
                            <span className="rounded-full bg-amber-100 px-1.5 py-0.5 font-bold text-amber-700">
                              {r.publishedCount} list
                            </span>
                          )}
                          {r.negotiatedCount > 0 && (
                            <span className="rounded-full bg-green-100 px-1.5 py-0.5 font-bold text-green-700">
                              {r.negotiatedCount} account
                            </span>
                          )}
                          {r.unknownSourceCount > 0 && (
                            <span className="rounded-full bg-navy/5 px-1.5 py-0.5 text-navy/40">
                              {r.unknownSourceCount} unknown
                            </span>
                          )}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right text-[11px]">
                      {r.aboveCarrierRetailCount > 0 && (
                        <span
                          className="block font-semibold text-amber-700"
                          title="We charged more than the carrier's own published retail on these — easy for a customer to price-check."
                        >
                          {r.aboveCarrierRetailCount} over retail
                        </span>
                      )}
                      {r.overriddenCount > 0 && (
                        <span className="block text-navy/40" title="Freight price set by hand at the counter">
                          {r.overriddenCount} manual
                        </span>
                      )}
                      {r.aboveCarrierRetailCount === 0 && r.overriddenCount === 0 && (
                        <span className="text-navy/20">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Both caveats are load-bearing: without them these figures read as a
              final margin when they are neither complete nor settled. */}
          <div className="mt-3 space-y-1 text-[11px] leading-relaxed text-navy/40">
            {data.unratedCount > 0 && (
              <p>
                <strong>{data.unratedCount} shipments show no cost.</strong> USPS and DHL label
                responses carry no rating, so their margin is unknown and is excluded from every
                margin, markup and cost figure above rather than averaged in.
              </p>
            )}
            <p>
              <strong>Carrier post-audit adjustments are not included.</strong> Reweighs,
              dimensional re-rates and address corrections land on the weekly invoice days after the
              label. Treat these figures as a floor on the damage, not a final reconciliation.
            </p>
          </div>
        </>
      )}
    </div>
  );
}

function Tile({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: string;
}) {
  return (
    <div className="rounded-xl border border-navy/10 bg-white px-4 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-navy/40">{label}</p>
      <p className={`mt-0.5 text-xl font-extrabold ${tone ?? 'text-navy'}`}>{value}</p>
      {sub && <p className="text-[11px] text-navy/35">{sub}</p>}
    </div>
  );
}
