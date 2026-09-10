import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { appendLog } from '@/lib/shipmentLog';
import { appendError } from '@/lib/errorLog';
import { logAndRespond } from '@/lib/apiErrors';
import { sanitizeEmail } from '@/lib/email';
import { INTERNAL_HEADER, internalApiToken } from '@/lib/internalAuth';
import { upsertContacts } from '@/lib/contacts';
import { buildShipmentReceiptHtml } from '@/lib/receipt';
import { priceInsurance } from '@/lib/shippingPricing';
import { sendMoneyAlert } from '@/lib/alerts';
import { paymentBindingEnabled, getValidQuote, consumeQuote } from '@/lib/quoteStore';
import { normalizeSignature } from '@/lib/signatureOption';
import { normalizeSimpleRateTier } from '@/lib/upsSimpleRate';
import type { ShipmentLogEntry } from '@/app/admin/types/shipping';

const ROUTE = 'shipping/submit';

export async function POST(req: NextRequest) {
  try {
    const {
      carrier,
      serviceName,
      serviceCode,
      saturdayDelivery,
      rateSource,
      listPriceUSD,
      priceOverridden,
      simpleRateTier,
      simpleRateQuotedUSD,
      shipment,
      shippingUSD,
      insuranceUSD,
      packingFeeUSD,
      cardFeeUSD,
      totalUSD,
      insurance,
      paymentMethod,
      transactionId,
      suppressEmail,
      paymentIntentId,
      quoteId,
    } = await req.json();

    // Whitelist the carrier before it is interpolated into the internal label
    // URL below (`/api/shipping/${carrier}/label`). Unconstrained, a value like
    // "../.." could redirect that authenticated self-call to another route on
    // our origin. (2026-09-10)
    const VALID_CARRIERS = ['fedex', 'ups', 'usps', 'dhl'];
    if (!VALID_CARRIERS.includes(carrier)) {
      return NextResponse.json({ error: 'Unknown carrier' }, { status: 400 });
    }

    // ── 0. Re-price insurance server-side ────────────────────────────────────
    // The browser picks the declared value, so it is an untrusted input: derive
    // the premium here from valueUSD instead of accepting the client's figure,
    // and clamp the value to the carrier cap before it reaches the label call.
    const pricedInsurance = priceInsurance(insurance, carrier, serviceName, shipment?.packaging);
    const insuranceChargeUSD = pricedInsurance.premiumUSD;

    // What the server says the premium *should* have been, for comparison below.
    const expectedTotalUSD =
      Math.round(
        (Number(shippingUSD) +
          insuranceChargeUSD +
          Number(packingFeeUSD ?? 0) +
          Number(cardFeeUSD ?? 0)) *
          100
      ) / 100;

    // The shipment log is the revenue book (/api/reports/sales sums totalUSD), so
    // it records MONEY COLLECTED, not a recomputed price. Payment is captured
    // before this route runs: writing the server's figure here when the two
    // disagree would overstate revenue and break reconciliation against the
    // Stripe payout. The server's price goes in the error log instead, so the
    // gap is visible and chaseable without corrupting the books.
    const num = (v: unknown, fallback: number) =>
      Number.isFinite(Number(v)) ? Number(v) : fallback;
    const collectedInsuranceUSD = num(insuranceUSD, num(insuranceChargeUSD, 0));
    // totalUSD is the revenue figure the reports SUM, so it must never be NaN —
    // a single non-finite value poisons the whole report total. Chain the
    // fallbacks so the result is always finite (client total → server expected →
    // freight), never NaN. (fix 2026-09-10)
    const collectedTotalUSD = num(totalUSD, num(expectedTotalUSD, Number(shippingUSD) || 0));

    if (Math.abs(collectedInsuranceUSD - insuranceChargeUSD) > 0.01) {
      await appendError({
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        route: ROUTE,
        carrier,
        status: 200,
        message:
          `Insurance underpriced by the client — collected $${collectedInsuranceUSD.toFixed(2)}, ` +
          `should have been $${insuranceChargeUSD.toFixed(2)}. Most likely a browser tab left ` +
          `open across a deploy; the customer was charged the lower amount.`,
        requestSummary: {
          serviceName,
          declaredValueUSD: pricedInsurance.valueUSD,
          collectedInsuranceUSD,
          expectedInsuranceUSD: insuranceChargeUSD,
          collectedTotalUSD,
          expectedTotalUSD,
          shortfallUSD: Math.round((expectedTotalUSD - collectedTotalUSD) * 100) / 100,
        },
      });
      await sendMoneyAlert('Insurance underpriced at the counter', [
        `Service: ${carrier} ${serviceName}`,
        `Collected insurance: $${collectedInsuranceUSD.toFixed(2)}`,
        `Should have been:    $${insuranceChargeUSD.toFixed(2)}`,
        `Declared value: $${pricedInsurance.valueUSD.toFixed(2)}`,
        'Likely a browser tab left open across a deploy. Check Reports → Errors.',
      ]);
    }

    // ── 0b. Payment binding gate (flag-gated) ────────────────────────────────
    // With PAYMENT_BINDING_ENABLED, a label is not minted unless a real payment
    // covers it: validate the server-stored quote, and for card sales confirm
    // the PaymentIntent SUCCEEDED and names this quote. This runs BEFORE the
    // label call, so a tampered/absent payment is refused without spending a
    // carrier label. The quote is consumed only AFTER the label succeeds, so a
    // failed label leaves it reusable for Regenerate. Off -> unchanged.
    //
    // Freight then comes from the quote (boundFreightUSD), server-authoritative,
    // rather than the client's shippingUSD.
    let boundFreightUSD: number | null = null;
    let boundQuoteId: string | null = null;
    // Bind the STANDALONE shipping checkout only. Combined register+shipping
    // sales carry a transactionId and are priced through /api/register/checkout
    // — a different flow that isn't quote-bound yet, so leave it on its existing
    // path rather than 409 every combined sale. (Follow-up: bind that flow too.)
    if (paymentBindingEnabled() && !transactionId) {
      const q = await getValidQuote(String(quoteId ?? ''));
      if (!q) {
        return NextResponse.json(
          { error: 'Shipping quote is invalid, expired, or already used. Please re-quote.' },
          { status: 409 }
        );
      }
      // Honor a staff price override (frequent-shipper discount): record the
      // override total the customer was actually charged, otherwise the quote's
      // authoritative price. The override is a deliberate authenticated action,
      // already flagged on the shipment log (priceOverridden) and audited in
      // create-payment-intent. The override PaymentIntent still NAMES this quote
      // in its metadata, so the verification below passes normally.
      boundFreightUSD =
        priceOverridden === true ? Number(shippingUSD) || q.retailUSD : q.retailUSD;
      boundQuoteId = q.quoteId;
      if (paymentMethod !== 'cash') {
        const pid = String(paymentIntentId ?? '');
        if (!pid) {
          return NextResponse.json(
            { error: 'Payment required before a label can be created.' },
            { status: 402 }
          );
        }
        try {
          const Stripe = (await import('stripe')).default;
          const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? '', {
            apiVersion: '2025-02-24.acacia',
          });
          const pi = await stripe.paymentIntents.retrieve(pid);
          // Reader (in-person tap) PIs are priced by /api/terminal/collect and
          // don't carry quoteIds; a succeeded reader PI is accepted without the
          // quote-name check so tap-and-pay keeps working under binding (its own
          // route is deliberately untouched). Elements/saved-card PIs must name
          // this quote.
          const viaReader = pi.metadata?.source === 'terminal';
          const paidQuotes = String(pi.metadata?.quoteIds ?? '').split(',').filter(Boolean);
          if (pi.status !== 'succeeded' || !(viaReader || paidQuotes.includes(q.quoteId))) {
            return NextResponse.json(
              { error: 'Payment could not be verified for this shipment.' },
              { status: 402 }
            );
          }
        } catch {
          return NextResponse.json(
            { error: 'Payment could not be verified.' },
            { status: 402 }
          );
        }
      }
    }

    // ── 1. Generate label via carrier API ───────────────────────────────────
    // Attempt twice: carrier label APIs occasionally throw transient errors, and
    // a one-off failure shouldn't leave a paid shipment without a label. Both
    // attempts happen before we log, so a retry never creates a duplicate entry.
    let trackingNumber = 'PENDING';
    let labelBase64: string | null = null;
    let labelMimeType: string | null = null;
    let labelError: string | null = null;
    // Actual carrier charge for the label, when the carrier reports one.
    let carrierCostUSD: number | null = null;

    for (let attempt = 1; attempt <= 2; attempt++) {
      labelError = null;
      try {
        const labelRes = await fetch(
          `${process.env.NEXT_PUBLIC_BASE_URL ?? 'http://localhost:3000'}/api/shipping/${carrier}/label`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', [INTERNAL_HEADER]: internalApiToken() },
            // saturdayDelivery must be forwarded or the label books standard
            // Mon–Fri delivery even though a Saturday rate was quoted/charged.
            // (serviceName already carries the "— Saturday Delivery" suffix from
            // the rate route — never re-append it here.)
            body: JSON.stringify({
              shipment,
              serviceCode,
              // Normalized/capped, never the raw client object.
              insurance: pricedInsurance,
              saturdayDelivery: saturdayDelivery === true,
              // Re-validated against the shipment inside the label route — the
              // tier that arrives from the browser is a hint, not an authority.
              simpleRateTier,
            }),
          }
        );
        const labelData = await labelRes.json();
        if (labelRes.ok) {
          trackingNumber = labelData.trackingNumber ?? 'PENDING';
          labelBase64 = labelData.labelBase64 ?? null;
          labelMimeType = labelData.labelMimeType ?? null;
          carrierCostUSD = Number.isFinite(Number(labelData.carrierCostUSD))
            ? Number(labelData.carrierCostUSD)
            : null;
          break;
        }
        const detail = labelData.details ? ` — ${labelData.details}` : '';
        labelError = (labelData.error ?? `Label API error (${labelRes.status})`) + detail;
      } catch (err: unknown) {
        labelError = err instanceof Error ? err.message : 'Label generation failed';
      }
    }

    // Consume the quote only now that the label actually printed — a failed
    // label leaves it valid so Regenerate (which re-calls this route) still
    // works. Atomic single-use: a duplicate submit for the same quote is refused.
    if (boundQuoteId && !labelError) {
      await consumeQuote(boundQuoteId);
    }

    // ── 1b. Below-cost backstop ──────────────────────────────────────────────
    // The freight price is set in the browser (and staff can now override it),
    // so it is an untrusted figure. carrierCostUSD comes straight from the
    // carrier's ship response, which makes it the one authoritative cost we
    // have — and it only exists after the label call above.
    //
    // Payment is already captured by the time this runs, so this cannot reject:
    // rejecting would leave a charged customer with no label. It records the
    // shortfall instead, the same way the insurance mismatch above does, so a
    // shipment sold below cost is visible and chaseable rather than silent.
    // Simple Rate re-rate detection. The flat tier is declared from OUR measured
    // dimensions; UPS measures the box at the hub. If the billed cost comes back
    // above the tier price we quoted, UPS re-tiered the parcel — which means the
    // counter's measuring or our tier maths is off, and every similar parcel is
    // quietly losing the difference. Not a loss on this shipment (the customer
    // paid carrier retail), so it is logged rather than raised.
    const quotedSimple = Number(simpleRateQuotedUSD);
    if (
      normalizeSimpleRateTier(simpleRateTier) &&
      carrierCostUSD !== null &&
      Number.isFinite(quotedSimple) &&
      quotedSimple > 0 &&
      carrierCostUSD > quotedSimple + 0.01
    ) {
      await appendError({
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        route: ROUTE,
        carrier,
        status: 200,
        message:
          `UPS RE-RATED a Simple Rate parcel — declared tier ${simpleRateTier} quoted at ` +
          `$${quotedSimple.toFixed(2)}, billed $${carrierCostUSD.toFixed(2)} ` +
          `(+$${(carrierCostUSD - quotedSimple).toFixed(2)}). Re-check the box measurements ` +
          `and the tier thresholds in lib/upsSimpleRate.ts.`,
        requestSummary: {
          serviceName,
          simpleRateTier,
          quotedSimpleRateUSD: quotedSimple,
          billedUSD: carrierCostUSD,
          weightLbs: shipment?.weightLbs,
          lengthIn: shipment?.lengthIn,
          widthIn: shipment?.widthIn,
          heightIn: shipment?.heightIn,
        },
      });
    }

    // Bound freight (from the quote) is the authoritative figure when binding is
    // on; otherwise the client's collected amount.
    const collectedFreightUSD = boundFreightUSD ?? (Number(shippingUSD) || 0);
    if (carrierCostUSD !== null && collectedFreightUSD < carrierCostUSD) {
      await appendError({
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        route: ROUTE,
        carrier,
        status: 200,
        message:
          `Shipment sold BELOW CARRIER COST — collected $${collectedFreightUSD.toFixed(2)} freight ` +
          `against a $${carrierCostUSD.toFixed(2)} carrier charge, a ` +
          `$${(carrierCostUSD - collectedFreightUSD).toFixed(2)} loss.` +
          (priceOverridden === true
            ? ' The price was set manually at the counter.'
            : ' The price came from the pricing formula — check the rate quote.'),
        requestSummary: {
          serviceName,
          collectedFreightUSD,
          carrierCostUSD,
          lossUSD: Math.round((carrierCostUSD - collectedFreightUSD) * 100) / 100,
          rateSource,
          listPriceUSD,
          priceOverridden: priceOverridden === true,
        },
      });
      await sendMoneyAlert('Shipment sold BELOW CARRIER COST', [
        `Service: ${carrier} ${serviceName}`,
        `Collected freight: $${collectedFreightUSD.toFixed(2)}`,
        `Carrier charge:    $${carrierCostUSD.toFixed(2)}`,
        `Loss: $${(carrierCostUSD - collectedFreightUSD).toFixed(2)}`,
        priceOverridden === true
          ? 'Price was set manually at the counter.'
          : 'Price came from the pricing formula — check the rate quote.',
      ]);
    }

    // ── 2. Append to shipment log ────────────────────────────────────────────
    const entry: ShipmentLogEntry = {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      carrier,
      serviceName,
      originZip: shipment.originZip,
      destZip: shipment.destZip,
      destCity: shipment.destCity ?? '',
      destState: shipment.destState ?? '',
      weightLbs: Number(shipment.weightLbs) || 0,
      lengthIn: Number(shipment.lengthIn) || undefined,
      widthIn: Number(shipment.widthIn) || undefined,
      heightIn: Number(shipment.heightIn) || undefined,
      // Server-authoritative when binding is on; the collected client figure otherwise.
      shippingUSD: boundFreightUSD ?? Number(shippingUSD),
      insuranceUSD: collectedInsuranceUSD,
      packingFeeUSD: Number(packingFeeUSD ?? 0),
      cardFeeUSD: Number(cardFeeUSD) > 0 ? Number(cardFeeUSD) : undefined,
      totalUSD: collectedTotalUSD,
      carrierCostUSD: carrierCostUSD ?? undefined,
      // carrierCostUSD is always the negotiated figure. Recording which price
      // book the QUOTE used lets the margin report size the gap between the two
      // — a 'published' quote against a negotiated bill is where retail drifts
      // above the intended markup. Whitelisted rather than trusted verbatim.
      rateSource: rateSource === 'published' || rateSource === 'negotiated' ? rateSource : undefined,
      listPriceUSD: Number.isFinite(Number(listPriceUSD)) && Number(listPriceUSD) > 0
        ? Number(listPriceUSD)
        : undefined,
      priceOverridden: priceOverridden === true ? true : undefined,
      trackingNumber,
      labelBase64,
      customerName: shipment.customerName ?? '',
      customerPhone: shipment.customerPhone ?? '',
      customerEmail: shipment.customerEmail ?? '',
      // Persist the sender too, so a reprint/resend can reach the paying customer
      // and the record is complete. (2026-09-10)
      senderName: shipment.senderName || undefined,
      senderPhone: shipment.senderPhone || undefined,
      senderEmail: shipment.senderEmail || undefined,
      destAttention: shipment.destAttention?.trim() || undefined,
      insuranceDescription: pricedInsurance.description,
      paymentMethod: (paymentMethod === 'cash' ? 'cash' : 'card') as 'card' | 'cash',
      saturdayDelivery: saturdayDelivery === true ? true : undefined,
      // Read off the shipment (which submit already forwards whole to the label
      // route), whitelisted the same way the label route does it.
      signature: normalizeSignature(shipment?.signature) === 'none'
        ? undefined
        : normalizeSignature(shipment?.signature),
      simpleRateTier: normalizeSimpleRateTier(simpleRateTier) ?? undefined,
      transactionId: typeof transactionId === 'string' ? transactionId : undefined,
    };

    await appendLog(entry);

    // ── 3. Save sender → recipient contacts (one-to-many) ────────────────────
    try {
      await upsertContacts({
        sender: {
          name: shipment.senderName ?? '',
          phone: shipment.senderPhone ?? '',
          email: shipment.senderEmail ?? '',
        },
        recipient: {
          name: shipment.customerName ?? '',
          phone: shipment.customerPhone ?? '',
          email: shipment.customerEmail ?? '',
          street: shipment.destStreet ?? '',
          street2: shipment.destStreet2 ?? '',
          city: shipment.destCity ?? '',
          state: shipment.destState ?? '',
          zip: shipment.destZip ?? '',
          country: shipment.destCountry ?? 'US',
        },
      });
    } catch {
      // non-fatal — contact save failure should not block the shipment
    }

    // ── 4. Send receipt email via Resend ─────────────────────────────────────
    // Combined register+shipping sales email one unified receipt from the
    // checkout flow, so the per-package email is suppressed here.
    // Send the tracking receipt to the SENDER (the paying customer) when we have
    // their address, otherwise the recipient. Previously it only went to the
    // recipient's email, so a sender who wanted their own tracking copy never
    // got one. (fix 2026-09-10)
    const recipientEmail = sanitizeEmail(shipment.senderEmail) ?? sanitizeEmail(shipment.customerEmail);
    if (recipientEmail && suppressEmail !== true && process.env.RESEND_API_KEY) {
      try {
        const { Resend } = await import('resend');
        const resend = new Resend(process.env.RESEND_API_KEY);

        const carrierLabel = ({ fedex: 'FedEx', ups: 'UPS', usps: 'USPS', dhl: 'DHL Express' } as Record<string, string>)[carrier] ?? carrier.toUpperCase();
        const fromEmail = process.env.RESEND_FROM_EMAIL ?? 'shipping@stormlakepackandship.com';

        await resend.emails.send({
          from: `Storm Lake Pack & Ship <${fromEmail}>`,
          to: recipientEmail,
          subject: `Your Shipping Receipt — ${carrierLabel} ${trackingNumber}`,
          html: buildShipmentReceiptHtml(entry),
        });
      } catch {
        // Receipt send failure is non-fatal
      }
    }

    return NextResponse.json({ id: entry.id, trackingNumber, labelBase64, labelMimeType, labelError });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return await logAndRespond({
      route: ROUTE,
      status: 500,
      message,
      err,
    });
  }
}
