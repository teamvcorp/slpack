"use client";

import type { CarrierResult, ShippingRate } from '../../types/shipping';
import { carrierAnchoredPrice } from '@/lib/shippingPricing';

interface Props {
  result: CarrierResult;
  onSelectRate: (rate: ShippingRate) => void;
  selectedRateCode: string | null;
}

export default function FedExPanel({ result, onSelectRate, selectedRateCode }: Props) {
  const { loading, error, rates, lastFetched } = result;

  return (
    <div className="flex flex-col overflow-hidden rounded-xl border-2 border-[#4D148C]/20 bg-white shadow-sm">
      {/* Brand header */}
      <div className="flex items-center justify-between bg-[#4D148C] px-4 py-3">
        <span className="text-lg font-extrabold tracking-tight">
          <span className="text-white">Fed</span>
          <span className="text-[#FF6600]">Ex</span>
        </span>
        <span className="rounded-full bg-white/20 px-2 py-0.5 text-[11px] text-white/80">
          REST · OAuth 2.0
        </span>
      </div>

      <div className="flex flex-1 flex-col p-4">
        {/* Status indicator */}
        <div className="mb-3 flex items-center gap-2 text-xs text-navy/50">
          <span
            className={`h-2 w-2 rounded-full ${
              loading
                ? 'animate-pulse bg-yellow-400'
                : error
                  ? 'bg-red'
                  : rates.length > 0
                    ? 'bg-green-500'
                    : 'bg-navy/20'
            }`}
          />
          {loading && <span>Fetching rates…</span>}
          {!loading && error && <span className="text-red">{error}</span>}
          {!loading && !error && rates.length === 0 && <span>Enter details and compare</span>}
          {!loading && !error && rates.length > 0 && (
            <span>{rates.length} service{rates.length !== 1 ? 's' : ''} found</span>
          )}
          {lastFetched && !loading && (
            <span className="ml-auto text-navy/30">{lastFetched}</span>
          )}
        </div>

        {/* Rate list */}
        {rates.length > 0 && (
          <ul className="space-y-2">
            {[...rates]
              .sort((a, b) => a.totalChargeUSD - b.totalChargeUSD)
              .map((rate) => (
                // Composite key: Saturday variants share the serviceCode with
                // their standard sibling (duplicate rateReplyDetails entries).
                <li key={rate.serviceCode + (rate.saturdayDelivery ? '-SAT' : '')}>
                  <button
                    type="button"
                    onClick={() => onSelectRate(rate)}
                    className={`w-full rounded-lg border px-3 py-2 text-left transition-all ${
                      selectedRateCode === rate.serviceCode
                        ? 'border-[#4D148C] bg-[#4D148C]/5 ring-1 ring-[#4D148C]'
                        : 'border-navy/10 hover:border-[#4D148C]/30 hover:bg-[#4D148C]/5'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-sm font-medium text-navy">
                        {/* Badge instead of the "— Saturday Delivery" name suffix (cart/receipts keep the full name) */}
                        {rate.serviceName.replace(' — Saturday Delivery', '')}
                        {rate.saturdayDelivery && (
                          <span className="ml-1.5 inline-block rounded-full bg-[#FF6600] px-1.5 py-0.5 align-middle text-[10px] font-bold leading-none text-white">
                            SATURDAY
                          </span>
                        )}
                      </span>
                      <div className="shrink-0 text-right">
                        <div className="text-base font-bold text-[#4D148C]">
                          ${carrierAnchoredPrice(rate.costBasisUSD ?? rate.totalChargeUSD, rate.listPriceUSD).toFixed(2)}
                          <span className="ml-1 text-[10px] font-semibold uppercase tracking-wide text-navy/40">Retail</span>
                        </div>
                        <div className="text-[11px] text-navy/40">
                          Cost ${(rate.costBasisUSD ?? rate.totalChargeUSD).toFixed(2)}
                        </div>
                        {/* FedEx returned no ACCOUNT rate, so this "cost" is the
                            public list price — the label will bill our lower
                            negotiated rate, making retail overstated. */}
                        {/* The carrier's own published retail — what FedEx would
                            charge this customer directly. Our true cost can never
                            exceed it, so it doubles as a sanity ceiling and a
                            competitive yardstick. Absent for USPS/DHL. */}
                        {rate.listPriceUSD !== undefined && (
                          <div className="text-[11px] text-navy/40">
                            FedEx retail ${rate.listPriceUSD.toFixed(2)}
                          </div>
                        )}
                        {rate.rateSource === 'published' && (
                          <div
                            className="mt-0.5 inline-block rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold leading-none text-amber-700"
                            title="No account rate returned — this is FedEx's published list price, not what we actually pay. Retail is marked up off the higher number."
                          >
                            LIST RATE
                          </div>
                        )}
                      </div>
                    </div>
                    {(rate.estimatedDays || rate.deliveryDate) && (
                      <p className="mt-0.5 text-xs text-navy/40">
                        {/* Lead with the carrier's committed DATE. A bare "1 business
                            day" reads as next-calendar-day (i.e. Saturday when quoting
                            on a Friday) while the carrier commits Monday — the exact
                            mix-up behind the Saturday-delivery incident. */}
                        {rate.deliveryDate
                          ? `Delivers ${rate.deliveryDate}`
                          : `${rate.estimatedDays} business day${rate.estimatedDays !== 1 ? 's' : ''} (Mon–Fri)`}
                        {rate.deliveryDate && rate.estimatedDays
                          ? ` · ${rate.estimatedDays} business day${rate.estimatedDays !== 1 ? 's' : ''}`
                          : ''}
                      </p>
                    )}
                  </button>
                </li>
              ))}
          </ul>
        )}

        {/* Troubleshooting accordion */}
        <details className="mt-auto pt-4 text-xs">
          <summary className="cursor-pointer select-none text-navy/30 hover:text-navy/50">
            Troubleshooting
          </summary>
          <div className="mt-2 space-y-1 rounded-lg bg-cream p-3 font-mono text-[11px] leading-relaxed text-navy/50">
            <p><strong>Env vars:</strong> FEDEX_CLIENT_ID, FEDEX_CLIENT_SECRET, FEDEX_ACCOUNT_NUMBER</p>
            <p><strong>Sandbox flag:</strong> FEDEX_SANDBOX=true (default) / false for prod</p>
            <p><strong>Token:</strong> POST /oauth/token (x-www-form-urlencoded)</p>
            <p><strong>Rates:</strong> POST /rate/v1/rates/quotes</p>
            <p><strong>Sandbox:</strong> apis-sandbox.fedex.com</p>
            <p><strong>Prod:</strong> apis.fedex.com</p>
            <p><strong>Deadline:</strong> REST migration required by June 1, 2026</p>
          </div>
        </details>
      </div>
    </div>
  );
}
