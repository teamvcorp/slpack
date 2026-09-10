import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { sanitizeEmail } from '@/lib/email';
import { computeCardFee, normalizeFunding } from '@/lib/cardFee';
import { appendError } from '@/lib/errorLog';
import { paymentBindingEnabled, getValidQuote } from '@/lib/quoteStore';

/**
 * Ceiling on any single charge. With payment binding OFF this is the only guard
 * on a client-supplied amount; with binding ON it is a backstop on the
 * server-recomputed amount. Real label + insurance stays well under it.
 */
const MAX_CHARGE_USD = 2000;

export async function POST(req: NextRequest) {
  try {
    if (!process.env.STRIPE_SECRET_KEY) {
      return NextResponse.json(
        { error: 'Stripe not configured (STRIPE_SECRET_KEY missing)' },
        { status: 503 }
      );
    }

    const { amountUSD, paymentMethodId, carrier, serviceName, customerEmail, customerName, saveCard, shipmentDetails, quoteIds, extrasUSD, hasOverride } =
      await req.json();

    // ── Payment binding (flag-gated) ─────────────────────────────────────────
    // With PAYMENT_BINDING_ENABLED and quoteIds present, the FREIGHT is
    // recomputed from the server-stored quotes and the client's amount is
    // ignored — this is what stops a tampered browser from naming its own price.
    //
    // EXCEPTION — staff price overrides (frequent-shipper discounts). An override
    // is a deliberate, authenticated counter action, so it is HONORED: the
    // client total is used, but the override is recorded to the audit log so it
    // is never silent. The non-override path stays fully bound.
    //
    // With the flag off, or no quoteIds, the client amount is used as before.
    // The Stripe Terminal reader uses a separate route and is not bound here.
    let chargeUSD = Number(amountUSD);
    let boundQuoteIds: string[] = [];
    const overrideApplied = hasOverride === true;
    if (paymentBindingEnabled() && Array.isArray(quoteIds) && quoteIds.length > 0) {
      let freight = 0;
      for (const raw of quoteIds) {
        const q = await getValidQuote(String(raw));
        if (!q) {
          return NextResponse.json(
            { error: 'Your shipping quote expired. Please re-quote the shipment and try again.' },
            { status: 409 }
          );
        }
        freight += q.retailUSD;
        boundQuoteIds.push(q.quoteId);
      }
      const extras = Math.max(0, Number(extrasUSD) || 0);
      if (overrideApplied) {
        // Honor the staff-entered total, but audit it against the formula.
        chargeUSD = Number(amountUSD);
        await appendError({
          id: randomUUID(),
          timestamp: new Date().toISOString(),
          route: 'billing/create-payment-intent',
          status: 200,
          message: `Counter price OVERRIDE — charged $${chargeUSD.toFixed(2)} vs formula freight $${freight.toFixed(2)} + extras $${extras.toFixed(2)}. A deliberate discount is expected; this line makes it auditable.`,
          requestSummary: { chargeUSD, formulaFreightUSD: freight, extrasUSD: extras, carrier, serviceName },
        });
      } else {
        chargeUSD = Math.round((freight + extras) * 100) / 100;
      }
    }

    if (!chargeUSD || chargeUSD <= 0) {
      return NextResponse.json({ error: 'Invalid amount' }, { status: 400 });
    }
    if (chargeUSD > MAX_CHARGE_USD) {
      await appendError({
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        route: 'billing/create-payment-intent',
        status: 400,
        message: `Charge amount $${chargeUSD.toFixed(2)} exceeds the $${MAX_CHARGE_USD} ceiling — refused. ${boundQuoteIds.length ? 'Recomputed from quotes.' : 'Client-supplied amount; check for tampering.'} Raise the cap if legitimate.`,
        requestSummary: { chargeUSD, carrier, serviceName, bound: boundQuoteIds.length > 0 },
      });
      return NextResponse.json({ error: 'Amount exceeds the allowed maximum.' }, { status: 400 });
    }

    // Stripe rejects malformed receipt_email values with a cryptic
    // "user email is incorrect" error. Strip anything that isn't a plausible
    // address before forwarding.
    const receiptEmail = sanitizeEmail(customerEmail);

    // Lazy-load the Stripe SDK — avoids hard build errors before the package is installed
    const Stripe = (await import('stripe')).default;
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: '2025-02-24.acacia',
    });

    // Credit-only surcharge: read the card's funding type server-side, then
    // gross up so the shop nets the base amount. Debit/prepaid pay no fee.
    let funding: ReturnType<typeof normalizeFunding> = 'unknown';
    if (paymentMethodId) {
      try {
        const pm = await stripe.paymentMethods.retrieve(String(paymentMethodId));
        funding = normalizeFunding(pm.card?.funding);
      } catch {
        funding = 'unknown'; // fee-safe default (no surcharge)
      }
    }
    const { feeUSD, totalUSD } = computeCardFee(chargeUSD, funding);
    const amountCents = Math.round(totalUSD * 100);

    // When the sender opts in, attach the charge to a (reusable) Stripe customer
    // and mark the card for future off-session use, so it's saved on file.
    let customerId: string | undefined;
    if (saveCard) {
      const existing = receiptEmail
        ? await stripe.customers.list({ email: receiptEmail, limit: 1 })
        : { data: [] as Array<{ id: string }> };
      const customer =
        existing.data[0] ??
        (await stripe.customers.create({
          email: receiptEmail,
          name: typeof customerName === 'string' ? customerName : undefined,
        }));
      customerId = customer.id;
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountCents,
      currency: 'usd',
      // Card-only (2026-09-10). Without this Stripe defaults to every
      // dashboard-enabled method, some of which redirect the customer and then
      // REQUIRE a return_url on confirm — which the on-screen CardElement flow
      // doesn't supply, so Stripe flagged the integration. The counter only
      // takes cards here, so pin it to card and the redirect requirement is gone.
      payment_method_types: ['card'],
      receipt_email: receiptEmail,
      description: `Shipping: ${String(carrier).toUpperCase()} — ${serviceName}`,
      // Attach the card up front so funding could be read and the fee priced;
      // the client confirms this same PaymentIntent (handles any 3DS).
      ...(paymentMethodId ? { payment_method: String(paymentMethodId) } : {}),
      ...(customerId ? { customer: customerId, setup_future_usage: 'off_session' } : {}),
      metadata: {
        carrier: String(carrier),
        service: String(serviceName),
        originZip: String(shipmentDetails?.originZip ?? ''),
        destZip: String(shipmentDetails?.destZip ?? ''),
        weightLbs: String(shipmentDetails?.weightLbs ?? ''),
        cardFeeUSD: feeUSD.toFixed(2),
        // Recorded so submit can confirm the label being minted was paid for by
        // THIS PaymentIntent (empty when binding is off).
        quoteIds: boundQuoteIds.join(','),
      },
    });

    return NextResponse.json({
      clientSecret: paymentIntent.client_secret,
      feeUSD,
      totalUSD,
      funding,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
