"use client";

import type { CarrierResult, ShippingRate } from '../../types/shipping';

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
                <li key={rate.serviceCode}>
                  <button
                    type="button"
                    onClick={() => onSelectRate(rate)}
                    className={`w-full rounded-lg border px-3 py-2 text-left transition-all ${
                      selectedRateCode === rate.serviceCode
                        ? 'border-[#4D148C] bg-[#4D148C]/5 ring-1 ring-[#4D148C]'
                        : 'border-navy/10 hover:border-[#4D148C]/30 hover:bg-[#4D148C]/5'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-navy">{rate.serviceName}</span>
                      <span className="text-base font-bold text-[#4D148C]">
                        ${rate.totalChargeUSD.toFixed(2)}
                      </span>
                    </div>
                    {(rate.estimatedDays || rate.deliveryDate) && (
                      <p className="mt-0.5 text-xs text-navy/40">
                        {rate.estimatedDays
                          ? `~${rate.estimatedDays} day${rate.estimatedDays !== 1 ? 's' : ''}`
                          : ''}
                        {rate.deliveryDate ? ` · ${rate.deliveryDate}` : ''}
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
