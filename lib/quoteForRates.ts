import client from '@/lib/mongodb';
import { paymentBindingEnabled, createQuote } from '@/lib/quoteStore';
import { carrierAnchoredPrice } from '@/lib/shippingPricing';
import {
  costBasisUSD,
  incentiveFor,
  normalizeCarrierIncentives,
} from '@/lib/carrierIncentive';
import { classifyService } from '@/lib/serviceClass';

/** The minimum a rate must expose for pricing. The carrier routes' rate objects
 *  (which carry more fields, and type rateSource as a plain string) satisfy this
 *  structurally, so the helper stays generic over their exact shape. */
type Quotable = {
  serviceCode: string;
  serviceName: string;
  totalChargeUSD: number;
  rateSource?: string | null;
  listPriceUSD?: number | null;
};

/**
 * Attach a server-side quote id to each rate, when payment binding is on.
 *
 * The customer-facing price is computed here with the SAME formula the browser
 * uses — costBasisUSD(...incentives) → carrierAnchoredPrice — reading the same
 * carrier-incentive settings, so the quote's retail equals what the counter
 * displays and charges. Storing it server-side is what lets the billing route
 * recompute the amount instead of trusting the browser.
 *
 * INERT when the flag is off: returns the rates untouched, does no DB work, adds
 * no latency to the normal rate response. Best-effort even when on — if quoting
 * fails, the rate is returned WITHOUT a quoteId rather than failing the whole
 * rate request (the checkout then falls back to its client amount).
 */
export async function attachQuotes<T extends Quotable>(
  carrier: string,
  rates: T[]
): Promise<Array<T & { quoteId?: string }>> {
  if (!paymentBindingEnabled()) return rates;
  let incentives;
  try {
    await client.connect();
    const doc = await client
      .db('slpack')
      .collection<{ _id: string; incentives?: unknown }>('settings')
      .findOne({ _id: 'carrierIncentives' });
    incentives = normalizeCarrierIncentives(doc?.incentives);
  } catch (err) {
    console.error('[quoteForRates] settings load failed', err instanceof Error ? err.message : err);
    return rates; // best-effort: no quotes rather than a failed rate response
  }

  const out: Array<T & { quoteId?: string }> = [];
  for (const rate of rates) {
    let quoteId: string | undefined;
    try {
      const basis = costBasisUSD({
        // totalChargeUSD is the account rate only when the carrier said so.
        accountUSD: rate.rateSource === 'negotiated' ? rate.totalChargeUSD : null,
        listUSD: rate.listPriceUSD ?? null,
        incentivePct: incentiveFor(incentives, carrier, classifyService(rate.serviceName)),
        quotedUSD: rate.totalChargeUSD,
      });
      const retailUSD = carrierAnchoredPrice(basis, rate.listPriceUSD);
      ({ quoteId } = await createQuote({
        carrier,
        serviceCode: rate.serviceCode,
        serviceName: rate.serviceName,
        costBasisUSD: basis,
        retailUSD,
      }));
    } catch (err) {
      console.error('[quoteForRates] rate quote failed', err instanceof Error ? err.message : err);
    }
    out.push({ ...rate, quoteId });
  }
  return out;
}
