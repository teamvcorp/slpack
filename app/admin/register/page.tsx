"use client";

import { useEffect, useMemo, useState } from 'react';
import RegisterCheckout from '../components/RegisterCheckout';
import { SALES_TAX_RATE } from '../types/register';
import type { RegisterProduct, RegisterLineItem } from '../types/register';

function money(n: number): string {
  return `$${n.toFixed(2)}`;
}

export default function RegisterPage() {
  const [products, setProducts] = useState<RegisterProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [cart, setCart] = useState<RegisterLineItem[]>([]);
  const [showCheckout, setShowCheckout] = useState(false);
  // Cashier can exempt a sale from sales tax (e.g. resale / tax-exempt customer).
  const [taxExempt, setTaxExempt] = useState(false);

  // Custom price entry
  const [customPrice, setCustomPrice] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/register/products');
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) throw new Error(data.error ?? `Server error ${res.status}`);
        setProducts(data.products ?? []);
      } catch (err: unknown) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : 'Failed to load products.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  function addProduct(p: RegisterProduct) {
    setCart((prev) => {
      const existing = prev.find((i) => i.id === p.priceId);
      if (existing) {
        return prev.map((i) => (i.id === p.priceId ? { ...i, quantity: i.quantity + 1 } : i));
      }
      return [
        ...prev,
        { id: p.priceId, name: p.name, priceId: p.priceId, unitAmountUSD: p.unitAmountUSD, quantity: 1 },
      ];
    });
  }

  function changeQty(id: string, delta: number) {
    setCart((prev) =>
      prev
        .map((i) => (i.id === id ? { ...i, quantity: i.quantity + delta } : i))
        .filter((i) => i.quantity > 0)
    );
  }

  function setQty(id: string, value: string) {
    const q = Math.max(0, Math.floor(Number(value) || 0));
    setCart((prev) => prev.map((i) => (i.id === id ? { ...i, quantity: q } : i)).filter((i) => i.quantity > 0));
  }

  function removeItem(id: string) {
    setCart((prev) => prev.filter((i) => i.id !== id));
  }

  function addCustom() {
    const amount = Math.max(0, Number.parseFloat(customPrice) || 0);
    if (amount <= 0) return;
    setCart((prev) => [
      ...prev,
      {
        id: `custom-${crypto.randomUUID()}`,
        name: 'Custom item',
        priceId: null,
        unitAmountUSD: amount,
        quantity: 1,
      },
    ]);
    setCustomPrice('');
  }

  const subtotal = useMemo(
    () => cart.reduce((s, i) => s + i.unitAmountUSD * i.quantity, 0),
    [cart]
  );
  // Effective rate is zero when the sale is marked tax-exempt; the server
  // re-prices with this same rate, so passing 0 zeroes the tax authoritatively.
  const effectiveTaxRate = taxExempt ? 0 : SALES_TAX_RATE;
  const tax = useMemo(
    () => Math.round(subtotal * effectiveTaxRate * 100) / 100,
    [subtotal, effectiveTaxRate]
  );
  const total = Math.round((subtotal + tax) * 100) / 100;
  const itemCount = cart.reduce((s, i) => s + i.quantity, 0);

  return (
    <div className="py-6">
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold text-navy">Register</h1>
          <p className="mt-1 text-sm text-navy/50">Point of sale — products, cash &amp; card</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_360px]">
        {/* ── Products ──────────────────────────────────────────────────────── */}
        <div>
          {loading && (
            <div className="flex items-center gap-2 text-sm text-navy/50">
              <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
              </svg>
              Loading products…
            </div>
          )}

          {loadError && (
            <div className="rounded-xl border border-red/20 bg-red/5 p-4 text-sm text-red">
              {loadError}
            </div>
          )}

          {!loading && !loadError && products.length === 0 && (
            <div className="rounded-xl border border-navy/10 bg-white p-6 text-sm text-navy/50">
              No active products with a USD price found in Stripe. Add products in the Stripe
              dashboard, or use “Custom item” to charge an ad-hoc amount.
            </div>
          )}

          {products.length > 0 && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {products.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => addProduct(p)}
                  className="group flex flex-col rounded-xl border border-navy/10 bg-white p-4 text-left shadow-sm transition-all hover:border-blue/40 hover:shadow-md active:scale-95"
                >
                  <span className="text-sm font-semibold text-navy group-hover:text-blue">{p.name}</span>
                  {p.description && (
                    <span className="mt-0.5 line-clamp-2 text-xs text-navy/40">{p.description}</span>
                  )}
                  <span className="mt-auto pt-3 text-lg font-extrabold text-navy">{money(p.unitAmountUSD)}</span>
                </button>
              ))}
            </div>
          )}

          {/* Custom price — add an ad-hoc amount not in the catalog */}
          <div className="mt-4 flex items-end gap-2 rounded-xl border border-navy/10 bg-white p-4">
            <div>
              <label htmlFor="customPrice" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-navy/50">
                Custom price
              </label>
              <div className="relative">
                <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-navy/40">$</span>
                <input
                  id="customPrice"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                  value={customPrice}
                  onChange={(e) => setCustomPrice(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addCustom()}
                  className="w-32 rounded-lg border border-navy/20 bg-white py-2 pl-7 pr-3 text-right text-sm font-semibold text-navy focus:border-blue focus:outline-none focus:ring-1 focus:ring-blue"
                />
              </div>
            </div>
            <button
              type="button"
              onClick={addCustom}
              disabled={!(Number.parseFloat(customPrice) > 0)}
              className="rounded-lg bg-blue px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-navy disabled:cursor-not-allowed disabled:opacity-40"
            >
              Add to cart
            </button>
          </div>
        </div>

        {/* ── Cart ──────────────────────────────────────────────────────────── */}
        <div className="lg:sticky lg:top-6 lg:self-start">
          <div className="rounded-2xl border border-navy/10 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-navy/10 px-5 py-4">
              <h2 className="text-base font-semibold text-navy">
                Cart {itemCount > 0 && <span className="text-navy/40">· {itemCount}</span>}
              </h2>
              {cart.length > 0 && (
                <button
                  type="button"
                  onClick={() => setCart([])}
                  className="text-xs font-medium text-navy/40 transition-colors hover:text-red"
                >
                  Clear
                </button>
              )}
            </div>

            <div className="max-h-[45vh] overflow-y-auto px-5 py-3">
              {cart.length === 0 ? (
                <p className="py-8 text-center text-sm text-navy/40">
                  Tap a product to add it to the cart.
                </p>
              ) : (
                <ul className="space-y-3">
                  {cart.map((item) => (
                    <li key={item.id} className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-navy">{item.name}</p>
                        <p className="text-xs text-navy/40">{money(item.unitAmountUSD)} ea</p>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => changeQty(item.id, -1)}
                          className="flex h-7 w-7 items-center justify-center rounded-md border border-navy/20 text-navy/70 transition-colors hover:bg-cream"
                          aria-label="Decrease quantity"
                        >
                          −
                        </button>
                        <input
                          type="number"
                          min="1"
                          value={item.quantity}
                          onChange={(e) => setQty(item.id, e.target.value)}
                          className="w-10 rounded-md border border-navy/20 py-1 text-center text-sm font-semibold text-navy focus:border-blue focus:outline-none focus:ring-1 focus:ring-blue"
                        />
                        <button
                          type="button"
                          onClick={() => changeQty(item.id, 1)}
                          className="flex h-7 w-7 items-center justify-center rounded-md border border-navy/20 text-navy/70 transition-colors hover:bg-cream"
                          aria-label="Increase quantity"
                        >
                          +
                        </button>
                      </div>
                      <div className="w-16 shrink-0 text-right text-sm font-bold text-navy">
                        {money(item.unitAmountUSD * item.quantity)}
                      </div>
                      <button
                        type="button"
                        onClick={() => removeItem(item.id)}
                        className="mt-0.5 text-navy/30 transition-colors hover:text-red"
                        aria-label="Remove item"
                      >
                        ✕
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="space-y-2 border-t border-navy/10 px-5 py-4">
              <div className="flex justify-between text-sm text-navy/60">
                <span>Subtotal</span>
                <span>{money(subtotal)}</span>
              </div>
              <div className="flex items-center justify-between text-sm text-navy/60">
                <div className="flex items-center gap-2">
                  <span>Tax ({(SALES_TAX_RATE * 100).toFixed(SALES_TAX_RATE * 100 % 1 === 0 ? 0 : 2)}%)</span>
                  <button
                    type="button"
                    onClick={() => setTaxExempt((v) => !v)}
                    className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold transition-all ${
                      taxExempt
                        ? 'border-navy/20 bg-white text-navy/50 hover:border-navy/40'
                        : 'border-green-600 bg-green-600 text-white shadow-sm'
                    }`}
                  >
                    {taxExempt ? 'Tax off' : 'Tax on'}
                  </button>
                </div>
                <span>{taxExempt ? 'Exempt' : money(tax)}</span>
              </div>
              <div className="flex items-center justify-between border-t border-navy/10 pt-2">
                <span className="text-sm font-semibold text-navy">Total</span>
                <span className="text-2xl font-extrabold text-navy">{money(total)}</span>
              </div>
              <button
                type="button"
                disabled={cart.length === 0}
                onClick={() => setShowCheckout(true)}
                className="mt-2 w-full rounded-xl bg-blue px-4 py-3 text-sm font-bold text-white shadow-sm transition-all hover:bg-navy active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Checkout · {money(total)}
              </button>
            </div>
          </div>
        </div>
      </div>

      {showCheckout && (
        <RegisterCheckout
          items={cart}
          taxRate={effectiveTaxRate}
          subtotalUSD={subtotal}
          taxUSD={tax}
          totalUSD={total}
          onClose={() => setShowCheckout(false)}
          onCompleted={() => {
            setShowCheckout(false);
            setCart([]);
          }}
        />
      )}
    </div>
  );
}
