import client from '@/lib/mongodb';
import { INTERNAL_HEADER, internalApiToken } from '@/lib/internalAuth';
import { SITE } from '@/lib/siteConfig';
import { carrierAnchoredPrice } from '@/lib/shippingPricing';
import {
  costBasisUSD,
  incentiveFor,
  normalizeCarrierIncentives,
} from '@/lib/carrierIncentive';
import { classifyService } from '@/lib/serviceClass';
import { computePackingPrice, normalizePackingRates, type PackingRates } from '@/lib/boxOptimizer';
import {
  createPartnerQuote,
  type PartnerMode,
  type PartnerQuoteDest,
  type PartnerQuotePackage,
} from '@/lib/partnerQuoteStore';

/**
 * Rating for the Partner Shipping API (2026-09-10).
 *
 * Deliberately ISOLATED from the counter's lib/quoteForRates.ts: it does not
 * touch attachQuotes / lib/quoteStore, so nothing here can change counter
 * behavior. It reuses the carrier rate ROUTES by internal HTTP call (the same
 * mechanism submit uses to mint labels) and the shared, read-only pricing
 * helpers, so partner retail equals the counter retail for the same parcel.
 *
 * What leaves this module is RETAIL ONLY. Carrier cost, list price, rate source,
 * and cost basis are consumed here to price the quote and then dropped — they
 * are never returned to the partner, and the quote store keeps cost server-side.
 */

/** Carriers offered to partners in v1 (domestic). */
const PARTNER_CARRIERS = ['ups', 'fedex', 'usps'] as const;

/** The shop is always the origin — partners never specify it. */
const ORIGIN_ZIP = SITE.address.postalCode;

/** A carrier rate as returned by /api/shipping/{carrier}. Cost-bearing. */
interface CarrierRate {
  serviceCode: string;
  serviceName: string;
  totalChargeUSD: number;
  estimatedDays?: number | null;
  deliveryDate?: string | null;
  rateSource?: string | null;
  listPriceUSD?: number | null;
  saturdayDelivery?: boolean;
}

/** Retail-only rate handed back to the partner. */
export interface PartnerRate {
  quoteId: string;
  carrier: string;
  serviceName: string;
  serviceCode: string;
  retailUSD: number;
  deliveryDate: string | null;
  estimatedDays: number | null;
}

function baseUrl(): string {
  return process.env.NEXT_PUBLIC_BASE_URL ?? 'http://localhost:3000';
}

/** Load carrier-incentive settings (same source attachQuotes reads). */
async function loadIncentives() {
  await client.connect();
  const doc = await client
    .db('slpack')
    .collection<{ _id: string; incentives?: unknown }>('settings')
    .findOne({ _id: 'carrierIncentives' });
  return normalizeCarrierIncentives(doc?.incentives);
}

/** Load packing rates (same source the box calculator + counter use). */
async function loadPackingRates(): Promise<PackingRates> {
  await client.connect();
  const doc = await client
    .db('slpack')
    .collection<{ _id: string } & Record<string, unknown>>('settings')
    .findOne({ _id: 'packingPricing' });
  return normalizePackingRates(doc ?? undefined);
}

/** Internal-fetch one carrier's rates. Returns [] on any failure (best-effort). */
async function fetchCarrierRates(
  carrier: string,
  dest: PartnerQuoteDest,
  pkg: PartnerQuotePackage
): Promise<CarrierRate[]> {
  try {
    const res = await fetch(`${baseUrl()}/api/shipping/${carrier}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', [INTERNAL_HEADER]: internalApiToken() },
      body: JSON.stringify({
        // Origin forced to the shop — never accepted from the partner.
        originZip: ORIGIN_ZIP,
        destZip: dest.zip,
        destCity: dest.city,
        destState: dest.state,
        destCountry: dest.country,
        residential: dest.residential,
        weightLbs: pkg.weightLbs,
        lengthIn: pkg.lengthIn,
        widthIn: pkg.widthIn,
        heightIn: pkg.heightIn,
      }),
    });
    if (!res.ok) return [];
    const data = await res.json();
    const rates = Array.isArray(data?.rates) ? (data.rates as CarrierRate[]) : [];
    return rates;
  } catch (err) {
    console.error(`[partnerRates] ${carrier} fetch failed`, err instanceof Error ? err.message : err);
    return [];
  }
}

/**
 * Quote a partner shipment across all offered carriers. Prices each service at
 * retail with the counter's formula, adds the packing fee for pickup_pack,
 * stores a single-use quote per service, and returns retail-only options.
 *
 * A service that fails to price is omitted rather than failing the whole quote.
 */
export async function quotePartnerRates(input: {
  partnerId: string;
  dest: PartnerQuoteDest;
  pkg: PartnerQuotePackage;
  mode: PartnerMode;
}): Promise<PartnerRate[]> {
  const { partnerId, dest, pkg, mode } = input;

  const incentives = await loadIncentives();

  // Packing fee is a per-shipment figure (from the box surface area), added to
  // every option's retail for pickup_pack. The partner declares the size; the
  // shop reconciles at pack time if the real box differs. self_ship pays none.
  let packingFeeUSD = 0;
  if (mode === 'pickup_pack') {
    const rates = await loadPackingRates();
    packingFeeUSD = computePackingPrice(
      { lengthIn: pkg.lengthIn, widthIn: pkg.widthIn, heightIn: pkg.heightIn },
      'standard',
      rates
    ).retailUSD;
  }

  const results = await Promise.all(
    PARTNER_CARRIERS.map((c) => fetchCarrierRates(c, dest, pkg).then((r) => [c, r] as const))
  );

  const out: PartnerRate[] = [];
  for (const [carrier, rates] of results) {
    for (const rate of rates) {
      // v1: no Saturday-delivery variants for partners — the partner label path
      // books standard Mon–Fri, so a Saturday-priced option would mismatch.
      if (rate.saturdayDelivery === true) continue;
      try {
        const basis = costBasisUSD({
          accountUSD: rate.rateSource === 'negotiated' ? rate.totalChargeUSD : null,
          listUSD: rate.listPriceUSD ?? null,
          incentivePct: incentiveFor(incentives, carrier, classifyService(rate.serviceName)),
          quotedUSD: rate.totalChargeUSD,
        });
        const freightRetailUSD = carrierAnchoredPrice(basis, rate.listPriceUSD);
        const { quoteId, retailUSD } = await createPartnerQuote({
          partnerId,
          carrier,
          serviceCode: rate.serviceCode,
          serviceName: rate.serviceName,
          mode,
          costBasisUSD: basis,
          freightRetailUSD,
          packingFeeUSD,
          dest,
          pkg,
        });
        out.push({
          quoteId,
          carrier,
          serviceName: rate.serviceName,
          serviceCode: rate.serviceCode,
          retailUSD,
          deliveryDate: rate.deliveryDate ?? null,
          estimatedDays: rate.estimatedDays ?? null,
        });
      } catch (err) {
        // Omit this service, keep the rest.
        console.error('[partnerRates] price failed', err instanceof Error ? err.message : err);
      }
    }
  }

  // Cheapest first — the most useful default ordering for a checkout.
  out.sort((a, b) => a.retailUSD - b.retailUSD);
  return out;
}
