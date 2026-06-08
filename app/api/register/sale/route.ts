import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { appendSale } from '@/lib/saleLog';
import { priceCart } from '@/lib/registerPricing';
import { buildSaleReceiptHtml } from '@/lib/receipt';
import { sanitizeEmail } from '@/lib/email';
import type { RegisterLineItem, SaleRecord } from '@/app/admin/types/register';

/**
 * Records a completed register sale (cash or card) and emails a receipt copy
 * when a customer email is provided. The cart is re-priced server-side so the
 * stored record and emailed receipt are authoritative — the client total is
 * never trusted. Returns the saved SaleRecord for the client to print.
 */
export async function POST(req: NextRequest) {
  try {
    if (!process.env.STRIPE_SECRET_KEY) {
      return NextResponse.json(
        { error: 'Stripe not configured (STRIPE_SECRET_KEY missing)' },
        { status: 503 }
      );
    }

    const body = await req.json();
    const items: RegisterLineItem[] = Array.isArray(body.items) ? body.items : [];
    const taxRate = Number(body.taxRate) || 0;
    const paymentMethod: 'card' | 'cash' = body.paymentMethod === 'cash' ? 'cash' : 'card';
    const customerEmail = sanitizeEmail(body.customerEmail);
    const paymentIntentId =
      typeof body.paymentIntentId === 'string' ? body.paymentIntentId : undefined;

    if (items.length === 0) {
      return NextResponse.json({ error: 'Cart is empty' }, { status: 400 });
    }

    const Stripe = (await import('stripe')).default;
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: '2025-02-24.acacia',
    });

    const priced = await priceCart(stripe, items, taxRate);

    const sale: SaleRecord = {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      items: priced.items,
      subtotalUSD: priced.subtotalUSD,
      taxRate: priced.taxRate,
      taxUSD: priced.taxUSD,
      totalUSD: priced.totalUSD,
      paymentMethod,
      customerEmail,
      paymentIntentId: paymentMethod === 'card' ? paymentIntentId : undefined,
    };

    if (paymentMethod === 'cash' && body.cashTenderedUSD != null) {
      const tendered = Math.max(0, Number(body.cashTenderedUSD) || 0);
      sale.cashTenderedUSD = tendered;
      sale.changeDueUSD = Math.max(0, Math.round((tendered - priced.totalUSD) * 100) / 100);
    }

    await appendSale(sale);

    // Email a receipt copy when we have a valid address — non-fatal on failure.
    if (customerEmail && process.env.RESEND_API_KEY) {
      try {
        const { Resend } = await import('resend');
        const resend = new Resend(process.env.RESEND_API_KEY);
        const fromEmail = process.env.RESEND_FROM_EMAIL ?? 'shipping@stormlakepackandship.com';
        await resend.emails.send({
          from: `Storm Lake Pack & Ship <${fromEmail}>`,
          to: customerEmail,
          subject: `Your Receipt — $${sale.totalUSD.toFixed(2)}`,
          html: buildSaleReceiptHtml(sale),
        });
      } catch {
        // Receipt email failure should not block the sale.
      }
    }

    return NextResponse.json({ sale });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
