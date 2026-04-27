"use client";

import { useState, useEffect } from 'react';
import type { SelectedRate, InsuranceOption, ShippingRate, CarrierKey } from '../types/shipping';

interface Props {
  carrier: CarrierKey;
  rate: ShippingRate;
  /** Current declared value from the shipment form */
  declaredValueUSD: number;
  customerName: string;
  customerEmail: string;
  onConfirm: (selected: Pick<SelectedRate, 'insurance'>) => void;
  onClose: () => void;
}

const CARRIER_META: Record<
  CarrierKey,
  { label: string; color: string; logo: string }
> = {
  fedex:  { label: 'FedEx',        color: '#4D148C', logo: 'Fed\u200BEx' },
  ups:    { label: 'UPS',          color: '#351C15', logo: 'UPS'          },
  usps:   { label: 'USPS',         color: '#004B87', logo: 'USPS'         },
  dhl:    { label: 'DHL Express',  color: '#D40511', logo: 'DHL'          },
};

/** Insurance premium = 10% of declared value, minimum $1.00 */
function calcPremium(valueUSD: number): number {
  if (valueUSD <= 0) return 0;
  return Math.max(1, Math.round(valueUSD * 0.1 * 100) / 100);
}

export default function CarrierDetailModal({
  carrier,
  rate,
  declaredValueUSD,
  customerName,
  customerEmail,
  onConfirm,
  onClose,
}: Props) {
  const meta = CARRIER_META[carrier];
  const [insEnabled, setInsEnabled] = useState(declaredValueUSD > 0);
  const [insValue, setInsValue] = useState(declaredValueUSD > 0 ? declaredValueUSD : 0);

  const premium = insEnabled ? calcPremium(insValue) : 0;
  const total = rate.totalChargeUSD + premium;

  // Keep insEnabled on when value is set
  useEffect(() => {
    if (insValue > 0) setInsEnabled(true);
  }, [insValue]);

  function handleConfirm() {
    const insurance: InsuranceOption = {
      enabled: insEnabled,
      valueUSD: insEnabled ? insValue : 0,
      premiumUSD: premium,
    };
    onConfirm({ insurance });
  }

  const inputCls =
    'w-full rounded-lg border border-navy/20 bg-white px-3 py-2 text-sm text-navy ' +
    'placeholder-navy/30 focus:border-blue focus:outline-none focus:ring-1 focus:ring-blue ' +
    'disabled:bg-cream disabled:text-navy/40';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy/60 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl">
        {/* Header */}
        <div
          className="flex items-center justify-between px-6 py-4"
          style={{ backgroundColor: meta.color }}
        >
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-white/60">
              Carrier Details
            </p>
            <h3 className="text-lg font-bold text-white">{meta.label}</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-white/60 transition-colors hover:bg-white/20 hover:text-white"
          >
            ✕
          </button>
        </div>

        <div className="px-6 py-5 space-y-5">
          {/* Service summary */}
          <div className="rounded-xl bg-cream p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-navy/40">
              {meta.label}
            </p>
            <div className="mt-1 flex items-end justify-between">
              <div>
                <p className="text-base font-semibold text-navy">{rate.serviceName}</p>
                {rate.estimatedDays && (
                  <p className="text-xs text-navy/50">
                    ~{rate.estimatedDays} day{rate.estimatedDays !== 1 ? 's' : ''} transit
                    {rate.deliveryDate ? ` · Est. ${rate.deliveryDate}` : ''}
                  </p>
                )}
              </div>
              <span className="text-2xl font-extrabold text-navy">
                ${rate.totalChargeUSD.toFixed(2)}
              </span>
            </div>
          </div>

          {/* Customer info */}
          <div className="space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-navy/50">Customer</span>
              <span className="font-medium text-navy">{customerName || '—'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-navy/50">Email</span>
              <span className="font-medium text-navy">{customerEmail || '—'}</span>
            </div>
          </div>

          {/* Insurance toggle */}
          <div className="rounded-xl border border-navy/10 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-navy">Shipping Insurance</p>
                <p className="text-xs text-navy/50">10% of declared value ($1 min)</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setInsEnabled((v) => !v);
                  if (!insEnabled && insValue === 0) setInsValue(declaredValueUSD > 0 ? declaredValueUSD : 0);
                }}
                className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors focus:outline-none ${
                  insEnabled ? 'bg-blue' : 'bg-navy/20'
                }`}
                role="switch"
                aria-checked={insEnabled}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow ring-0 transition-transform ${
                    insEnabled ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            {insEnabled && (
              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-navy/50">
                  Declared Value (USD)
                </label>
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  className={inputCls}
                  value={insValue || ''}
                  onChange={(e) => setInsValue(parseFloat(e.target.value) || 0)}
                  placeholder="0.00"
                />
                {insValue > 0 && (
                  <p className="mt-1.5 text-xs text-navy/50">
                    Insurance premium:{' '}
                    <span className="font-semibold text-navy">${premium.toFixed(2)}</span>
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Total */}
          <div className="flex items-center justify-between rounded-xl bg-cream px-4 py-3">
            <span className="text-sm font-semibold text-navy/60">Total to Charge</span>
            <span className="text-2xl font-extrabold text-navy">${total.toFixed(2)}</span>
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-3 border-t border-navy/10 px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-lg border border-navy/20 px-4 py-2.5 text-sm font-medium text-navy/70 transition-colors hover:bg-cream"
          >
            Back
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            className="flex-1 rounded-lg px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-all active:scale-95"
            style={{ backgroundColor: meta.color }}
          >
            Add to Cart — ${total.toFixed(2)}
          </button>
        </div>
      </div>
    </div>
  );
}
