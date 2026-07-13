"use client";

import { useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { stashShippingCart } from '@/lib/comboHandoff';
import ShipmentForm from '../components/ShipmentForm';
import FedExPanel from '../components/carriers/FedExPanel';
import UPSPanel from '../components/carriers/UPSPanel';
import CarrierDetailModal from '../components/CarrierDetailModal';
import StripeCheckout from '../components/StripeCheckout';
import ShippingLabelModal from '../components/ShippingLabelModal';
import { retailPrice } from '@/lib/shippingPricing';
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
  const router = useRouter();
  const [results, setResults] = useState<Record<CarrierKey, CarrierResult>>(INITIAL_RESULTS);
  const [currentShipment, setCurrentShipment] = useState<ShipmentInput | null>(null);
  const [cart, setCart] = useState<CartItem[]>([]);
  // Modal flow: null → 'carrier-detail' → back (item added to cart) → 'checkout' → 'label'
  // 'address-guard' warns when checking out an address that wasn't validated.
  const [modalStep, setModalStep] = useState<'carrier-detail' | 'checkout' | 'label' | 'address-guard' | null>(null);
  // Destination address validated by a carrier or approved by staff (checkout gate).
  const [addressValidated, setAddressValidated] = useState(false);
  // True once rates have been fetched at least once (drives the "select a rate" hint).
  const [hasCompared, setHasCompared] = useState(false);
  // Signature of rate-affecting fields at Compare time — if these change afterward,
  // the shown rates are stale and we force a re-compare.
  const comparedSigRef = useRef<string>('');
  const [previewCarrier, setPreviewCarrier] = useState<{ carrier: CarrierKey; rate: ShippingRate } | null>(null);
  const [cartResults, setCartResults] = useState<CartResult[] | null>(null);
  const [anyLoading, setAnyLoading] = useState(false);
  const [formKey, setFormKey] = useState(0);

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

  // Only these fields change the rate quote; edits to them after Compare make
  // the shown rates stale. Contact fields (name/phone/email/attention) don't.
  function rateSignature(s: ShipmentInput): string {
    return JSON.stringify([
      s.originZip, s.destZip, s.destCity, s.destState, s.destCountry,
      s.residential, s.weightLbs, s.lengthIn, s.widthIn, s.heightIn,
    ]);
  }

  // Keep the shipment in sync with the live form so fields edited after Compare
  // (e.g. recipient name/phone) still reach the cart/label. If a rate-affecting
  // field changed, drop the stale rates so staff re-compare before checkout.
  function handleFormChange(shipment: ShipmentInput) {
    setCurrentShipment(shipment);
    if (hasCompared && rateSignature(shipment) !== comparedSigRef.current) {
      setHasCompared(false);
      setResults(INITIAL_RESULTS);
    }
  }

  async function handleCompare(shipment: ShipmentInput) {
    setCurrentShipment(shipment);
    comparedSigRef.current = rateSignature(shipment);
    setHasCompared(true);
    setModalStep(null);
    setAnyLoading(true);

    // Active carriers fetched concurrently — each panel updates independently
    await Promise.all([
      fetchCarrier('fedex', shipment),
      fetchCarrier('ups', shipment),
    ]);

    setAnyLoading(false);
  }

  function handleSelectRate(carrier: CarrierKey, rate: ShippingRate) {
    if (!currentShipment) return;
    // Customers are always charged retail (carrier cost × store markup).
    const chargeRate = { ...rate, totalChargeUSD: retailPrice(rate.totalChargeUSD) };
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
    setAddressValidated(false);
    setHasCompared(false);
    setFormKey((k) => k + 1);
  }

  // Checkout gate: require the address to be validated (carrier) or approved
  // (staff) first — prevents shipping unverified addresses that incur carrier
  // address-correction fees. The guard is an override, never a hard block.
  function handleCheckoutClick() {
    if (addressValidated) setModalStep('checkout');
    else setModalStep('address-guard');
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
    setAddressValidated(false);
    setHasCompared(false);
    setResults(INITIAL_RESULTS);
    setFormKey((k) => k + 1);
  }

  function closeAll() {
    setModalStep(null);
  }

  // Hand the built packages to the register so retail + shipping are charged
  // together in one sale, on one receipt.
  function handleAddToRegister() {
    if (cart.length === 0) return;
    stashShippingCart(cart);
    router.push('/admin/register');
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
        <span className="mt-1 shrink-0 rounded-full border border-navy/15 bg-cream px-4 py-1.5 text-xs font-semibold text-navy/50">
          Prices shown at cost and retail (+55%)
        </span>
      </div>

      {/* Shipment form */}
      <ShipmentForm key={formKey} onSubmit={handleCompare} loading={anyLoading} onAddressStatus={setAddressValidated} onChange={handleFormChange} />

      {/* Carrier panels — 1 col mobile, 2 col tablet+ */}
      <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FedExPanel
          result={results.fedex}
          onSelectRate={(r) => handleSelectRate('fedex', r)}
          selectedRateCode={null}
        />
        <UPSPanel
          result={results.ups}
          onSelectRate={(r) => handleSelectRate('ups', r)}
          selectedRateCode={null}
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
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleAddToRegister}
                className="rounded-lg border border-navy/20 px-4 py-2.5 text-sm font-semibold text-navy/70 transition-colors hover:bg-cream"
                title="Charge these packages with retail items on one receipt at the register"
              >
                + Add to register sale
              </button>
              <button
                type="button"
                onClick={handleCheckoutClick}
                className="rounded-lg bg-blue px-6 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-navy active:scale-95"
              >
                Checkout ({cart.length}) →
              </button>
            </div>
          </div>
        </div>
      )}

      {/* No-rates prompt when form is ready but no items in cart yet */}
      {cart.length === 0 && hasCompared && !anyLoading && (
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

      {/* Address guardrail — shown at checkout when the address wasn't validated.
          It's an override (staff can still ship), not a hard block. */}
      {modalStep === 'address-guard' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-yellow-100 text-2xl">⚠️</div>
            <h3 className="mt-3 text-center text-lg font-bold text-navy">Address not validated</h3>
            <p className="mt-2 text-center text-sm leading-relaxed text-navy/60">
              This destination hasn&apos;t been validated. Shipping an unverified address can trigger
              carrier <span className="font-semibold text-navy">address-correction fees</span> and delays.
            </p>
            <p className="mt-1 text-center text-xs text-navy/40">
              Use <span className="font-semibold">Validate</span> on the form, or confirm you&apos;ve checked it.
            </p>
            <div className="mt-5 space-y-2">
              <button
                type="button"
                onClick={() => setModalStep(null)}
                className="w-full rounded-lg bg-blue px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-navy"
              >
                ← Go back &amp; validate
              </button>
              <button
                type="button"
                onClick={() => { setAddressValidated(true); setModalStep('checkout'); }}
                className="w-full rounded-lg border border-navy/20 px-4 py-2.5 text-sm font-medium text-navy/70 transition-colors hover:bg-cream"
              >
                I&apos;ve verified this address — continue
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
