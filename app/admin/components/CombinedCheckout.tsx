"use client";

import { useState, useRef, useEffect } from 'react';
import { buildCombinedReceiptHtml, type CombinedPackageLine, type CombinedReceiptData } from '@/lib/receipt';
import { sanitizeEmail } from '@/lib/email';
import { printReceipt } from './receiptPrinter';
import { renderCombined } from '@/lib/eposReceipt';
import ShippingLabelModal from './ShippingLabelModal';
import type { RegisterLineItem, SaleRecord } from '../types/register';
import type { CartItem, CartResult } from '../types/shipping';

interface Props {
  /** Retail line items (may be empty for a shipping-only sale started from the register). */
  items: RegisterLineItem[];
  /** Shipping packages pulled in from the shipping page. */
  shipping: CartItem[];
  taxRate: number;
  /** Display totals for the goods portion (server re-prices authoritatively). */
  goodsSubtotalUSD: number;
  goodsTaxUSD: number;
  onClose: () => void;
  /** Called after the sale completes so the page can clear both carts. */
  onCompleted: () => void;
}

type Step = 'review' | 'cash' | 'card' | 'processing' | 'success' | 'error';

export default function CombinedCheckout({
  items,
  shipping,
  taxRate,
  goodsSubtotalUSD,
  goodsTaxUSD,
  onClose,
  onCompleted,
}: Props) {
  const [step, setStep] = useState<Step>('review');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [processingMsg, setProcessingMsg] = useState('Processing…');
  const [email, setEmail] = useState('');
  const [cashInput, setCashInput] = useState('');
  const [packingFeeInput, setPackingFeeInput] = useState('');
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [paymentIntentId, setPaymentIntentId] = useState<string | null>(null);
  const [cardReady, setCardReady] = useState(false);
  const [isCharging, setIsCharging] = useState(false);
  // Credit-card surcharge, priced by the server after the card is entered.
  const [cardFeeUSD, setCardFeeUSD] = useState(0);
  const [chargeTotalUSD, setChargeTotalUSD] = useState(0);
  const [awaitingFeeConfirm, setAwaitingFeeConfirm] = useState(false);

  const [method, setMethod] = useState<'card' | 'cash'>('card');
  const [completedSale, setCompletedSale] = useState<SaleRecord | null>(null);
  const [results, setResults] = useState<CartResult[]>([]);
  const [showLabels, setShowLabels] = useState(false);
  const [regenerating, setRegenerating] = useState(false);

  // One transaction id ties the goods sale + all shipment records together.
  const [transactionId] = useState(() => crypto.randomUUID());

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stripeRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cardElementRef = useRef<any>(null);
  const mountRef = useRef<HTMLDivElement>(null);

  const cleanEmail = sanitizeEmail(email);
  const packingFeeUSD = Math.max(0, Number.parseFloat(packingFeeInput) || 0);

  const shipSum = shipping.reduce(
    (s, i) => s + i.rate.totalChargeUSD + (i.insurance?.premiumUSD ?? 0),
    0
  );
  const shippingUSD = Math.round((shipSum + packingFeeUSD) * 100) / 100;
  const grandTotal = Math.round((goodsSubtotalUSD + goodsTaxUSD + shippingUSD) * 100) / 100;

  const cashTendered = Math.max(0, Number.parseFloat(cashInput) || 0);
  const changeDue = Math.max(0, Math.round((cashTendered - grandTotal) * 100) / 100);

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

  // Purchase a label for one package (no charge — payment is already handled).
  async function submitPackage(item: CartItem, pm: 'card' | 'cash', packing: number, cardFee = 0): Promise<CartResult> {
    const shippingUSDItem = item.rate.totalChargeUSD;
    const insuranceUSD = item.insurance?.premiumUSD ?? 0;
    const totalUSD = shippingUSDItem + insuranceUSD + packing + cardFee;
    try {
      const res = await fetch('/api/shipping/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          carrier: item.carrier,
          serviceName: item.rate.serviceName,
          serviceCode: item.rate.serviceCode,
          shipment: item.shipment,
          shippingUSD: shippingUSDItem,
          insuranceUSD,
          packingFeeUSD: packing,
          cardFeeUSD: cardFee,
          totalUSD,
          insurance: item.insurance,
          paymentMethod: pm,
          transactionId,
          suppressEmail: true,
        }),
      });
      const data = await res.json();
      return {
        item,
        trackingNumber: data.trackingNumber ?? 'PENDING',
        labelBase64: data.labelBase64 ?? null,
        labelMimeType: data.labelMimeType ?? null,
        labelError: data.labelError ?? (res.ok ? null : `Server error ${res.status}`),
      };
    } catch (err: unknown) {
      return {
        item,
        trackingNumber: 'PENDING',
        labelBase64: null,
        labelMimeType: null,
        labelError: err instanceof Error ? err.message : 'Label generation failed',
      };
    }
  }

  function packageLines(res: CartResult[]): CombinedPackageLine[] {
    return shipping.map((item, i) => {
      const r = res.find((x) => x.item.id === item.id);
      const amountUSD =
        item.rate.totalChargeUSD + (item.insurance?.premiumUSD ?? 0) + (i === 0 ? packingFeeUSD : 0);
      return {
        carrier: item.carrier,
        serviceName: item.rate.serviceName,
        trackingNumber: r && !r.labelError ? r.trackingNumber : null,
        amountUSD,
      };
    });
  }

  // openDrawer: only for a fresh cash charge (renderCombined ignores it on card);
  // reprints pass false so re-printing never re-opens the drawer.
  function printCombinedReceipt(
    sale: SaleRecord | null,
    res: CartResult[],
    pm: 'card' | 'cash',
    feeUSD = 0,
    openDrawer = false
  ) {
    const data: CombinedReceiptData = {
      timestamp: new Date().toISOString(),
      paymentMethod: pm,
      sale,
      packages: packageLines(res),
      cardFeeUSD: feeUSD > 0 ? feeUSD : undefined,
      cashTenderedUSD: pm === 'cash' && cashInput ? cashTendered : undefined,
      changeDueUSD: pm === 'cash' && cashInput ? changeDue : undefined,
    };
    printReceipt((p) => renderCombined(p, data, { openDrawer }), buildCombinedReceiptHtml(data));
  }

  // Shared post-payment sequence: record goods, buy labels, print + email one receipt.
  // feeUSD is the credit-card surcharge already charged; it's recorded on the
  // goods sale, or (for shipping-only carts) on the first package.
  async function finalize(pm: 'card' | 'cash', feeUSD = 0) {
    setMethod(pm);
    setStep('processing');
    setErrorMsg(null);
    try {
      // 1. Record the goods sale (skipped when the cart is shipping-only).
      let sale: SaleRecord | null = null;
      if (items.length > 0) {
        setProcessingMsg('Recording sale…');
        const res = await fetch('/api/register/sale', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            items,
            taxRate,
            paymentMethod: pm,
            customerEmail: cleanEmail,
            transactionId,
            suppressEmail: true,
            ...(pm === 'card' ? { paymentIntentId, cardFeeUSD: feeUSD > 0 ? feeUSD : undefined } : {}),
          }),
        });
        const data = await res.json();
        if (!res.ok || !data.sale) throw new Error(data.error ?? `Server error ${res.status}`);
        sale = data.sale as SaleRecord;
      }
      setCompletedSale(sale);

      // 2. Buy a label for each package (submit retries once server-side). When
      // there's no goods sale, record the card fee on the first package instead.
      const feeOnFirstPackage = items.length === 0 ? feeUSD : 0;
      const res: CartResult[] = [];
      for (let i = 0; i < shipping.length; i++) {
        setProcessingMsg(`Generating label ${i + 1} of ${shipping.length}…`);
        res.push(await submitPackage(shipping[i], pm, i === 0 ? packingFeeUSD : 0, i === 0 ? feeOnFirstPackage : 0));
      }
      setResults(res);

      // 3. One unified receipt — print now, email once (server rebuilds from records).
      printCombinedReceipt(sale, res, pm, feeUSD, true);
      if (cleanEmail) {
        fetch('/api/checkout/receipt', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ transactionId, email: cleanEmail }),
        }).catch(() => {});
      }

      // 4. Show the label print step (never lost on a successful charge).
      setShowLabels(res.some((r) => !r.labelError && r.labelBase64));
      setStep('success');
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
          body: JSON.stringify({ items, taxRate, customerEmail: cleanEmail, shippingUSD, paymentMethodId: paymentMethod.id }),
        });
        const data = await res.json();
        if (!res.ok || !data.clientSecret) throw new Error(data.error ?? `Server error ${res.status}`);

        secret = data.clientSecret as string;
        piId = data.paymentIntentId ?? null;
        feeToRecord = Number(data.cardFeeUSD) || 0;
        setClientSecret(secret);
        setPaymentIntentId(piId);
        setCardFeeUSD(feeToRecord);
        setChargeTotalUSD(Number(data.totalUSD) || grandTotal);

        if (feeToRecord > 0) {
          setAwaitingFeeConfirm(true);
          setIsCharging(false);
          return; // explicit confirm required (surcharge disclosure)
        }
      }

      const { error } = await stripeRef.current.confirmCardPayment(secret);
      if (error) throw new Error(error.message ?? 'Payment declined');
      await finalize('card', feeToRecord);
    } catch (err: unknown) {
      setIsCharging(false);
      setErrorMsg(err instanceof Error ? err.message : 'An unexpected error occurred.');
      setStep('error');
    }
  }

  // Re-attempt failed labels. Payment is already captured, so this never recharges.
  async function regenerateFailed() {
    setRegenerating(true);
    try {
      const failed = results.filter((r) => r.labelError || !r.labelBase64);
      const updates = new Map<string, CartResult>();
      for (const r of failed) {
        const idx = shipping.findIndex((s) => s.id === r.item.id);
        updates.set(r.item.id, await submitPackage(r.item, method, idx === 0 ? packingFeeUSD : 0));
      }
      setResults((prev) => prev.map((r) => updates.get(r.item.id) ?? r));
    } finally {
      setRegenerating(false);
    }
  }

  const printable = results.filter((r) => !r.labelError && r.labelBase64);
  const failed = results.filter((r) => r.labelError || !r.labelBase64);

  // ── Label print step (reuses the shipping label modal) ─────────────────────
  if (step === 'success' && showLabels && printable.length > 0) {
    return <ShippingLabelModal results={printable} onClose={() => setShowLabels(false)} />;
  }

  // ── Sale complete summary ───────────────────────────────────────────────────
  if (step === 'success') {
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
            ${grandTotal.toFixed(2)} · {method === 'cash' ? 'Cash' : 'Card'}
          </p>
          {method === 'cash' && cashInput && (
            <p className="mt-1 text-sm font-semibold text-green-700">Change due: ${changeDue.toFixed(2)}</p>
          )}
          {cleanEmail && <p className="mt-1 text-xs text-navy/40">Receipt emailed to {cleanEmail}</p>}

          {failed.length > 0 && (
            <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-3 text-left">
              <p className="text-sm font-semibold text-amber-800">
                Payment received — {failed.length} label{failed.length !== 1 ? 's' : ''} pending
              </p>
              <p className="mt-0.5 text-xs text-amber-700">
                The carrier didn&apos;t return a label. Regenerate below (no new charge), or fix the
                address in Shipping.
              </p>
              <button
                type="button"
                onClick={regenerateFailed}
                disabled={regenerating}
                className="mt-2 w-full rounded-lg bg-amber-600 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-amber-700 disabled:opacity-50"
              >
                {regenerating ? 'Regenerating…' : `Regenerate ${failed.length} label${failed.length !== 1 ? 's' : ''}`}
              </button>
            </div>
          )}

          <div className="mt-6 space-y-2">
            {printable.length > 0 && (
              <button
                type="button"
                onClick={() => setShowLabels(true)}
                className="w-full rounded-lg bg-blue px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-navy"
              >
                🏷 Print labels ({printable.length})
              </button>
            )}
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => printCombinedReceipt(completedSale, results, method)}
                className="flex-1 rounded-lg border border-navy/20 px-4 py-2.5 text-sm font-medium text-navy/70 transition-colors hover:bg-cream"
              >
                🖨 Receipt
              </button>
              <button
                type="button"
                onClick={onCompleted}
                className="flex-1 rounded-lg bg-navy px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-navy/90"
              >
                New sale
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Review / payment entry ──────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy/60 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between bg-navy px-6 py-4">
          <div>
            <h3 className="text-lg font-bold text-white">Checkout</h3>
            <p className="text-xs text-white/50">
              {items.length > 0 && `${items.length} item${items.length !== 1 ? 's' : ''}`}
              {items.length > 0 && shipping.length > 0 && ' · '}
              {shipping.length > 0 && `${shipping.length} package${shipping.length !== 1 ? 's' : ''}`}
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
              <span>Items subtotal</span>
              <span>${goodsSubtotalUSD.toFixed(2)}</span>
            </div>
            {goodsTaxUSD > 0 && (
              <div className="flex items-center justify-between text-sm text-navy/60">
                <span>Tax</span>
                <span>${goodsTaxUSD.toFixed(2)}</span>
              </div>
            )}
            <div className="flex items-center justify-between text-sm text-navy/60">
              <span>Shipping{packingFeeUSD > 0 ? ' + packing' : ''}</span>
              <span>${shippingUSD.toFixed(2)}</span>
            </div>
            <div className="flex items-center justify-between border-t border-navy/10 pt-2">
              <span className="text-sm font-semibold text-navy">Total</span>
              <span className="text-2xl font-extrabold text-navy">${grandTotal.toFixed(2)}</span>
            </div>
          </div>

          {/* Packing fee (optional) — only relevant when shipping */}
          {shipping.length > 0 && (step === 'review') && (
            <div className="mt-3 flex items-center justify-between gap-3">
              <label htmlFor="packingFee" className="text-sm text-navy/70">
                Packing fee <span className="text-[11px] text-navy/40">(optional)</span>
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
                  className="w-24 rounded-md border border-navy/20 bg-white py-1.5 pl-5 pr-2 text-right text-sm font-semibold text-navy focus:border-blue focus:outline-none focus:ring-1 focus:ring-blue"
                />
              </div>
            </div>
          )}

          {/* Email (receipt copy) */}
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
                  <div className="flex justify-between text-navy/60"><span>Subtotal</span><span>${grandTotal.toFixed(2)}</span></div>
                  <div className="flex justify-between text-navy/60"><span>Credit card processing fee</span><span>${cardFeeUSD.toFixed(2)}</span></div>
                  <div className="flex justify-between border-t border-navy/10 pt-1 font-semibold text-navy"><span>Total to charge</span><span>${chargeTotalUSD.toFixed(2)}</span></div>
                </div>
              )}
              <p className="mt-1.5 text-[11px] text-navy/30">
                Test card: 4242 4242 4242 4242 · any future date · any CVC
              </p>
            </div>
          )}

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
                onClick={() => finalize('cash')}
                className="flex-1 rounded-lg bg-green-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-green-700 active:scale-95"
              >
                Complete cash sale · ${grandTotal.toFixed(2)}
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
                {isCharging ? 'Processing…'
                  : !cardReady ? 'Loading card…'
                  : awaitingFeeConfirm ? `Confirm $${chargeTotalUSD.toFixed(2)}`
                  : `Charge $${grandTotal.toFixed(2)}`}
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
