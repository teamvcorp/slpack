"use client";

import { useState } from 'react';
import type { SelectedRate, InsuranceOption, ShippingRate, CarrierKey } from '../types/shipping';
import {
  retailDeclaredValueFee,
  maxDeclaredValue,
  isFedexGround,
  freightPrice,
  carrierAnchoredPrice,
  priceCeilingUSD,
  priceFloorUSD,
  MIN_SHIPPING_MARGIN_USD,
} from '@/lib/shippingPricing';

interface Props {
  carrier: CarrierKey;
  /** rate.totalChargeUSD is already the RETAIL price (marked up by the page). */
  rate: ShippingRate;
  /** What the shipment actually costs us — see lib/carrierIncentive.ts. */
  costBasisUSD: number;
  /** Current declared value from the shipment form */
  declaredValueUSD: number;
  /** Packaging from the shipment form — FedEx Envelope caps declared value at $100 */
  packaging?: string;
  customerName: string;
  customerEmail: string;
  /** freightUSD is present only when staff changed the price from the formula. */
  onConfirm: (selected: Pick<SelectedRate, 'insurance'> & { freightUSD?: number }) => void;
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

export default function CarrierDetailModal({
  carrier,
  rate,
  costBasisUSD,
  declaredValueUSD,
  packaging,
  customerName,
  customerEmail,
  onConfirm,
  onClose,
}: Props) {
  const meta = CARRIER_META[carrier];
  // Maximum declared value UPS/FedEx will cover for this service
  // (FedEx Ground: $1,000; FedEx Envelope: $100).
  const cap = maxDeclaredValue(carrier, rate.serviceName, packaging);
  const groundCapped = carrier === 'fedex' && isFedexGround(rate.serviceName);

  const [insEnabled, setInsEnabled] = useState(declaredValueUSD > 0);
  const [insValue, setInsValue] = useState(
    declaredValueUSD > 0 ? Math.min(cap, declaredValueUSD) : 0
  );
  const [insDescription, setInsDescription] = useState('');

  // ── Freight price: carrier retail by default, staff-adjustable ────────────
  // Shop policy: charge full carrier retail where we know it, never more.
  const recommended = carrierAnchoredPrice(costBasisUSD, rate.listPriceUSD);
  // What the cost-based markup alone would have asked — shown for context, since
  // on express it sits far below the carrier's own price.
  const markupOnly = freightPrice(costBasisUSD);
  // Never below what the carrier bills us plus the shop's minimum margin. A HARD
  // floor: a mistyped $5 on a $90 overnight has to be impossible.
  const priceFloor = priceFloorUSD(costBasisUSD);
  // Never above what the carrier would charge this customer directly. Null when
  // the carrier published no list price, so there's nothing to be undercut by.
  const priceCeiling = priceCeilingUSD(costBasisUSD, rate.listPriceUSD);

  const [freightText, setFreightText] = useState(rate.totalChargeUSD.toFixed(2));
  const parsedFreight = parseFloat(freightText);
  const freightUSD = Number.isFinite(parsedFreight) ? parsedFreight : NaN;

  // How far our price sits under what the carrier would charge this customer
  // directly. On express the carrier's own retail runs far above cost x 1.55, so
  // this gap is the headroom our cost-based markup can't see.
  const headroom =
    rate.listPriceUSD !== undefined && Number.isFinite(freightUSD)
      ? Math.round((rate.listPriceUSD - freightUSD) * 100) / 100
      : 0;
  const pctOfRetail =
    rate.listPriceUSD !== undefined && rate.listPriceUSD > 0 && Number.isFinite(freightUSD)
      ? (freightUSD / rate.listPriceUSD) * 100
      : 0;

  const belowFloor = Number.isFinite(freightUSD) && freightUSD < priceFloor;
  const invalidFreight = !Number.isFinite(freightUSD) || freightUSD <= 0;
  // Both bounds are hard blocks now: never below cost, never above what the
  // customer could pay the carrier directly.
  const aboveCeiling =
    priceCeiling !== null && Number.isFinite(freightUSD) && freightUSD > priceCeiling + 0.005;
  const priceBlocked = invalidFreight || belowFloor || aboveCeiling;
  // Only report an override when staff actually moved the number.
  const overridden =
    Number.isFinite(freightUSD) && Math.abs(freightUSD - rate.totalChargeUSD) > 0.005;

  // Declared-value (liability) coverage at retail — free up to $100, then the
  // carrier's tiered fee with the store markup applied (same 1.55x as freight).
  const premium = insEnabled ? retailDeclaredValueFee(insValue) : 0;
  const total = (Number.isFinite(freightUSD) ? freightUSD : rate.totalChargeUSD) + premium;

  function handleConfirm() {
    if (priceBlocked) return;
    const insurance: InsuranceOption = {
      enabled: insEnabled,
      valueUSD: insEnabled ? insValue : 0,
      premiumUSD: premium,
      description: insEnabled ? insDescription.trim() || undefined : undefined,
    };
    onConfirm({ insurance, freightUSD: overridden ? freightUSD : undefined });
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
                ${Number.isFinite(freightUSD) ? freightUSD.toFixed(2) : rate.totalChargeUSD.toFixed(2)}
              </span>
            </div>
          </div>

          {/* ── Freight price ──────────────────────────────────────────────
              All three numbers together: what the carrier bills us, what the
              carrier would charge this customer directly, and what we're
              charging. Staff can move the last one; the floor is enforced. */}
          <div className="rounded-xl border border-navy/10 p-4 space-y-3">
            <div className="space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-navy/50">Our carrier cost</span>
                <span className="font-medium text-navy">${costBasisUSD.toFixed(2)}</span>
              </div>
              {rate.listPriceUSD !== undefined && (
                <>
                  <div className="flex justify-between">
                    <span className="text-navy/50">{meta.label} suggested retail</span>
                    <span className="font-medium text-navy">${rate.listPriceUSD.toFixed(2)}</span>
                  </div>
                  {/* The headroom, spelled out. Our markup is a multiple of COST,
                      but the carrier prices off its own retail — on express the
                      two diverge sharply, and the gap is money we can price into
                      without ever exceeding what the customer would pay UPS. */}
                  {headroom > 0.005 && (
                    <div className="flex justify-between rounded-lg bg-green-50 px-2 py-1.5">
                      <span className="font-semibold text-green-800">
                        Room to {meta.label} retail
                      </span>
                      <span className="font-bold text-green-800">
                        ${headroom.toFixed(2)}
                        <span className="ml-1 font-normal">
                          ({pctOfRetail.toFixed(0)}% of retail)
                        </span>
                      </span>
                    </div>
                  )}
                </>
              )}
              {rate.rateSource === 'published' && (
                <p className="rounded-lg bg-amber-50 px-2 py-1.5 text-[11px] text-amber-800">
                  {meta.label} returned no account rate, so the cost above is estimated from list
                  using the incentive set in Settings.
                </p>
              )}
            </div>

            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-navy/50">
                Freight price to charge
              </label>
              <div className="flex gap-2">
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  className={`${inputCls} ${belowFloor || invalidFreight ? 'border-red ring-1 ring-red' : ''}`}
                  value={freightText}
                  onChange={(e) => setFreightText(e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => setFreightText(recommended.toFixed(2))}
                  disabled={Math.abs(recommended - (freightUSD || 0)) < 0.005}
                  className="shrink-0 rounded-lg border border-green-600/40 bg-green-50 px-3 py-2 text-xs font-semibold text-green-800 transition-colors hover:bg-green-100 disabled:opacity-40"
                  title={
                    rate.listPriceUSD !== undefined
                      ? `Full ${meta.label} retail — the most this customer would pay going direct`
                      : "The shop's standard markup on our cost"
                  }
                >
                  Retail ${recommended.toFixed(2)}
                </button>
                {/* Discounting toward cost-plus is a deliberate concession, so it
                    gets its own button rather than hiding behind manual entry. */}
                {markupOnly < recommended - 0.005 && (
                  <button
                    type="button"
                    onClick={() => setFreightText(markupOnly.toFixed(2))}
                    disabled={Math.abs(markupOnly - (freightUSD || 0)) < 0.005}
                    className="shrink-0 rounded-lg border border-navy/20 px-3 py-2 text-xs font-semibold text-navy/70 transition-colors hover:bg-cream disabled:opacity-40"
                    title="Drop to the cost-plus markup — a discount off carrier retail"
                  >
                    Cost+ ${markupOnly.toFixed(2)}
                  </button>
                )}
              </div>

              {belowFloor && (
                <p className="mt-1.5 text-[11px] font-semibold text-red">
                  Below cost — the minimum for this shipment is ${priceFloor.toFixed(2)}
                  {' '}(our ${costBasisUSD.toFixed(2)} cost plus the ${MIN_SHIPPING_MARGIN_USD} floor).
                </p>
              )}
              {invalidFreight && !belowFloor && (
                <p className="mt-1.5 text-[11px] font-semibold text-red">Enter a price.</p>
              )}
              {aboveCeiling && (
                <p className="mt-1.5 text-[11px] font-semibold text-red">
                  Above {meta.label}&apos;s own retail of ${priceCeiling?.toFixed(2)} — the customer
                  could pay less by going direct. That is the ceiling.
                </p>
              )}
              {overridden && !priceBlocked && (
                <p className="mt-1.5 text-[11px] text-navy/50">
                  Manual price — {meta.label} retail is ${recommended.toFixed(2)}.
                </p>
              )}
              {!overridden && !priceBlocked && rate.listPriceUSD !== undefined && (
                <p className="mt-1.5 text-[11px] text-navy/50">
                  Full {meta.label} retail. Cost-plus markup alone would be ${markupOnly.toFixed(2)}.
                </p>
              )}
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
                <p className="text-sm font-semibold text-navy">{meta.label} Declared Value Coverage</p>
                <p className="text-xs text-navy/50">Included up to $100, then tiered by declared value</p>
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
                  max={cap}
                  step={0.01}
                  className={inputCls}
                  value={insValue || ''}
                  onChange={(e) => {
                    const v = Math.min(cap, Math.max(0, parseFloat(e.target.value) || 0));
                    setInsValue(v);
                    if (v > 0) setInsEnabled(true);
                  }}
                  placeholder="0.00"
                />
                {insValue > 0 && insValue <= 100 && (
                  <p className="mt-1.5 text-xs text-navy/50">
                    Coverage: <span className="font-semibold text-navy">Included (up to $100)</span>
                  </p>
                )}
                {insValue > 100 && (
                  <p className="mt-1.5 text-xs text-navy/50">
                    Coverage fee:{' '}
                    <span className="font-semibold text-navy">${premium.toFixed(2)}</span>
                  </p>
                )}
                {groundCapped && (
                  <p className="mt-1 text-[11px] text-navy/40">
                    FedEx Ground coverage is capped at $1,000.
                  </p>
                )}

                <label className="mb-1 mt-3 block text-[11px] font-semibold uppercase tracking-wide text-navy/50">
                  What&apos;s being insured (optional)
                </label>
                <input
                  type="text"
                  className={inputCls}
                  value={insDescription}
                  onChange={(e) => setInsDescription(e.target.value)}
                  maxLength={120}
                  placeholder="e.g. Ceramic vase"
                />

                <p className="mt-2 text-[11px] text-navy/40">
                  Carrier liability coverage — not third-party insurance.
                </p>
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
            disabled={priceBlocked}
            className="flex-1 rounded-lg px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-all active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
            style={{ backgroundColor: meta.color }}
          >
            {belowFloor ? 'Price below cost' : `Add to Cart — $${total.toFixed(2)}`}
          </button>
        </div>
      </div>
    </div>
  );
}
