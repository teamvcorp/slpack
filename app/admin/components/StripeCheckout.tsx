"use client";

import { useState } from 'react';
import type { SelectedRate } from '../types/shipping';

interface Props {
  selected: SelectedRate;
  onClose: () => void;
  onSuccess: (trackingNumber: string, labelBase64: string | null) => void;
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

type Step = 'review' | 'processing' | 'success' | 'error';

export default function StripeCheckout({ selected, onClose, onSuccess }: Props) {
  const [step, setStep] = useState<Step>('review');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const { rate, carrier, shipment, insurance } = selected;
  const label = CARRIER_LABELS[carrier] ?? carrier.toUpperCase();
  const accentColor = CARRIER_COLORS[carrier] ?? '#34aef8';

  const shippingAmt = rate.totalChargeUSD;
  const insuranceAmt = insurance?.premiumUSD ?? 0;
  const totalAmt = shippingAmt + insuranceAmt;

  async function handleCharge() {
    setStep('processing');
    setErrorMsg(null);

    try {
      // Step 1 — create payment intent server-side
      const piRes = await fetch('/api/billing/create-payment-intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amountUSD: totalAmt,
          carrier,
          serviceName: rate.serviceName,
          customerEmail: shipment.customerEmail,
          shipmentDetails: {
            originZip: shipment.originZip,
            destZip: shipment.destZip,
            weightLbs: shipment.weightLbs,
          },
        }),
      });

      const piData = await piRes.json();

      if (!piRes.ok || !piData.clientSecret) {
        throw new Error(piData.error ?? `Server error ${piRes.status}`);
      }

      // Step 2 — confirm via Stripe.js (lazy-loaded)
      const { loadStripe } = await import('@stripe/stripe-js');
      const stripe = await loadStripe(
        process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? ''
      );

      if (!stripe) throw new Error('Stripe.js failed to load. Check NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY.');

      const { error } = await stripe.confirmCardPayment(piData.clientSecret, {
        payment_method: {
          card: { token: 'tok_visa' } as never,
          billing_details: {
            name: shipment.customerName || undefined,
            email: shipment.customerEmail || undefined,
          },
        },
      });

      if (error) throw new Error(error.message ?? 'Payment declined');

      // Step 3 — log shipment + send receipt + generate label
      const submitRes = await fetch('/api/shipping/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          carrier,
          serviceName: rate.serviceName,
          serviceCode: rate.serviceCode,
          shipment,
          shippingUSD: shippingAmt,
          insuranceUSD: insuranceAmt,
          totalUSD: totalAmt,
          insurance,
        }),
      });

      const submitData = await submitRes.json();
      const trackingNumber: string = submitData.trackingNumber ?? 'PENDING';
      const labelBase64: string | null = submitData.labelBase64 ?? null;

      setStep('success');
      setTimeout(() => onSuccess(trackingNumber, labelBase64), 1800);
    } catch (err: unknown) {
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
            ${totalAmt.toFixed(2)} charged via {label}
          </p>
          {shipment.customerEmail && (
            <p className="mt-1 text-xs text-navy/40">Receipt sent to {shipment.customerEmail}</p>
          )}
          <p className="mt-1 text-xs text-navy/40">Generating label…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy/60 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl">
        {/* Header bar — uses carrier accent color */}
        <div
          className="flex items-center justify-between px-6 py-4"
          style={{ backgroundColor: accentColor }}
        >
          <h3 className="text-lg font-bold text-white">Charge Customer</h3>
          <button
            type="button"
            onClick={onClose}
            disabled={step === 'processing'}
            className="rounded-lg p-1 text-white/60 transition-colors hover:bg-white/20 hover:text-white disabled:opacity-40"
          >
            ✕
          </button>
        </div>

        <div className="px-6 py-5">
          {/* Order summary */}
          <div className="rounded-xl bg-cream p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-navy/40">{label}</p>
            <div className="mt-1 flex items-end justify-between">
              <div>
                <p className="text-base font-semibold text-navy">{rate.serviceName}</p>
                {rate.estimatedDays && (
                  <p className="text-xs text-navy/50">
                    ~{rate.estimatedDays} day{rate.estimatedDays !== 1 ? 's' : ''} transit
                  </p>
                )}
              </div>
              <span className="text-2xl font-extrabold text-navy">
                ${totalAmt.toFixed(2)}
              </span>
            </div>
          </div>

          {/* Cost breakdown */}
          <div className="mt-3 space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-navy/50">Shipping</span>
              <span className="font-medium text-navy">${shippingAmt.toFixed(2)}</span>
            </div>
            {insuranceAmt > 0 && (
              <div className="flex justify-between">
                <span className="text-navy/50">Insurance (${insurance.valueUSD.toFixed(2)} declared)</span>
                <span className="font-medium text-navy">${insuranceAmt.toFixed(2)}</span>
              </div>
            )}
          </div>
          <div className="mt-4 space-y-1 text-sm">
            {shipment.customerName && (
              <div className="flex justify-between">
                <span className="text-navy/50">Customer</span>
                <span className="font-medium text-navy">{shipment.customerName}</span>
              </div>
            )}
            {shipment.customerEmail && (
              <div className="flex justify-between">
                <span className="text-navy/50">Email</span>
                <span className="font-medium text-navy">{shipment.customerEmail}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-navy/50">Ship to</span>
              <span className="font-medium text-navy">
                {shipment.destZip}
                {shipment.destCountry !== 'US' ? ` (${shipment.destCountry})` : ''}
              </span>
            </div>
          </div>

          {/* Card form placeholder — replace with <CardElement> from @stripe/react-stripe-js */}
          <div className="mt-4 rounded-lg border border-dashed border-navy/20 bg-cream px-4 py-3 text-xs text-navy/50">
            <strong className="text-navy/70">Card Entry:</strong> Install{' '}
            <code>@stripe/react-stripe-js</code> and wrap this component in{' '}
            <code>&lt;Elements&gt;</code> to embed the Stripe{' '}
            <code>&lt;CardElement&gt;</code> here. The payment intent server route
            is already wired and ready.
          </div>

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
            className="flex-1 rounded-lg border border-navy/20 px-4 py-2.5 text-sm font-medium text-navy/70 transition-colors hover:bg-cream disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleCharge}
            disabled={step === 'processing' || !shipment.customerEmail}
            className="flex-1 rounded-lg px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-all disabled:opacity-50"
            style={{ backgroundColor: accentColor }}
            title={!shipment.customerEmail ? 'Customer email required' : undefined}
          >
            {step === 'processing' ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                </svg>
                Processing…
              </span>
            ) : (
              `Charge $${totalAmt.toFixed(2)}`
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
