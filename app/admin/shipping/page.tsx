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
  SelectedRate,
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

export default function ShippingComparisonPage() {
  const [results, setResults] = useState<Record<CarrierKey, CarrierResult>>(INITIAL_RESULTS);
  const [currentShipment, setCurrentShipment] = useState<ShipmentInput | null>(null);
  const [pendingRate, setPendingRate] = useState<SelectedRate | null>(null);
  // Modal flow: null → 'carrier-detail' → 'checkout' → 'label'
  const [modalStep, setModalStep] = useState<'carrier-detail' | 'checkout' | 'label' | null>(null);
  const [previewCarrier, setPreviewCarrier] = useState<{ carrier: CarrierKey; rate: ShippingRate } | null>(null);
  const [completedLabel, setCompletedLabel] = useState<{ tracking: string; base64: string | null; mimeType: string | null } | null>(null);
  const [anyLoading, setAnyLoading] = useState(false);

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
    setPendingRate(null);
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
    setPreviewCarrier({ carrier, rate });
    setModalStep('carrier-detail');
  }

  function handleDetailConfirm({ insurance }: Pick<SelectedRate, 'insurance'>) {
    if (!previewCarrier || !currentShipment) return;
    setPendingRate({
      carrier: previewCarrier.carrier,
      rate: previewCarrier.rate,
      shipment: currentShipment,
      insurance,
    });
    setModalStep('checkout');
  }

  function handlePaymentSuccess(tracking: string, base64: string | null, mimeType: string | null) {
    setCompletedLabel({ tracking, base64, mimeType });
    setModalStep('label');
  }

  function handleLabelDone() {
    setPendingRate(null);
    setPreviewCarrier(null);
    setCompletedLabel(null);
    setModalStep(null);
    setCurrentShipment(null);
    setResults(INITIAL_RESULTS);
  }

  function closeAll() {
    setModalStep(null);
  }

  const selectedCode = (carrier: CarrierKey) =>
    pendingRate?.carrier === carrier ? pendingRate.rate.serviceCode : null;

  return (
    <div>
      {/* Page heading */}
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-navy">Shipping Rate Comparison</h1>
        <p className="mt-1 text-sm text-navy/50">
          Enter package details below to fetch live rates from all four carriers at once.
          Select any rate, then charge the customer via Stripe.
        </p>
      </div>

      {/* Shipment form */}
      <ShipmentForm onSubmit={handleCompare} loading={anyLoading} />

      {/* Carrier panels — 1 col mobile, 2 col tablet, 4 col desktop */}
      <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <FedExPanel
          result={results.fedex}
          onSelectRate={(r) => handleSelectRate('fedex', r)}
          selectedRateCode={selectedCode('fedex')}
        />
        <UPSPanel
          result={results.ups}
          onSelectRate={(r) => handleSelectRate('ups', r)}
          selectedRateCode={selectedCode('ups')}
        />
        <USPSPanel
          result={results.usps}
          onSelectRate={(r) => handleSelectRate('usps', r)}
          selectedRateCode={selectedCode('usps')}
        />
        <DHLPanel
          result={results.dhl}
          onSelectRate={(r) => handleSelectRate('dhl', r)}
          selectedRateCode={selectedCode('dhl')}
        />
      </div>

      {/* Selected rate bar */}
      {pendingRate && (
        <div className="mt-5 flex flex-col items-start justify-between gap-3 rounded-xl border border-blue/20 bg-blue/5 px-5 py-4 sm:flex-row sm:items-center">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-blue">
              Selected Rate
            </p>
            <p className="mt-0.5 text-base font-semibold text-navy">
              {CARRIER_LABELS[pendingRate.carrier]} — {pendingRate.rate.serviceName}
            </p>
            {pendingRate.rate.estimatedDays && (
              <p className="text-xs text-navy/50">
                ~{pendingRate.rate.estimatedDays} day
                {pendingRate.rate.estimatedDays !== 1 ? 's' : ''} transit
              </p>
            )}
          </div>

          <div className="flex items-center gap-3">
            <span className="text-2xl font-extrabold text-navy">
              ${(pendingRate.rate.totalChargeUSD + (pendingRate.insurance?.premiumUSD ?? 0)).toFixed(2)}
            </span>
            <button
              type="button"
              onClick={() => { setPendingRate(null); setPreviewCarrier(null); setModalStep(null); }}
              className="rounded-lg border border-navy/20 px-3 py-1.5 text-sm text-navy/60 transition-colors hover:bg-cream"
            >
              Clear
            </button>
            <button
              type="button"
              onClick={() => setModalStep('checkout')}
              className="rounded-lg bg-blue px-5 py-2 text-sm font-semibold text-white shadow-sm transition-all hover:bg-navy active:scale-95"
            >
              Charge Customer
            </button>
          </div>
        </div>
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

      {/* Stripe checkout modal */}
      {modalStep === 'checkout' && pendingRate && (
        <StripeCheckout
          selected={pendingRate}
          onClose={closeAll}
          onSuccess={handlePaymentSuccess}
        />
      )}

      {/* Label modal */}
      {modalStep === 'label' && pendingRate && completedLabel && (
        <ShippingLabelModal
          selected={pendingRate}
          trackingNumber={completedLabel.tracking}
          labelBase64={completedLabel.base64}
          labelMimeType={completedLabel.mimeType}
          onClose={handleLabelDone}
        />
      )}
    </div>
  );
}
