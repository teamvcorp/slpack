"use client";

import { useState, useCallback } from 'react';
import ShipmentForm from '../components/ShipmentForm';
import FedExPanel from '../components/carriers/FedExPanel';
import UPSPanel from '../components/carriers/UPSPanel';
import USPSPanel from '../components/carriers/USPSPanel';
import DHLPanel from '../components/carriers/DHLPanel';
import CarrierDetailModal from '../components/CarrierDetailModal';
import StripeCheckout from '../components/StripeCheckout';
import ShippingLabelModal from '../components/ShippingLabelModal';
import type {
  ShipmentInput,
  CarrierResult,
  CarrierKey,
  ShippingRate,
  CartItem,
  CartResult,
  InsuranceOption,
} from '../types/shipping';

const BLANK: Omit<CarrierResult, 'carrier'> = {
  rates: [],
  error: null,
  loading: false,
  lastFetched: null,
};

const INITIAL_RESULTS: Record<CarrierKey, CarrierResult> = {
  fedex: { carrier: 'fedex', ...BLANK },
  ups: { carrier: 'ups', ...BLANK },
  usps: { carrier: 'usps', ...BLANK },
  dhl: { carrier: 'dhl', ...BLANK },
};

const CARRIER_LABELS: Record<CarrierKey, string> = {
  fedex: 'FedEx',
  ups: 'UPS',
  usps: 'USPS',
  dhl: 'DHL Express',
};

const CARRIER_COLORS: Record<CarrierKey, string> = {
  fedex: '#4D148C',
  ups: '#351C15',
  usps: '#004B87',
  dhl: '#D40511',
};

export default function ShippingComparisonPage() {
  const [results, setResults] = useState<Record<CarrierKey, CarrierResult>>(INITIAL_RESULTS);
  const [currentShipment, setCurrentShipment] = useState<ShipmentInput | null>(null);
  const [cart, setCart] = useState<CartItem[]>([]);
  // Modal flow: null → 'carrier-detail' → back (item added to cart) → 'checkout' → 'label'
  const [modalStep, setModalStep] = useState<'carrier-detail' | 'checkout' | 'label' | null>(null);
  const [previewCarrier, setPreviewCarrier] = useState<{ carrier: CarrierKey; rate: ShippingRate } | null>(null);
  const [cartResults, setCartResults] = useState<CartResult[] | null>(null);
  const [anyLoading, setAnyLoading] = useState(false);
  const [formKey, setFormKey] = useState(0);
  const [retailMode, setRetailMode] = useState(false);

  const RETAIL_MULTIPLIER = 1.3;

  const markLoading = useCallback((carrier: CarrierKey) => {
    setResults((prev) => ({
      ...prev,
      [carrier]: { ...prev[carrier], loading: true, error: null, rates: [] },
    }));
  }, []);

  const setResult = useCallback(
    (carrier: CarrierKey, rates: ShippingRate[], error: string | null) => {
      setResults((prev) => ({
        ...prev,
        [carrier]: {
          ...prev[carrier],
          loading: false,
          rates,
          error,
          lastFetched: new Date().toLocaleTimeString(),
        },
      }));
    },
    []
  );

  async function fetchCarrier(
    carrier: CarrierKey,
    shipment: ShipmentInput
  ): Promise<void> {
    markLoading(carrier);
    try {
      const res = await fetch(`/api/shipping/${carrier}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(shipment),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        setResult(carrier, [], String(data.error ?? `HTTP ${res.status}`));
      } else {
        setResult(carrier, data.rates ?? [], null);
      }
    } catch (err: unknown) {
      setResult(
        carrier,
        [],
        err instanceof Error ? err.message : 'Network error'
      );
    }
  }

  async function handleCompare(shipment: ShipmentInput) {
    setCurrentShipment(shipment);
    setModalStep(null);
    setAnyLoading(true);

    // All four carriers fetched concurrently — each panel updates independently
    await Promise.all([
      fetchCarrier('fedex', shipment),
      fetchCarrier('ups', shipment),
      fetchCarrier('usps', shipment),
      fetchCarrier('dhl', shipment),
    ]);

    setAnyLoading(false);
  }

  function handleSelectRate(carrier: CarrierKey, rate: ShippingRate) {
    if (!currentShipment) return;
    const chargeRate = retailMode
      ? { ...rate, totalChargeUSD: Math.round(rate.totalChargeUSD * RETAIL_MULTIPLIER * 100) / 100 }
      : rate;
    setPreviewCarrier({ carrier, rate: chargeRate });
    setModalStep('carrier-detail');
  }

  function handleDetailConfirm({ insurance }: { insurance: InsuranceOption }) {
    if (!previewCarrier || !currentShipment) return;
    const newItem: CartItem = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      carrier: previewCarrier.carrier,
      rate: previewCarrier.rate,
      shipment: currentShipment,
      insurance,
    };
    setCart((prev) => [...prev, newItem]);
    setPreviewCarrier(null);
    setModalStep(null);
  }

  function handleRemoveCartItem(id: string) {
    setCart((prev) => prev.filter((i) => i.id !== id));
  }

  function handleAddAnother() {
    // Keep form as-is (address reuse) but clear rate results so staff can get fresh rates
    setResults(INITIAL_RESULTS);
    setCurrentShipment(null);
    setFormKey((k) => k + 1);
  }

  function handlePaymentSuccess(results: CartResult[]) {
    setCartResults(results);
    setModalStep('label');
  }

  function handleLabelDone() {
    setCart([]);
    setPreviewCarrier(null);
    setCartResults(null);
    setModalStep(null);
    setCurrentShipment(null);
    setResults(INITIAL_RESULTS);
    setFormKey((k) => k + 1);
  }

  function closeAll() {
    setModalStep(null);
  }

  const cartTotal = cart.reduce(
    (s, i) => s + i.rate.totalChargeUSD + (i.insurance?.premiumUSD ?? 0),
    0
  );

  return (
    <div>
      {/* Page heading */}
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-navy">Shipping Rate Comparison</h1>
          <p className="mt-1 text-sm text-navy/50">
            Add one or more packages to the cart, then checkout with card or cash in a single transaction.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setRetailMode((v) => !v)}
          className={`mt-1 flex shrink-0 items-center gap-2 rounded-full border px-4 py-1.5 text-sm font-semibold transition-all ${
            retailMode
              ? 'border-green-600 bg-green-600 text-white shadow-sm'
              : 'border-navy/20 bg-white text-navy/60 hover:border-navy/40'
          }`}
        >
          <span className={`h-2 w-2 rounded-full ${retailMode ? 'bg-white' : 'bg-navy/30'}`} />
          {retailMode ? 'Retail +30%' : 'Cost Price'}
        </button>
      </div>

      {/* Shipment form */}
      <ShipmentForm key={formKey} onSubmit={handleCompare} loading={anyLoading} />

      {/* Carrier panels — 1 col mobile, 2 col tablet, 4 col desktop */}
      <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <FedExPanel
          result={results.fedex}
          onSelectRate={(r) => handleSelectRate('fedex', r)}
          selectedRateCode={null}
          retailMode={retailMode}
        />
        <UPSPanel
          result={results.ups}
          onSelectRate={(r) => handleSelectRate('ups', r)}
          selectedRateCode={null}
          retailMode={retailMode}
        />
        <USPSPanel
          result={results.usps}
          onSelectRate={(r) => handleSelectRate('usps', r)}
          selectedRateCode={null}
          retailMode={retailMode}
        />
        <DHLPanel
          result={results.dhl}
          onSelectRate={(r) => handleSelectRate('dhl', r)}
          selectedRateCode={null}
          retailMode={retailMode}
        />
      </div>

      {/* Cart panel */}
      {cart.length > 0 && (
        <div className="mt-5 rounded-xl border border-navy/10 bg-white p-5 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-bold uppercase tracking-wider text-navy">
              Cart — {cart.length} Package{cart.length !== 1 ? 's' : ''}
            </h2>
            <button
              type="button"
              onClick={handleAddAnother}
              className="rounded-lg border border-navy/20 px-3 py-1.5 text-xs font-semibold text-navy/70 transition-colors hover:bg-cream"
            >
              + Add Another Package
            </button>
          </div>

          <div className="space-y-2">
            {cart.map((item, idx) => {
              const itemTotal = item.rate.totalChargeUSD + (item.insurance?.premiumUSD ?? 0);
              const color = CARRIER_COLORS[item.carrier];
              return (
                <div
                  key={item.id}
                  className="flex items-start justify-between gap-3 rounded-lg border border-navy/10 bg-cream px-4 py-3"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color }}>
                      Pkg {idx + 1} · {CARRIER_LABELS[item.carrier]}
                    </p>
                    <p className="text-sm font-semibold text-navy">{item.rate.serviceName}</p>
                    <p className="text-xs text-navy/50 truncate">
                      {item.shipment.destStreet && `${item.shipment.destStreet}, `}
                      {item.shipment.destCity || item.shipment.destZip}
                      {item.shipment.destState ? `, ${item.shipment.destState}` : ''}
                      {' · '}{item.shipment.weightLbs} lbs
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-base font-extrabold text-navy">${itemTotal.toFixed(2)}</span>
                    <button
                      type="button"
                      onClick={() => handleRemoveCartItem(item.id)}
                      className="rounded-lg p-1 text-navy/30 transition-colors hover:bg-red/10 hover:text-red"
                      title="Remove"
                    >
                      ✕
                    </button>
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
            <button
              type="button"
              onClick={() => setModalStep('checkout')}
              className="rounded-lg bg-blue px-6 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-navy active:scale-95"
            >
              Checkout ({cart.length}) →
            </button>
          </div>
        </div>
      )}

      {/* No-rates prompt when form is ready but no items in cart yet */}
      {cart.length === 0 && currentShipment && !anyLoading && (
        <p className="mt-4 text-center text-sm text-navy/40">
          Select a rate above to add a package to the cart.
        </p>
      )}

      {/* Carrier detail modal */}
      {modalStep === 'carrier-detail' && previewCarrier && currentShipment && (
        <CarrierDetailModal
          carrier={previewCarrier.carrier}
          rate={previewCarrier.rate}
          declaredValueUSD={currentShipment.declaredValueUSD}
          customerName={currentShipment.customerName}
          customerEmail={currentShipment.customerEmail}
          onConfirm={handleDetailConfirm}
          onClose={closeAll}
        />
      )}

      {/* Checkout modal */}
      {modalStep === 'checkout' && cart.length > 0 && (
        <StripeCheckout
          cart={cart}
          onClose={closeAll}
          onSuccess={handlePaymentSuccess}
        />
      )}

      {/* Label modal */}
      {modalStep === 'label' && cartResults && cartResults.length > 0 && (
        <ShippingLabelModal
          results={cartResults}
          onClose={handleLabelDone}
        />
      )}
    </div>
  );
}
