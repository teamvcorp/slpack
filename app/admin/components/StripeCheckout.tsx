"use client";

import { useState, useRef, useEffect } from 'react';
import type { CartItem, CartResult } from '../types/shipping';
import { sanitizeEmail } from '@/lib/email';

interface Props {
  cart: CartItem[];
  onClose: () => void;
  onSuccess: (results: CartResult[], paymentMethod: 'card' | 'cash') => void;
  /** Which submit endpoint to POST each package to. Defaults to the domestic
   *  route; the international flow passes '/api/shipping/intl/submit' so it can
   *  reuse this checkout without any change to domestic behavior. */
  submitPath?: string;
}

async function submitItem(
  item: CartItem,
  paymentMethod: 'card' | 'cash',
  packingFeeUSD: number,
  submitPath: string,
  cardFeeUSD = 0
): Promise<CartResult> {
  const shippingUSD = item.rate.totalChargeUSD;
  const insuranceUSD = item.insurance?.premiumUSD ?? 0;
  const dutiesUSD = item.dutiesUSD ?? 0; // international DDP only; 0 for domestic
  const totalUSD = shippingUSD + insuranceUSD + packingFeeUSD + dutiesUSD + cardFeeUSD;

  const res = await fetch(submitPath, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      carrier: item.carrier,
      serviceName: item.rate.serviceName,
      serviceCode: item.rate.serviceCode,
      shipment: item.shipment,
      shippingUSD,
      insuranceUSD,
      packingFeeUSD,
      dutiesUSD,
      cardFeeUSD,
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
    // Present only for international submits; undefined leaves domestic unchanged.
    ...(Array.isArray(data.documents) ? { documents: data.documents } : {}),
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

type Step = 'review' | 'consent' | 'card' | 'processing' | 'success' | 'error';

interface SavedCard {
  id: string;
  brand: string;
  last4: string;
  expMonth: number | null;
  expYear: number | null;
}

export default function StripeCheckout({ cart, onClose, onSuccess, submitPath = '/api/shipping/submit' }: Props) {
  const [step, setStep] = useState<Step>('review');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [cardReady, setCardReady] = useState(false);
  const [isCharging, setIsCharging] = useState(false);
  const [processingMsg, setProcessingMsg] = useState('Processing…');
  const [packingFeeInput, setPackingFeeInput] = useState('');
  const [saveCard, setSaveCard] = useState(false);
  const [savedCards, setSavedCards] = useState<SavedCard[]>([]);
  // Credit-card surcharge, priced by the server after the card is entered.
  const [cardFeeUSD, setCardFeeUSD] = useState(0);
  const [chargeTotalUSD, setChargeTotalUSD] = useState(0);
  // True once the card is tokenized + fee priced, awaiting the final confirm click.
  const [awaitingFeeConfirm, setAwaitingFeeConfirm] = useState(false);
  const packingFeeUSD = Math.max(0, Number.parseFloat(packingFeeInput) || 0);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stripeRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cardElementRef = useRef<any>(null);
  const mountRef = useRef<HTMLDivElement>(null);

  const totalShipping = cart.reduce((s, i) => s + i.rate.totalChargeUSD, 0);
  const totalInsurance = cart.reduce((s, i) => s + (i.insurance?.premiumUSD ?? 0), 0);
  // International DDP prepaid duties; 0 for domestic carts.
  const totalDuties = cart.reduce((s, i) => s + (i.dutiesUSD ?? 0), 0);
  const grandTotal = totalShipping + totalInsurance + packingFeeUSD + totalDuties;

  // Sender (paying customer) drives Stripe billing details. Fall back to
  // recipient only when no sender info was captured — keeps single-field
  // counter workflows working even if the sender section was left blank.
  const firstShipment = cart[0]?.shipment;
  const billingName =
    firstShipment?.senderName?.trim() || firstShipment?.customerName || '';
  const billingEmail =
    sanitizeEmail(firstShipment?.senderEmail) ??
    sanitizeEmail(firstShipment?.customerEmail) ??
    '';
  // Receipt copy still goes to the recipient on success screen if no sender email.
  const receiptDisplayEmail = billingEmail || firstShipment?.customerEmail || '';

  // Look up any cards this sender has saved on file (by email).
  useEffect(() => {
    if (!billingEmail) { setSavedCards([]); return; }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/billing/saved-cards?email=${encodeURIComponent(billingEmail)}`);
        const data = await res.json();
        if (!cancelled) setSavedCards(data.cards ?? []);
      } catch {
        if (!cancelled) setSavedCards([]);
      }
    })();
    return () => { cancelled = true; };
  }, [billingEmail]);

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

  // Shared post-payment step: generate labels for each package, then finish.
  // The packing fee and card fee are transaction-level, so they're recorded on
  // the first item only (avoids double-counting across packages).
  async function generateLabels(paymentMethod: 'card' | 'cash', feeUSD = 0) {
    setStep('processing');
    const results: CartResult[] = [];
    for (let i = 0; i < cart.length; i++) {
      setProcessingMsg(`Generating label ${i + 1} of ${cart.length}…`);
      results.push(
        await submitItem(cart[i], paymentMethod, i === 0 ? packingFeeUSD : 0, submitPath, i === 0 ? feeUSD : 0)
      );
    }
    setStep('success');
    setTimeout(() => onSuccess(results, paymentMethod), 1500);
  }

  async function handleCash() {
    setErrorMsg(null);
    try {
      await generateLabels('cash');
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'An unexpected error occurred.');
      setStep('error');
    }
  }

  // Charge a card already on file for this sender (no Elements needed).
  async function handleChargeSaved(paymentMethodId: string) {
    setStep('processing');
    setProcessingMsg('Charging saved card…');
    setErrorMsg(null);
    try {
      const res = await fetch('/api/billing/charge-saved-card', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: billingEmail,
          paymentMethodId,
          amountUSD: grandTotal,
          carrier: cart[0]?.carrier ?? 'multi',
          serviceName: cart.length === 1 ? cart[0].rate.serviceName : `${cart.length} packages`,
          shipmentDetails: {
            originZip: cart[0]?.shipment.originZip,
            destZip: cart[0]?.shipment.destZip,
            weightLbs: cart.reduce((s, i) => s + i.shipment.weightLbs, 0),
          },
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error ?? `Server error ${res.status}`);
      await generateLabels('card', Number(data.feeUSD) || 0);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'The saved card could not be charged.');
      setStep('error');
    }
  }

  // Load Stripe.js and show the card entry. The PaymentIntent is NOT created
  // here — we must tokenize the card first to read its funding type and price
  // the credit-only surcharge before setting the charge amount.
  async function handlePreparePayment(save: boolean) {
    setSaveCard(save);
    setStep('processing');
    setProcessingMsg('Initializing payment…');
    setErrorMsg(null);
    setAwaitingFeeConfirm(false);
    setCardFeeUSD(0);
    setClientSecret(null);

    try {
      const { loadStripe } = await import('@stripe/stripe-js');
      const stripe = await loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? '');
      if (!stripe) throw new Error('Stripe.js failed to load. Check NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY.');
      stripeRef.current = stripe;
      setStep('card');
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to initialize payment.');
      setStep('error');
    }
  }

  async function handleCharge() {
    if (!stripeRef.current || !cardElementRef.current) return;
    setIsCharging(true);
    setErrorMsg(null);

    try {
      let secret = clientSecret;
      let feeToRecord = cardFeeUSD;

      // Phase 1 (first click): tokenize the card, then have the server price the
      // credit-only surcharge and create the PaymentIntent for the grossed amount.
      if (!secret) {
        const { paymentMethod, error: pmError } = await stripeRef.current.createPaymentMethod({
          type: 'card',
          card: cardElementRef.current,
          billing_details: { name: billingName || undefined, email: billingEmail || undefined },
        });
        if (pmError) throw new Error(pmError.message ?? 'Could not read card');

        const piRes = await fetch('/api/billing/create-payment-intent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            amountUSD: grandTotal,
            paymentMethodId: paymentMethod.id,
            carrier: cart[0]?.carrier ?? 'multi',
            serviceName: cart.length === 1 ? cart[0].rate.serviceName : `${cart.length} packages`,
            customerEmail: billingEmail || undefined,
            customerName: billingName || undefined,
            saveCard,
            shipmentDetails: {
              originZip: cart[0]?.shipment.originZip,
              destZip: cart[0]?.shipment.destZip,
              weightLbs: cart.reduce((s, i) => s + i.shipment.weightLbs, 0),
            },
          }),
        });
        const piData = await piRes.json();
        if (!piRes.ok || !piData.clientSecret) throw new Error(piData.error ?? `Server error ${piRes.status}`);

        secret = piData.clientSecret as string;
        feeToRecord = Number(piData.feeUSD) || 0;
        setClientSecret(secret);
        setCardFeeUSD(feeToRecord);
        setChargeTotalUSD(Number(piData.totalUSD) || grandTotal);

        // Credit card → show the surcharge and require an explicit confirm
        // (point-of-sale disclosure). No fee (debit/off) → confirm immediately.
        if (feeToRecord > 0) {
          setAwaitingFeeConfirm(true);
          setIsCharging(false);
          return;
        }
      }

      // Phase 2: confirm the (already card-attached) PaymentIntent.
      const { error } = await stripeRef.current.confirmCardPayment(secret);
      if (error) throw new Error(error.message ?? 'Payment declined');

      await generateLabels('card', feeToRecord);
    } catch (err: unknown) {
      setIsCharging(false);
      setErrorMsg(err instanceof Error ? err.message : 'An unexpected error occurred.');
      setStep('error');
    }
  }

  if (step === 'consent') {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy/60 p-4 backdrop-blur-sm">
        <div className="w-full max-w-sm rounded-2xl bg-white p-8 text-center shadow-2xl">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-blue/10 text-3xl">💳</div>
          <h3 className="mt-4 text-xl font-bold text-navy">Save card on file?</h3>
          <p className="mt-2 text-sm leading-relaxed text-navy/60">
            Ask {billingName || 'the customer'} if they&apos;d like to securely save this card for faster
            checkout next time they ship.
          </p>
          <p className="mt-1 text-xs text-navy/40">
            Card details are stored by Stripe — we never see or keep the full number.
          </p>
          <div className="mt-6 space-y-2">
            <button
              type="button"
              onClick={() => handlePreparePayment(true)}
              className="w-full rounded-lg bg-blue px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-navy"
            >
              Yes, save it securely
            </button>
            <button
              type="button"
              onClick={() => handlePreparePayment(false)}
              className="w-full rounded-lg border border-navy/20 px-4 py-2.5 text-sm font-medium text-navy/70 transition-colors hover:bg-cream"
            >
              No thanks
            </button>
          </div>
          <button
            type="button"
            onClick={() => setStep('review')}
            className="mt-3 text-xs font-medium text-navy/40 transition-colors hover:text-navy"
          >
            ← Back
          </button>
        </div>
      </div>
    );
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
          {receiptDisplayEmail && (
            <p className="mt-1 text-xs text-navy/40">Receipt sent to {receiptDisplayEmail}</p>
          )}
          {saveCard && (
            <p className="mt-1 text-xs font-medium text-green-600">💳 Card securely saved for next time</p>
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
          <div className="mt-3 space-y-2 rounded-xl bg-navy/5 px-4 py-3">
            {/* Packing fee input */}
            <div className="flex items-center justify-between gap-3">
              <label htmlFor="packingFee" className="text-sm text-navy/70">
                Packing fee
                <span className="ml-1 text-[11px] text-navy/40">(custom packaging, optional)</span>
              </label>
              <div className="relative">
                <span className="pointer-events-none absolute inset-y-0 left-2 flex items-center text-sm text-navy/40">$</span>
                <input
                  id="packingFee"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                  value={packingFeeInput}
                  onChange={(e) => setPackingFeeInput(e.target.value)}
                  disabled={step !== 'review'}
                  className="w-24 rounded-md border border-navy/20 bg-white py-1.5 pl-5 pr-2 text-right text-sm font-semibold text-navy focus:border-blue focus:outline-none focus:ring-1 focus:ring-blue disabled:cursor-not-allowed disabled:opacity-60"
                />
              </div>
            </div>
            {packingFeeUSD > 0 && (
              <div className="flex items-center justify-between border-t border-navy/10 pt-2 text-xs text-navy/50">
                <span>Shipping + insurance</span>
                <span>${(totalShipping + totalInsurance).toFixed(2)}</span>
              </div>
            )}
            {totalDuties > 0 && (
              <div className="flex items-center justify-between text-xs text-navy/50">
                <span>Duties (prepaid)</span>
                <span>${totalDuties.toFixed(2)}</span>
              </div>
            )}
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-navy">Total</span>
              <span className="text-2xl font-extrabold text-navy">${grandTotal.toFixed(2)}</span>
            </div>
          </div>

          {/* Customer info */}
          {(billingName || billingEmail) && (
            <div className="mt-3 space-y-1 text-sm">
              {billingName && (
                <div className="flex justify-between">
                  <span className="text-navy/50">Customer</span>
                  <span className="font-medium text-navy">{billingName}</span>
                </div>
              )}
              {billingEmail && (
                <div className="flex justify-between">
                  <span className="text-navy/50">Email</span>
                  <span className="font-medium text-navy">{billingEmail}</span>
                </div>
              )}
            </div>
          )}

          {/* Saved card(s) on file for this sender */}
          {step === 'review' && savedCards.length > 0 && (
            <div className="mt-4 rounded-xl border border-blue/30 bg-blue/5 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-blue">
                💳 Saved card on file
              </p>
              <div className="mt-2 space-y-2">
                {savedCards.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => handleChargeSaved(c.id)}
                    className="flex w-full items-center justify-between rounded-lg border border-navy/15 bg-white px-3 py-2 text-left transition-colors hover:border-blue hover:bg-blue/5"
                  >
                    <span className="text-sm font-medium text-navy">
                      {c.brand.toUpperCase()} •••• {c.last4}
                      {c.expMonth && c.expYear && (
                        <span className="ml-2 text-xs text-navy/40">
                          {String(c.expMonth).padStart(2, '0')}/{String(c.expYear).slice(-2)}
                        </span>
                      )}
                    </span>
                    <span className="text-sm font-semibold text-blue">Charge ${grandTotal.toFixed(2)}</span>
                  </button>
                ))}
              </div>
              <p className="mt-1.5 text-[10px] text-navy/40">Or use Cash / Card below for a different method.</p>
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
              <p className="mt-1.5 text-[11px] text-navy/50">
                A processing fee applies to <span className="font-semibold">credit cards</span>; debit is exempt.
              </p>
              {awaitingFeeConfirm && cardFeeUSD > 0 && (
                <div className="mt-3 space-y-1 rounded-lg border border-blue/30 bg-blue/5 px-3 py-2 text-sm">
                  <div className="flex justify-between text-navy/60">
                    <span>Subtotal</span><span>${grandTotal.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-navy/60">
                    <span>Credit card processing fee</span><span>${cardFeeUSD.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between border-t border-navy/10 pt-1 font-semibold text-navy">
                    <span>Total to charge</span><span>${chargeTotalUSD.toFixed(2)}</span>
                  </div>
                </div>
              )}
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
                  onClick={() => setStep('consent')}
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
                ) : !cardReady ? 'Loading card…'
                  : awaitingFeeConfirm ? `Confirm $${chargeTotalUSD.toFixed(2)}`
                  : `Charge $${grandTotal.toFixed(2)}`}
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
