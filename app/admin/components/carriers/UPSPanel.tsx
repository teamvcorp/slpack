"use client";

import type { CarrierResult, ShippingRate } from '../../types/shipping';
import { carrierAnchoredPrice } from '@/lib/shippingPricing';

interface Props {
  result: CarrierResult;
  onSelectRate: (rate: ShippingRate) => void;
  selectedRateCode: string | null;
}

export default function UPSPanel({ result, onSelectRate, selectedRateCode }: Props) {
  const { loading, error, rates, lastFetched } = result;

  return (
    <div className="flex flex-col overflow-hidden rounded-xl border-2 border-[#351C15]/20 bg-white shadow-sm">
      {/* Brand header */}
      <div className="flex items-center justify-between bg-[#351C15] px-4 py-3">
        <span className="text-lg font-extrabold tracking-tight text-[#FFB500]">UPS</span>
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
                // their standard sibling (merged from the second UPS rate call).
                <li key={rate.serviceCode + (rate.saturdayDelivery ? '-SAT' : '')}>
                  <button
                    type="button"
                    onClick={() => onSelectRate(rate)}
                    className={`w-full rounded-lg border px-3 py-2 text-left transition-all ${
                      selectedRateCode === rate.serviceCode
                        ? 'border-[#351C15] bg-[#351C15]/5 ring-1 ring-[#351C15]'
                        : 'border-navy/10 hover:border-[#351C15]/30 hover:bg-[#351C15]/5'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-sm font-medium text-navy">
                        {/* Badge instead of the "— Saturday Delivery" name suffix (cart/receipts keep the full name) */}
                        {rate.serviceName.replace(' — Saturday Delivery', '')}
                        {rate.saturdayDelivery && (
                          <span className="ml-1.5 inline-block rounded-full bg-[#FFB500] px-1.5 py-0.5 align-middle text-[10px] font-bold leading-none text-[#351C15]">
                            SATURDAY
                          </span>
                        )}
                      </span>
                      <div className="shrink-0 text-right">
                        <div className="text-base font-bold text-[#351C15]">
                          ${carrierAnchoredPrice(rate.costBasisUSD ?? rate.totalChargeUSD, rate.listPriceUSD).toFixed(2)}
                          <span className="ml-1 text-[10px] font-semibold uppercase tracking-wide text-navy/40">Retail</span>
                        </div>
                        <div className="text-[11px] text-navy/40">
                          Cost ${(rate.costBasisUSD ?? rate.totalChargeUSD).toFixed(2)}
                        </div>
                        {/* The carrier's own published retail — what UPS would
                            charge this customer directly. Our true cost can never
                            exceed it, so it doubles as a sanity ceiling and a
                            competitive yardstick. Absent for USPS/DHL. */}
                        {rate.listPriceUSD !== undefined && (
                          <div className="text-[11px] text-navy/40">
                            UPS retail ${rate.listPriceUSD.toFixed(2)}
                          </div>
                        )}
                        {/* Simple Rate won for this parcel: same service to the
                            customer, lower cost to us. The price above does not
                            move — this line explains the extra margin. */}
                        {rate.simpleRate && (
                          <div className="text-[11px] font-semibold text-green-700">
                            Simple Rate {rate.simpleRate.tier} — saves $
                            {(
                              (rate.costBasisUSD ?? rate.totalChargeUSD) - rate.simpleRate.costUSD
                            ).toFixed(2)}
                          </div>
                        )}
                        {rate.simpleRate?.nearBoundary && (
                          <div
                            className="mt-0.5 inline-block rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold leading-none text-amber-700"
                            title="This box is within 5% of its Simple Rate tier cap. Re-measure before taping — UPS measures at the hub and bills the next tier up weeks later."
                          >
                            NEAR TIER LIMIT
                          </div>
                        )}
                        {/* UPS returned no NegotiatedRateCharges, so the "cost"
                            above is the public list price — the label will bill
                            our lower account rate, making retail overstated. */}
                        {rate.rateSource === 'published' && (
                          <div
                            className="mt-0.5 inline-block rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold leading-none text-amber-700"
                            title="No account rate returned — this is UPS's published list price, not what we actually pay. Retail is marked up off the higher number."
                          >
                            LIST RATE
                          </div>
                        )}
                      </div>
                    </div>
                    {(rate.estimatedDays || rate.deliveryDate) && (
                      <p className="mt-0.5 text-xs text-navy/40">
                        {/* Lead with the carrier's committed DATE — a bare "1 business
                            day" misreads as next-calendar-day on a Friday. */}
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
            <p><strong>Env vars:</strong> UPS_CLIENT_ID, UPS_CLIENT_SECRET, UPS_ACCOUNT_NUMBER</p>
            <p><strong>Sandbox flag:</strong> UPS_SANDBOX=true (default) / false for prod</p>
            <p><strong>Token:</strong> POST /security/v1/oauth/token (Basic auth)</p>
            <p><strong>Rates:</strong> POST /api/rating/v2403/Rate (RequestOption: Shop)</p>
            <p><strong>Sandbox:</strong> wwwcie.ups.com</p>
            <p><strong>Prod:</strong> onlinetools.ups.com</p>
            <p><strong>Note:</strong> Old &quot;Access Keys&quot; are deprecated — use Client ID/Secret</p>
          </div>
        </details>
      </div>
    </div>
  );
}
