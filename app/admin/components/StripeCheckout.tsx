"use client";

import { useState, useRef, useEffect } from 'react';
import type { CartItem, CartResult } from '../types/shipping';

interface Props {
  cart: CartItem[];
  onClose: () => void;
  onSuccess: (results: CartResult[], paymentMethod: 'card' | 'cash') => void;
}

async function submitItem(item: CartItem, paymentMethod: 'card' | 'cash'): Promise<CartResult> {
  const shippingUSD = item.rate.totalChargeUSD;
  const insuranceUSD = item.insurance?.premiumUSD ?? 0;
  const totalUSD = shippingUSD + insuranceUSD;

  const res = await fetch('/api/shipping/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      carrier: item.carrier,
      serviceName: item.rate.serviceName,
      serviceCode: item.rate.serviceCode,
      shipment: item.shipment,
      shippingUSD,
      insuranceUSD,
      totalUSD,
      insurance: item.insurance,
      paymentMethod,
    }),
  });

  const data = await res.json();
  return {
    item,
    trackingNumber: data.trackingNumber ?? 'PENDING',
    labelBase64: data.labelBase64 ?? null,
    labelMimeType: data.labelMimeType ?? null,
    labelError: data.labelError ?? null,
  };
}

const CARRIER_LABELS: Record<string, string> = {
  fedex: 'FedEx',
  ups: 'UPS',
  usps: 'USPS',
  dhl: 'DHL Express',
};

const CARRIER_COLORS: Record<string, string> = {
  fedex: '#4D148C',
  ups: '#351C15',
  usps: '#004B87',
  dhl: '#D40511',
};

type Step = 'review' | 'card' | 'processing' | 'success' | 'error';

export default function StripeCheckout({ cart, onClose, onSuccess }: Props) {
  const [step, setStep] = useState<Step>('review');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [cardReady, setCardReady] = useState(false);
  const [isCharging, setIsCharging] = useState(false);
  const [processingMsg, setProcessingMsg] = useState('Processing…');

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stripeRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cardElementRef = useRef<any>(null);
  const mountRef = useRef<HTMLDivElement>(null);

  const totalShipping = cart.reduce((s, i) => s + i.rate.totalChargeUSD, 0);
  const totalInsurance = cart.reduce((s, i) => s + (i.insurance?.premiumUSD ?? 0), 0);
  const grandTotal = totalShipping + totalInsurance;

  // Customer info from first item
  const { customerName = '', customerEmail = '' } = cart[0]?.shipment ?? {};

  // Mount Stripe card element once the 'card' step is rendered
  useEffect(() => {
    if (step !== 'card' || !stripeRef.current || !mountRef.current) return;
    if (cardElementRef.current) return;

    setCardReady(false);
    const elements = stripeRef.current.elements();
    const card = elements.create('card', {
      style: {
        base: {
          fontSize: '16px',
          fontFamily: '"Inter", system-ui, sans-serif',
          color: '#1e2d4d',
          '::placeholder': { color: '#94a3b8' },
          iconColor: '#34aef8',
        },
        invalid: { color: '#ef4444', iconColor: '#ef4444' },
      },
    });
    card.on('ready', () => setCardReady(true));
    card.mount(mountRef.current);
    cardElementRef.current = card;

    return () => {
      card.destroy();
      cardElementRef.current = null;
      setCardReady(false);
    };
  }, [step]);

  async function handleCash() {
    setStep('processing');
    setErrorMsg(null);
    try {
      const results: CartResult[] = [];
      for (let i = 0; i < cart.length; i++) {
        setProcessingMsg(`Processing package ${i + 1} of ${cart.length}…`);
        results.push(await submitItem(cart[i], 'cash'));
      }
      setStep('success');
      setTimeout(() => onSuccess(results, 'cash'), 1500);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'An unexpected error occurred.');
      setStep('error');
    }
  }

  async function handlePreparePayment() {
    setStep('processing');
    setProcessingMsg('Initializing payment…');
    setErrorMsg(null);

    try {
      const piRes = await fetch('/api/billing/create-payment-intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amountUSD: grandTotal,
          carrier: cart[0]?.carrier ?? 'multi',
          serviceName: cart.length === 1 ? cart[0].rate.serviceName : `${cart.length} packages`,
          customerEmail,
          shipmentDetails: {
            originZip: cart[0]?.shipment.originZip,
            destZip: cart[0]?.shipment.destZip,
            weightLbs: cart.reduce((s, i) => s + i.shipment.weightLbs, 0),
          },
        }),
      });

      const piData = await piRes.json();
      if (!piRes.ok || !piData.clientSecret) {
        throw new Error(piData.error ?? `Server error ${piRes.status}`);
      }

      const { loadStripe } = await import('@stripe/stripe-js');
      const stripe = await loadStripe(
        process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? ''
      );
      if (!stripe) throw new Error('Stripe.js failed to load. Check NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY.');

      stripeRef.current = stripe;
      setClientSecret(piData.clientSecret);
      setStep('card');
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to initialize payment.');
      setStep('error');
    }
  }

  async function handleCharge() {
    if (!stripeRef.current || !cardElementRef.current || !clientSecret) return;
    // Do NOT change step to 'processing' here — that would unmount the card
    // element div and destroy the Stripe element before confirmCardPayment runs.
    setIsCharging(true);
    setErrorMsg(null);

    try {
      const { error } = await stripeRef.current.confirmCardPayment(clientSecret, {
        payment_method: {
          card: cardElementRef.current,
          billing_details: {
            name: customerName || undefined,
            email: customerEmail || undefined,
          },
        },
      });

      if (error) throw new Error(error.message ?? 'Payment declined');

      // Payment confirmed — now safe to switch away from card step
      setStep('processing');
      const results: CartResult[] = [];
      for (let i = 0; i < cart.length; i++) {
        setProcessingMsg(`Generating label ${i + 1} of ${cart.length}…`);
        results.push(await submitItem(cart[i], 'card'));
      }
      setStep('success');
      setTimeout(() => onSuccess(results, 'card'), 1800);
    } catch (err: unknown) {
      setIsCharging(false);
      setErrorMsg(err instanceof Error ? err.message : 'An unexpected error occurred.');
      setStep('error');
    }
  }

  if (step === 'success') {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy/60 p-4 backdrop-blur-sm">
        <div className="w-full max-w-sm rounded-2xl bg-white p-8 text-center shadow-2xl">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
            <svg className="h-8 w-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h3 className="mt-4 text-xl font-bold text-navy">Payment Successful</h3>
          <p className="mt-2 text-sm text-navy/60">
            ${grandTotal.toFixed(2)} · {cart.length} package{cart.length !== 1 ? 's' : ''}
          </p>
          {customerEmail && (
            <p className="mt-1 text-xs text-navy/40">Receipt sent to {customerEmail}</p>
          )}
          <p className="mt-1 text-xs text-navy/40">Generating labels…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy/60 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between bg-navy px-6 py-4">
          <div>
            <h3 className="text-lg font-bold text-white">Charge Customer</h3>
            <p className="text-xs text-white/50">
              {cart.length} package{cart.length !== 1 ? 's' : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={step === 'processing'}
            className="rounded-lg p-1 text-white/60 transition-colors hover:bg-white/20 hover:text-white disabled:opacity-40"
          >
            ✕
          </button>
        </div>

        <div className="max-h-[60vh] overflow-y-auto px-6 py-5">
          {/* Package list */}
          <div className="space-y-2">
            {cart.map((item, idx) => {
              const itemTotal = item.rate.totalChargeUSD + (item.insurance?.premiumUSD ?? 0);
              const carrierLabel = CARRIER_LABELS[item.carrier] ?? item.carrier.toUpperCase();
              const color = CARRIER_COLORS[item.carrier] ?? '#34aef8';
              return (
                <div key={item.id} className="rounded-xl border border-navy/10 bg-cream p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color }}>
                        Pkg {idx + 1} · {carrierLabel}
                      </p>
                      <p className="text-sm font-semibold text-navy">{item.rate.serviceName}</p>
                      <p className="text-xs text-navy/50">
                        {item.shipment.destStreet && `${item.shipment.destStreet}, `}
                        {item.shipment.destCity || item.shipment.destZip}
                        {item.shipment.destState ? `, ${item.shipment.destState}` : ''}
                        {' · '}{item.shipment.weightLbs} lbs
                      </p>
                      {(item.insurance?.premiumUSD ?? 0) > 0 && (
                        <p className="text-xs text-navy/40">
                          + ${item.insurance.premiumUSD.toFixed(2)} insurance
                        </p>
                      )}
                    </div>
                    <span className="shrink-0 text-base font-extrabold text-navy">
                      ${itemTotal.toFixed(2)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Grand total */}
          <div className="mt-3 flex items-center justify-between rounded-xl bg-navy/5 px-4 py-3">
            <span className="text-sm font-semibold text-navy">Total</span>
            <span className="text-2xl font-extrabold text-navy">${grandTotal.toFixed(2)}</span>
          </div>

          {/* Customer info */}
          {(customerName || customerEmail) && (
            <div className="mt-3 space-y-1 text-sm">
              {customerName && (
                <div className="flex justify-between">
                  <span className="text-navy/50">Customer</span>
                  <span className="font-medium text-navy">{customerName}</span>
                </div>
              )}
              {customerEmail && (
                <div className="flex justify-between">
                  <span className="text-navy/50">Email</span>
                  <span className="font-medium text-navy">{customerEmail}</span>
                </div>
              )}
            </div>
          )}

          {/* Stripe card element — only rendered when on card step */}
          {step === 'card' && (
            <div className="mt-5">
              <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-navy/50">
                Card Details
              </label>
              <div
                ref={mountRef}
                className="rounded-lg border border-navy/20 bg-white px-3 py-3 shadow-sm"
              />
              <p className="mt-1.5 text-[11px] text-navy/30">
                Test card: 4242 4242 4242 4242 · any future date · any CVC
              </p>
            </div>
          )}

          {/* Processing message */}
          {step === 'processing' && (
            <div className="mt-4 flex items-center justify-center gap-2 text-sm text-navy/60">
              <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
              </svg>
              {processingMsg}
            </div>
          )}

          {step === 'error' && errorMsg && (
            <p className="mt-3 rounded-lg bg-red/10 px-3 py-2 text-sm text-red">{errorMsg}</p>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-3 border-t border-navy/10 px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            disabled={step === 'processing'}
            className="rounded-lg border border-navy/20 px-4 py-2.5 text-sm font-medium text-navy/70 transition-colors hover:bg-cream disabled:opacity-40"
          >
            Cancel
          </button>

          <div className="flex flex-1 gap-2">
            {step === 'review' && (
              <>
                <button
                  type="button"
                  onClick={handleCash}
                  className="flex-1 rounded-lg border-2 border-green-600 px-3 py-2.5 text-sm font-semibold text-green-700 transition-colors hover:bg-green-50"
                >
                  💵 Cash
                </button>
                <button
                  type="button"
                  onClick={handlePreparePayment}
                  className="flex-1 rounded-lg bg-blue px-3 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-navy active:scale-95"
                >
                  💳 Card
                </button>
              </>
            )}

            {step === 'processing' && (
              <button
                type="button"
                disabled
                className="flex-1 rounded-lg bg-blue/50 px-4 py-2.5 text-sm font-semibold text-white opacity-70"
              >
                <span className="flex items-center justify-center gap-2">
                  <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                  </svg>
                  Processing…
                </span>
              </button>
            )}

            {step === 'card' && (
              <button
                type="button"
                onClick={handleCharge}
                disabled={!cardReady || isCharging}
                title={!cardReady ? 'Card element is loading…' : undefined}
                className="flex-1 rounded-lg bg-blue px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-all active:scale-95 disabled:opacity-50"
              >
                {isCharging ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                    </svg>
                    Processing…
                  </span>
                ) : cardReady ? `Charge $${grandTotal.toFixed(2)}` : 'Loading card…'}
              </button>
            )}

            {step === 'error' && (
              <button
                type="button"
                onClick={() => { setStep('review'); setErrorMsg(null); }}
                className="flex-1 rounded-lg bg-navy px-4 py-2.5 text-sm font-semibold text-white"
              >
                Try Again
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
