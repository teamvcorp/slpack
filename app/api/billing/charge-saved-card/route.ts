import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { sanitizeEmail } from '@/lib/email';
import { computeCardFee, normalizeFunding } from '@/lib/cardFee';
import { appendError } from '@/lib/errorLog';
import { paymentBindingEnabled, getValidQuote } from '@/lib/quoteStore';

/**
 * STOPGAP ceiling (2026-09-10), removed once server-side quote binding lands.
 * This route charges a card ON FILE off-session for a client-supplied amount, so
 * an unconstrained amount is the higher-risk of the two billing routes. Cap it
 * until the charge is recomputed from a stored quote. See create-payment-intent.
 */
const MAX_CHARGE_USD = 2000;

// POST /api/billing/charge-saved-card — charge a card already on file for the
// sender (off-session, confirmed immediately — no Stripe Elements needed).
export async function POST(req: NextRequest) {
  try {
    if (!process.env.STRIPE_SECRET_KEY) {
      return NextResponse.json({ ok: false, error: 'Stripe not configured' }, { status: 503 });
    }

    const { email, paymentMethodId, amountUSD, carrier, serviceName, shipmentDetails, quoteIds, extrasUSD, hasOverride } = await req.json();
    const cleanEmail = sanitizeEmail(email);

    if (!cleanEmail) return NextResponse.json({ ok: false, error: 'Sender email required' }, { status: 400 });
    if (!paymentMethodId) return NextResponse.json({ ok: false, error: 'No saved card selected' }, { status: 400 });

    // Payment binding (flag-gated): recompute freight from server quotes when on.
    // Mirrors create-payment-intent, including the audited staff-override path.
    // Inert (client amount used) when off.
    let chargeUSD = Number(amountUSD);
    let boundQuoteIds: string[] = [];
    if (paymentBindingEnabled() && Array.isArray(quoteIds) && quoteIds.length > 0) {
      let freight = 0;
      for (const raw of quoteIds) {
        const q = await getValidQuote(String(raw));
        if (!q) {
          return NextResponse.json(
            { ok: false, error: 'Your shipping quote expired. Please re-quote and try again.' },
            { status: 409 }
          );
        }
        freight += q.retailUSD;
        boundQuoteIds.push(q.quoteId);
      }
      const extras = Math.max(0, Number(extrasUSD) || 0);
      if (hasOverride === true) {
        chargeUSD = Number(amountUSD); // honor the deliberate counter discount
        await appendError({
          id: randomUUID(),
          timestamp: new Date().toISOString(),
          route: 'billing/charge-saved-card',
          status: 200,
          message: `Counter price OVERRIDE (saved card) — charged $${chargeUSD.toFixed(2)} vs formula freight $${freight.toFixed(2)} + extras $${extras.toFixed(2)}. Deliberate discount; logged for audit.`,
          requestSummary: { chargeUSD, formulaFreightUSD: freight, extrasUSD: extras, carrier, serviceName },
        });
      } else {
        chargeUSD = Math.round((freight + extras) * 100) / 100;
      }
    }

    if (!chargeUSD || chargeUSD <= 0) {
      return NextResponse.json({ ok: false, error: 'Invalid amount' }, { status: 400 });
    }
    if (chargeUSD > MAX_CHARGE_USD) {
      await appendError({
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        route: 'billing/charge-saved-card',
        status: 400,
        message: `Off-session charge $${chargeUSD.toFixed(2)} exceeds the $${MAX_CHARGE_USD} ceiling — refused. ${boundQuoteIds.length ? 'Recomputed from quotes.' : 'Client-supplied amount on a saved card; check for tampering.'} Raise the cap if legitimate.`,
        requestSummary: { chargeUSD, carrier, serviceName, bound: boundQuoteIds.length > 0 },
      });
      return NextResponse.json({ ok: false, error: 'Amount exceeds the allowed maximum.' }, { status: 400 });
    }

    const Stripe = (await import('stripe')).default;
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2025-02-24.acacia' });

    const customers = await stripe.customers.list({ email: cleanEmail, limit: 1 });
    const customer = customers.data[0];
    if (!customer) {
      return NextResponse.json({ ok: false, error: 'No saved customer for this email' }, { status: 404 });
    }

    // Credit-only surcharge: read the saved card's funding type and gross up.
    let funding: ReturnType<typeof normalizeFunding> = 'unknown';
    try {
      const pm = await stripe.paymentMethods.retrieve(String(paymentMethodId));
      funding = normalizeFunding(pm.card?.funding);
    } catch {
      funding = 'unknown';
    }
    const { feeUSD, totalUSD } = computeCardFee(chargeUSD, funding);

    try {
      const pi = await stripe.paymentIntents.create({
        amount: Math.round(totalUSD * 100),
        currency: 'usd',
        // Card-only — see create-payment-intent (avoids the redirect-method
        // return_url requirement Stripe flagged). (2026-09-10)
        payment_method_types: ['card'],
        customer: customer.id,
        payment_method: paymentMethodId,
        off_session: true,
        confirm: true,
        receipt_email: cleanEmail,
        description: `Shipping: ${String(carrier).toUpperCase()} — ${serviceName}`,
        metadata: {
          carrier: String(carrier),
          service: String(serviceName),
          originZip: String(shipmentDetails?.originZip ?? ''),
          destZip: String(shipmentDetails?.destZip ?? ''),
          weightLbs: String(shipmentDetails?.weightLbs ?? ''),
          cardFeeUSD: feeUSD.toFixed(2),
          quoteIds: boundQuoteIds.join(','),
        },
      });

      if (pi.status === 'succeeded') {
        return NextResponse.json({ ok: true, paymentIntentId: pi.id, feeUSD, totalUSD });
      }
      // e.g. requires_action — saved-card auth needed; cashier should re-enter the card.
      return NextResponse.json(
        { ok: false, error: `Payment ${pi.status} — please run the card manually.`, status: pi.status },
        { status: 402 }
      );
    } catch (err: unknown) {
      // Card declined / authentication_required / etc.
      const e = err as { code?: string; raw?: { message?: string }; message?: string };
      const message = e?.raw?.message ?? e?.message ?? 'The saved card could not be charged.';
      return NextResponse.json({ ok: false, error: message, code: e?.code }, { status: 402 });
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
