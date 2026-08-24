"use client";

import { useState, useCallback, useEffect } from 'react';
import IntlShipmentForm from '../components/intl/IntlShipmentForm';
import CustomsFormModal from '../components/intl/CustomsFormModal';
import IntlDocumentsModal from '../components/intl/IntlDocumentsModal';
import FedExPanel from '../components/carriers/FedExPanel';
import UPSPanel from '../components/carriers/UPSPanel';
import CarrierDetailModal from '../components/CarrierDetailModal';
import StripeCheckout from '../components/StripeCheckout';
import StaleSessionBanner from '../components/StaleSessionBanner';
import { carrierAnchoredPrice } from '@/lib/shippingPricing';
import {
  DEFAULT_CARRIER_INCENTIVES,
  costBasisUSD,
  incentiveFor,
  normalizeCarrierIncentives,
  type CarrierIncentives,
} from '@/lib/carrierIncentive';
import { classifyService } from '@/lib/serviceClass';
import { isQuoteStale } from '@/lib/appVersion';
import type {
  ShipmentInput,
  CarrierResult,
  ShippingRate,
  CartItem,
  CartResult,
  InsuranceOption,
} from '../types/shipping';
import type { IntlCartItem, IntlShipmentInput, CustomsInfo } from '../types/shippingIntl';

// Only FedEx + UPS support the international flow here.
type IntlCarrier = 'fedex' | 'ups';

const BLANK: Omit<CarrierResult, 'carrier'> = { rates: [], error: null, loading: false, lastFetched: null };
const INITIAL_RESULTS: Record<IntlCarrier, CarrierResult> = {
  fedex: { carrier: 'fedex', ...BLANK },
  ups: { carrier: 'ups', ...BLANK },
};

const CARRIER_LABELS: Record<string, string> = { fedex: 'FedEx', ups: 'UPS' };
const CARRIER_COLORS: Record<string, string> = { fedex: '#4D148C', ups: '#351C15' };

type ModalStep = 'customs' | 'carrier-detail' | 'checkout' | 'label' | null;

export default function IntlShippingPage() {
  const [results, setResults] = useState<Record<IntlCarrier, CarrierResult>>(INITIAL_RESULTS);
  const [currentShipment, setCurrentShipment] = useState<ShipmentInput | null>(null);
  const [cart, setCart] = useState<IntlCartItem[]>([]);
  const [modalStep, setModalStep] = useState<ModalStep>(null);
  const [previewCarrier, setPreviewCarrier] = useState<{
    carrier: IntlCarrier;
    rate: ShippingRate;
    /** Our real cost for this rate — drives the modal's floor and recommendation. */
    costBasis: number;
  } | null>(null);
  // Our discount off each carrier's list price, from Settings. Defaults assume
  // NO discount, which over-prices rather than under-prices if the fetch fails.
  const [incentives, setIncentives] = useState<CarrierIncentives>(DEFAULT_CARRIER_INCENTIVES);
  const [pendingCustoms, setPendingCustoms] = useState<CustomsInfo | null>(null);
  const [cartResults, setCartResults] = useState<CartResult[] | null>(null);
  const [anyLoading, setAnyLoading] = useState(false);
  const [formKey, setFormKey] = useState(0);
  // Staleness guards — see lib/appVersion (same rules as the domestic page).
  const [quotedAt, setQuotedAt] = useState<number | null>(null);
  const [serverBuildId, setServerBuildId] = useState<string | null>(null);

  const markLoading = useCallback((carrier: IntlCarrier) => {
    setResults((prev) => ({ ...prev, [carrier]: { ...prev[carrier], loading: true, error: null, rates: [] } }));
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/admin/settings/carrier-incentives')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled && d?.incentives) setIncentives(normalizeCarrierIncentives(d.incentives));
      })
      .catch(() => {
        /* keep the zero defaults — a failed fetch must not invent a discount */
      });
    return () => { cancelled = true; };
  }, []);

  /** Attach our real cost to each rate once, so panel/modal/cart never disagree. */
  const withCostBasis = useCallback(
    (carrier: IntlCarrier, rates: ShippingRate[]): ShippingRate[] =>
      rates.map((rate) => ({
        ...rate,
        costBasisUSD: costBasisUSD({
          accountUSD: rate.rateSource === 'negotiated' ? rate.totalChargeUSD : null,
          listUSD: rate.listPriceUSD,
          incentivePct: incentiveFor(incentives, carrier, classifyService(rate.serviceName)),
          quotedUSD: rate.totalChargeUSD,
        }),
      })),
    [incentives]
  );

  const setResult = useCallback((carrier: IntlCarrier, rates: ShippingRate[], error: string | null) => {
    setResults((prev) => ({
      ...prev,
      [carrier]: { ...prev[carrier], loading: false, rates: withCostBasis(carrier, rates), error, lastFetched: new Date().toLocaleTimeString() },
    }));
  }, [withCostBasis]);

  async function fetchCarrier(carrier: IntlCarrier, shipment: ShipmentInput) {
    markLoading(carrier);
    try {
      const res = await fetch(`/api/shipping/intl/${carrier}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(shipment),
      });
      const data = await res.json();
      if (typeof data.buildId === 'string') setServerBuildId(data.buildId);
      if (!res.ok || data.error) {
        setResult(carrier, [], String(data.error ?? `HTTP ${res.status}`));
      } else {
        setResult(carrier, data.rates ?? [], null);
      }
    } catch (err: unknown) {
      setResult(carrier, [], err instanceof Error ? err.message : 'Network error');
    }
  }

  async function handleCompare(shipment: ShipmentInput) {
    setCurrentShipment(shipment);
    setQuotedAt(Date.now());
    setModalStep(null);
    setAnyLoading(true);
    await Promise.all([fetchCarrier('fedex', shipment), fetchCarrier('ups', shipment)]);
    setAnyLoading(false);
  }

  function handleSelectRate(carrier: IntlCarrier, rate: ShippingRate) {
    if (!currentShipment) return;
    // Aged-out quote — force a re-compare instead of carting a stale price.
    if (isQuoteStale(quotedAt, Date.now())) {
      setResults(INITIAL_RESULTS);
      setQuotedAt(null);
      return;
    }
    // Price off our REAL cost, not the quoted figure — they differ whenever the
    // carrier returned no account rate. Matches what the panel displayed.
    const basis = rate.costBasisUSD ?? rate.totalChargeUSD;
    const chargeRate = {
      ...rate,
      totalChargeUSD: carrierAnchoredPrice(basis, rate.listPriceUSD),
    };
    setPreviewCarrier({ carrier, rate: chargeRate, costBasis: basis });
    setPendingCustoms(null);
    setModalStep('customs'); // customs BEFORE insurance
  }

  function handleCustomsConfirm(customs: CustomsInfo) {
    setPendingCustoms(customs);
    setModalStep('carrier-detail');
  }

  function handleDetailConfirm({
    insurance,
    freightUSD,
  }: {
    insurance: InsuranceOption;
    freightUSD?: number;
  }) {
    if (!previewCarrier || !currentShipment || !pendingCustoms) return;
    const shipment: IntlShipmentInput = { ...currentShipment, customs: pendingCustoms };
    // Staff may set the price by hand; the modal already refuses anything below
    // cost plus the margin floor, so an override here is a deliberate decision.
    const rate: ShippingRate =
      freightUSD !== undefined
        ? { ...previewCarrier.rate, totalChargeUSD: freightUSD }
        : previewCarrier.rate;
    const newItem: IntlCartItem = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      carrier: previewCarrier.carrier,
      rate,
      shipment,
      insurance,
      priceOverridden: freightUSD !== undefined,
      // Prepaid duties (DDP) collected from the customer, added to the total.
      dutiesUSD: pendingCustoms.dutiesCollectedUSD ?? 0,
    };
    setCart((prev) => [...prev, newItem]);
    setPreviewCarrier(null);
    setPendingCustoms(null);
    setModalStep(null);
  }

  function handleRemoveCartItem(id: string) {
    setCart((prev) => prev.filter((i) => i.id !== id));
  }

  function handleAddAnother() {
    setResults(INITIAL_RESULTS);
    setCurrentShipment(null);
    setFormKey((k) => k + 1);
  }

  function handlePaymentSuccess(res: CartResult[]) {
    setCartResults(res);
    setModalStep('label');
  }

  function handleDocsDone() {
    setCart([]);
    setPreviewCarrier(null);
    setPendingCustoms(null);
    setCartResults(null);
    setModalStep(null);
    setCurrentShipment(null);
    setResults(INITIAL_RESULTS);
    setFormKey((k) => k + 1);
  }

  const cartTotal = cart.reduce(
    (s, i) => s + i.rate.totalChargeUSD + (i.insurance?.premiumUSD ?? 0) + (i.dutiesUSD ?? 0),
    0
  );

  return (
    <div>
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-navy">International Shipping</h1>
          <p className="mt-1 text-sm text-navy/50">
            FedEx &amp; UPS cross-border shipping with commercial-invoice generation. Domestic shipping is unaffected.
          </p>
        </div>
        <span className="mt-1 shrink-0 rounded-full border border-navy/15 bg-cream px-4 py-1.5 text-xs font-semibold text-navy/50">
          Prices shown at cost and retail (+55%)
        </span>
      </div>

      <div className="mb-4">
        <StaleSessionBanner serverBuildId={serverBuildId} quotedAt={quotedAt} />
      </div>

      <IntlShipmentForm key={formKey} onSubmit={handleCompare} loading={anyLoading} />

      <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FedExPanel result={results.fedex} onSelectRate={(r) => handleSelectRate('fedex', r)} selectedRateCode={null} />
        <UPSPanel result={results.ups} onSelectRate={(r) => handleSelectRate('ups', r)} selectedRateCode={null} />
      </div>

      {/* Cart */}
      {cart.length > 0 && (
        <div className="mt-5 rounded-xl border border-navy/10 bg-white p-5 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-bold uppercase tracking-wider text-navy">
              Cart — {cart.length} Package{cart.length !== 1 ? 's' : ''}
            </h2>
            <button type="button" onClick={handleAddAnother} className="rounded-lg border border-navy/20 px-3 py-1.5 text-xs font-semibold text-navy/70 transition-colors hover:bg-cream">
              + Add Another Package
            </button>
          </div>

          <div className="space-y-2">
            {cart.map((item, idx) => {
              const itemTotal = item.rate.totalChargeUSD + (item.insurance?.premiumUSD ?? 0) + (item.dutiesUSD ?? 0);
              const color = CARRIER_COLORS[item.carrier];
              return (
                <div key={item.id} className="flex items-start justify-between gap-3 rounded-lg border border-navy/10 bg-cream px-4 py-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color }}>
                      Pkg {idx + 1} · {CARRIER_LABELS[item.carrier]}
                    </p>
                    <p className="text-sm font-semibold text-navy">{item.rate.serviceName}</p>
                    <p className="text-xs text-navy/50 truncate">
                      {item.shipment.destCity || item.shipment.destZip}, {item.shipment.destCountry}
                      {' · '}{item.shipment.weightLbs} lbs
                      {' · '}{item.shipment.customs.commodities.length} item{item.shipment.customs.commodities.length !== 1 ? 's' : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-base font-extrabold text-navy">${itemTotal.toFixed(2)}</span>
                    <button type="button" onClick={() => handleRemoveCartItem(item.id)} className="rounded-lg p-1 text-navy/30 transition-colors hover:bg-red/10 hover:text-red" title="Remove">✕</button>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-4 flex items-center justify-between">
            <div>
              <p className="text-xs text-navy/50">Total</p>
              <p className="text-2xl font-extrabold text-navy">${cartTotal.toFixed(2)}</p>
            </div>
            <button type="button" onClick={() => setModalStep('checkout')} className="rounded-lg bg-blue px-6 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-navy active:scale-95">
              Checkout ({cart.length}) →
            </button>
          </div>
        </div>
      )}

      {cart.length === 0 && currentShipment && !anyLoading && (
        <p className="mt-4 text-center text-sm text-navy/40">Select a rate above to declare customs and add a package.</p>
      )}

      {/* Customs modal */}
      {modalStep === 'customs' && previewCarrier && currentShipment && (
        <CustomsFormModal
          carrier={previewCarrier.carrier}
          carrierColor={CARRIER_COLORS[previewCarrier.carrier]}
          carrierLabel={CARRIER_LABELS[previewCarrier.carrier]}
          shipment={currentShipment}
          serviceCode={previewCarrier.rate.serviceCode}
          defaultValueUSD={currentShipment.declaredValueUSD}
          onConfirm={handleCustomsConfirm}
          onClose={() => { setModalStep(null); setPreviewCarrier(null); }}
        />
      )}

      {/* Insurance / declared value */}
      {modalStep === 'carrier-detail' && previewCarrier && currentShipment && (
        <CarrierDetailModal
          carrier={previewCarrier.carrier}
          rate={previewCarrier.rate}
          costBasisUSD={previewCarrier.costBasis}
          declaredValueUSD={currentShipment.declaredValueUSD}
          customerName={currentShipment.customerName}
          customerEmail={currentShipment.customerEmail}
          onConfirm={handleDetailConfirm}
          onClose={() => setModalStep('customs')}
        />
      )}

      {/* Checkout — reuses domestic StripeCheckout with the intl submit path */}
      {modalStep === 'checkout' && cart.length > 0 && (
        <StripeCheckout
          cart={cart as CartItem[]}
          submitPath="/api/shipping/intl/submit"
          onClose={() => setModalStep(null)}
          onSuccess={handlePaymentSuccess}
        />
      )}

      {/* Documents (label + commercial invoice) */}
      {modalStep === 'label' && cartResults && cartResults.length > 0 && (
        <IntlDocumentsModal results={cartResults} onClose={handleDocsDone} />
      )}
    </div>
  );
}
