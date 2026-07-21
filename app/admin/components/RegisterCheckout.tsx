"use client";

import { useState, useRef, useEffect } from 'react';
import { buildSaleReceiptHtml } from '@/lib/receipt';
import { sanitizeEmail } from '@/lib/email';
import { printReceipt } from './receiptPrinter';
import { renderSale } from '@/lib/eposReceipt';
import type { RegisterLineItem, SaleRecord } from '../types/register';

interface Props {
  items: RegisterLineItem[];
  taxRate: number;
  /** Local display totals (server recomputes authoritatively on submit) */
  subtotalUSD: number;
  taxUSD: number;
  totalUSD: number;
  onClose: () => void;
  /** Called after a sale completes so the page can clear the cart */
  onCompleted: () => void;
}

type Step = 'review' | 'cash' | 'card' | 'processing' | 'success' | 'error';

export default function RegisterCheckout({
  items,
  taxRate,
  subtotalUSD,
  taxUSD,
  totalUSD,
  onClose,
  onCompleted,
}: Props) {
  const [step, setStep] = useState<Step>('review');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [processingMsg, setProcessingMsg] = useState('Processing…');
  const [email, setEmail] = useState('');
  const [cashInput, setCashInput] = useState('');
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [paymentIntentId, setPaymentIntentId] = useState<string | null>(null);
  const [cardReady, setCardReady] = useState(false);
  const [isCharging, setIsCharging] = useState(false);
  const [completedSale, setCompletedSale] = useState<SaleRecord | null>(null);
  // Credit-card surcharge, priced by the server after the card is entered.
  const [cardFeeUSD, setCardFeeUSD] = useState(0);
  const [chargeTotalUSD, setChargeTotalUSD] = useState(0);
  const [awaitingFeeConfirm, setAwaitingFeeConfirm] = useState(false);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stripeRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cardElementRef = useRef<any>(null);
  const mountRef = useRef<HTMLDivElement>(null);

  const cleanEmail = sanitizeEmail(email);
  const cashTendered = Math.max(0, Number.parseFloat(cashInput) || 0);
  const changeDue = Math.max(0, cashTendered - totalUSD);

  // Mount the Stripe card element once the 'card' step renders.
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

  async function recordSale(
    paymentMethod: 'card' | 'cash',
    extra: { paymentIntentId?: string; cashTenderedUSD?: number; cardFeeUSD?: number }
  ): Promise<SaleRecord> {
    const res = await fetch('/api/register/sale', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items,
        taxRate,
        paymentMethod,
        customerEmail: cleanEmail,
        ...extra,
      }),
    });
    const data = await res.json();
    if (!res.ok || !data.sale) {
      throw new Error(data.error ?? `Server error ${res.status}`);
    }
    return data.sale as SaleRecord;
  }

  function finishWithSale(sale: SaleRecord) {
    setCompletedSale(sale);
    setStep('success');
    // Email is the preferred receipt, so card sales with an email skip the print.
    // Cash always prints — the drawer must open (and the customer gets paper).
    if (!sale.customerEmail || sale.paymentMethod === 'cash') {
      printReceipt((p) => renderSale(p, sale, { openDrawer: true }), buildSaleReceiptHtml(sale));
    }
  }

  async function handleConfirmCash() {
    setStep('processing');
    setProcessingMsg('Recording sale…');
    setErrorMsg(null);
    try {
      const sale = await recordSale('cash', {
        cashTenderedUSD: cashInput ? cashTendered : undefined,
      });
      finishWithSale(sale);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'An unexpected error occurred.');
      setStep('error');
    }
  }

  // Load Stripe and show the card entry. The PaymentIntent is created only after
  // the card is tokenized, so the server can read funding and price the fee.
  async function handlePrepareCard() {
    setStep('processing');
    setProcessingMsg('Initializing payment…');
    setErrorMsg(null);
    setAwaitingFeeConfirm(false);
    setCardFeeUSD(0);
    setClientSecret(null);
    try {
      const { loadStripe } = await import('@stripe/stripe-js');
      const stripe = await loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? '');
      if (!stripe) {
        throw new Error('Stripe.js failed to load. Check NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY.');
      }
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
      let piId = paymentIntentId;
      let feeToRecord = cardFeeUSD;

      // Phase 1: tokenize, then price the credit-only surcharge server-side.
      if (!secret) {
        const { paymentMethod, error: pmError } = await stripeRef.current.createPaymentMethod({
          type: 'card',
          card: cardElementRef.current,
          billing_details: { email: cleanEmail || undefined },
        });
        if (pmError) throw new Error(pmError.message ?? 'Could not read card');

        const res = await fetch('/api/register/checkout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items, taxRate, customerEmail: cleanEmail, paymentMethodId: paymentMethod.id }),
        });
        const data = await res.json();
        if (!res.ok || !data.clientSecret) throw new Error(data.error ?? `Server error ${res.status}`);

        secret = data.clientSecret as string;
        piId = data.paymentIntentId ?? null;
        feeToRecord = Number(data.cardFeeUSD) || 0;
        setClientSecret(secret);
        setPaymentIntentId(piId);
        setCardFeeUSD(feeToRecord);
        setChargeTotalUSD(Number(data.totalUSD) || totalUSD);

        if (feeToRecord > 0) {
          setAwaitingFeeConfirm(true);
          setIsCharging(false);
          return; // explicit confirm required (surcharge disclosure)
        }
      }

      const { error } = await stripeRef.current.confirmCardPayment(secret);
      if (error) throw new Error(error.message ?? 'Payment declined');

      setStep('processing');
      setProcessingMsg('Recording sale…');
      const sale = await recordSale('card', {
        paymentIntentId: piId ?? undefined,
        cardFeeUSD: feeToRecord > 0 ? feeToRecord : undefined,
      });
      finishWithSale(sale);
    } catch (err: unknown) {
      setIsCharging(false);
      setErrorMsg(err instanceof Error ? err.message : 'An unexpected error occurred.');
      setStep('error');
    }
  }

  // ── Success screen ─────────────────────────────────────────────────────────
  if (step === 'success' && completedSale) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy/60 p-4 backdrop-blur-sm">
        <div className="w-full max-w-sm rounded-2xl bg-white p-8 text-center shadow-2xl">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
            <svg className="h-8 w-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h3 className="mt-4 text-xl font-bold text-navy">Sale Complete</h3>
          <p className="mt-2 text-sm text-navy/60">
            ${completedSale.totalUSD.toFixed(2)} · {completedSale.paymentMethod === 'cash' ? 'Cash' : 'Card'}
          </p>
          {completedSale.paymentMethod === 'cash' && completedSale.changeDueUSD != null && (
            <p className="mt-1 text-sm font-semibold text-green-700">
              Change due: ${completedSale.changeDueUSD.toFixed(2)}
            </p>
          )}
          {completedSale.customerEmail && (
            <p className="mt-1 text-xs text-navy/40">Receipt emailed to {completedSale.customerEmail}</p>
          )}
          <div className="mt-6 flex gap-3">
            <button
              type="button"
              onClick={() =>
                printReceipt(
                  (p) => renderSale(p, completedSale, { openDrawer: false }),
                  buildSaleReceiptHtml(completedSale)
                )
              }
              className="flex-1 rounded-lg border border-navy/20 px-4 py-2.5 text-sm font-medium text-navy/70 transition-colors hover:bg-cream"
            >
              🖨 Print again
            </button>
            <button
              type="button"
              onClick={onCompleted}
              className="flex-1 rounded-lg bg-blue px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-navy"
            >
              New sale
            </button>
          </div>
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
            <h3 className="text-lg font-bold text-white">Checkout</h3>
            <p className="text-xs text-white/50">
              {items.length} item{items.length !== 1 ? 's' : ''}
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
          {/* Totals */}
          <div className="space-y-2 rounded-xl bg-navy/5 px-4 py-3">
            <div className="flex items-center justify-between text-sm text-navy/60">
              <span>Subtotal</span>
              <span>${subtotalUSD.toFixed(2)}</span>
            </div>
            {taxRate > 0 && (
              <div className="flex items-center justify-between text-sm text-navy/60">
                <span>Tax ({(taxRate * 100).toFixed(taxRate * 100 % 1 === 0 ? 0 : 2)}%)</span>
                <span>${taxUSD.toFixed(2)}</span>
              </div>
            )}
            <div className="flex items-center justify-between border-t border-navy/10 pt-2">
              <span className="text-sm font-semibold text-navy">Total</span>
              <span className="text-2xl font-extrabold text-navy">${totalUSD.toFixed(2)}</span>
            </div>
          </div>

          {/* Email (receipt copy) — editable on the entry steps */}
          {(step === 'review' || step === 'cash' || step === 'card') && (
            <div className="mt-4">
              <label htmlFor="receiptEmail" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-navy/50">
                Email receipt (optional)
              </label>
              <input
                id="receiptEmail"
                type="email"
                inputMode="email"
                placeholder="customer@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-lg border border-navy/20 bg-white px-3 py-2 text-sm text-navy focus:border-blue focus:outline-none focus:ring-1 focus:ring-blue"
              />
            </div>
          )}

          {/* Cash entry */}
          {step === 'cash' && (
            <div className="mt-4">
              <label htmlFor="cashTendered" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-navy/50">
                Cash tendered (optional)
              </label>
              <div className="relative">
                <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-navy/40">$</span>
                <input
                  id="cashTendered"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                  value={cashInput}
                  onChange={(e) => setCashInput(e.target.value)}
                  autoFocus
                  className="w-full rounded-lg border border-navy/20 bg-white py-2 pl-7 pr-3 text-right text-lg font-semibold text-navy focus:border-blue focus:outline-none focus:ring-1 focus:ring-blue"
                />
              </div>
              {cashInput && (
                <div className="mt-2 flex items-center justify-between rounded-lg bg-green-50 px-3 py-2 text-sm">
                  <span className="text-green-700">Change due</span>
                  <span className="text-lg font-bold text-green-700">${changeDue.toFixed(2)}</span>
                </div>
              )}
            </div>
          )}

          {/* Stripe card element */}
          {step === 'card' && (
            <div className="mt-4">
              <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-navy/50">
                Card Details
              </label>
              <div ref={mountRef} className="rounded-lg border border-navy/20 bg-white px-3 py-3 shadow-sm" />
              <p className="mt-1.5 text-[11px] text-navy/50">
                A processing fee applies to <span className="font-semibold">credit cards</span>; debit is exempt.
              </p>
              {awaitingFeeConfirm && cardFeeUSD > 0 && (
                <div className="mt-3 space-y-1 rounded-lg border border-blue/30 bg-blue/5 px-3 py-2 text-sm">
                  <div className="flex justify-between text-navy/60"><span>Subtotal</span><span>${totalUSD.toFixed(2)}</span></div>
                  <div className="flex justify-between text-navy/60"><span>Credit card processing fee</span><span>${cardFeeUSD.toFixed(2)}</span></div>
                  <div className="flex justify-between border-t border-navy/10 pt-1 font-semibold text-navy"><span>Total to charge</span><span>${chargeTotalUSD.toFixed(2)}</span></div>
                </div>
              )}
              <p className="mt-1.5 text-[11px] text-navy/30">
                Test card: 4242 4242 4242 4242 · any future date · any CVC
              </p>
            </div>
          )}

          {/* Processing */}
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
            onClick={step === 'cash' || step === 'card' ? () => setStep('review') : onClose}
            disabled={step === 'processing'}
            className="rounded-lg border border-navy/20 px-4 py-2.5 text-sm font-medium text-navy/70 transition-colors hover:bg-cream disabled:opacity-40"
          >
            {step === 'cash' || step === 'card' ? 'Back' : 'Cancel'}
          </button>

          <div className="flex flex-1 gap-2">
            {step === 'review' && (
              <>
                <button
                  type="button"
                  onClick={() => setStep('cash')}
                  className="flex-1 rounded-lg border-2 border-green-600 px-3 py-2.5 text-sm font-semibold text-green-700 transition-colors hover:bg-green-50"
                >
                  💵 Cash
                </button>
                <button
                  type="button"
                  onClick={handlePrepareCard}
                  className="flex-1 rounded-lg bg-blue px-3 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-navy active:scale-95"
                >
                  💳 Card
                </button>
              </>
            )}

            {step === 'cash' && (
              <button
                type="button"
                onClick={handleConfirmCash}
                className="flex-1 rounded-lg bg-green-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-green-700 active:scale-95"
              >
                Complete cash sale · ${totalUSD.toFixed(2)}
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
                  : `Charge $${totalUSD.toFixed(2)}`}
              </button>
            )}

            {step === 'processing' && (
              <button
                type="button"
                disabled
                className="flex-1 rounded-lg bg-blue/50 px-4 py-2.5 text-sm font-semibold text-white opacity-70"
              >
                Processing…
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
