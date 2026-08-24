import { NextRequest, NextResponse } from 'next/server';
import { readShipmentsSince } from '@/lib/shipmentLog';
import { reportPeriodStart, type ReportPeriod } from '@/lib/reportPeriod';
import { classifyService, type ServiceClass } from '@/lib/serviceClass';
import { SHIPPING_MARKUP } from '@/lib/shippingPricing';
import type { RateSource } from '@/app/admin/types/shipping';

const VALID: ReportPeriod[] = ['today', 'mtd', 'ytd'];

const CARRIER_LABELS: Record<string, string> = {
  fedex: 'FedEx',
  ups: 'UPS',
  usps: 'USPS',
  dhl: 'DHL',
};

/**
 * One carrier x service-class group. Two counts on purpose:
 *
 *   count / revenueUSD          — every shipment, i.e. real volume
 *   ratedCount / ratedRevenueUSD — only shipments the carrier gave us a cost for
 *
 * They differ because USPS and DHL label responses carry no rating (see
 * ShipmentLogEntry.carrierCostUSD), so their margin is genuinely unknown. Mixing
 * the two would silently divide UPS costs by USPS+UPS revenue and understate
 * markup. Every margin figure below is derived from the RATED subset only.
 */
interface MarginRow {
  carrier: string;
  carrierLabel: string;
  serviceClass: ServiceClass;
  count: number;
  revenueUSD: number;
  ratedCount: number;
  ratedRevenueUSD: number;
  costUSD: number;
  marginUSD: number;
  /** ratedRevenue / cost — directly comparable to SHIPPING_MARKUP (1.55). */
  markupX: number | null;
  /** Shipments where we collected less than the carrier charged. */
  negativeCount: number;
  /** How many of the rated shipments were QUOTED off a published list price. */
  publishedCount: number;
  negotiatedCount: number;
  unknownSourceCount: number;
  /** Shipments whose freight price staff set by hand. */
  overriddenCount: number;
  /** Shipments we charged MORE for than the carrier's own published retail. */
  aboveCarrierRetailCount: number;
  /** Freight revenue on shipments where the carrier gave us a list price... */
  listedRevenueUSD: number;
  /** ...and the sum of those list prices, so the UI can show what share of the
   *  carrier's own asking price we actually captured. Our markup is a multiple
   *  of COST, so on express this runs well below 100% — that gap is revenue
   *  available without ever charging more than the customer would pay direct. */
  listedRetailUSD: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Margin by carrier and service speed, for the Reports → Margin tab.
 *
 * Exists to answer one question with data instead of instinct: does the flat 55%
 * markup hold across service speeds? A quote priced off a carrier's published
 * rate while the label bills our negotiated rate inflates effective markup well
 * beyond 1.55x, and express is where the published/negotiated spread is widest —
 * so markupX is broken out alongside the published-vs-negotiated quote counts.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const raw = searchParams.get('period') ?? 'mtd';
  const period: ReportPeriod = (VALID as string[]).includes(raw) ? (raw as ReportPeriod) : 'mtd';

  const since = reportPeriodStart(period).toISOString();
  const shipments = await readShipmentsSince(since);

  // Voided shipments were refunded and their labels cancelled — they are not
  // revenue and must not drag the margin figures around.
  const live = shipments.filter((e) => !e.voided);

  const groups = new Map<string, MarginRow>();

  for (const e of live) {
    const serviceClass = classifyService(e.serviceName);
    const key = `${e.carrier}|${serviceClass}`;

    let row = groups.get(key);
    if (!row) {
      row = {
        carrier: e.carrier,
        carrierLabel: CARRIER_LABELS[e.carrier] ?? String(e.carrier).toUpperCase(),
        serviceClass,
        count: 0,
        revenueUSD: 0,
        ratedCount: 0,
        ratedRevenueUSD: 0,
        costUSD: 0,
        marginUSD: 0,
        markupX: null,
        negativeCount: 0,
        publishedCount: 0,
        negotiatedCount: 0,
        unknownSourceCount: 0,
        overriddenCount: 0,
        aboveCarrierRetailCount: 0,
        listedRevenueUSD: 0,
        listedRetailUSD: 0,
      };
      groups.set(key, row);
    }

    // FREIGHT revenue only. totalUSD also carries insurance, the packing fee,
    // the card surcharge and prepaid duties — none of which the carrier's label
    // charge covers, so including them would inflate apparent freight margin.
    // ShipmentLogEntry.carrierCostUSD documents shippingUSD as its counterpart.
    const freight = Number(e.shippingUSD) || 0;
    row.count += 1;
    row.revenueUSD += freight;
    if (e.priceOverridden === true) row.overriddenCount += 1;

    // Where we sat against the carrier's own counter price. Not a loss — but a
    // customer can check it in seconds, so it belongs next to the margin.
    const list = Number(e.listPriceUSD);
    if (Number.isFinite(list) && list > 0) {
      row.listedRevenueUSD += freight;
      row.listedRetailUSD += list;
      if (freight > list) row.aboveCarrierRetailCount += 1;
    }

    const cost = Number(e.carrierCostUSD);
    if (Number.isFinite(cost) && cost > 0) {
      row.ratedCount += 1;
      row.ratedRevenueUSD += freight;
      row.costUSD += cost;
      row.marginUSD += freight - cost;
      if (freight < cost) row.negativeCount += 1;

      const source = e.rateSource as RateSource | undefined;
      if (source === 'published') row.publishedCount += 1;
      else if (source === 'negotiated') row.negotiatedCount += 1;
      else row.unknownSourceCount += 1;
    }
  }

  const rows = [...groups.values()].map((r) => ({
    ...r,
    revenueUSD: round2(r.revenueUSD),
    ratedRevenueUSD: round2(r.ratedRevenueUSD),
    costUSD: round2(r.costUSD),
    marginUSD: round2(r.marginUSD),
    listedRevenueUSD: round2(r.listedRevenueUSD),
    listedRetailUSD: round2(r.listedRetailUSD),
    /** Share of the carrier's own asking price we captured, 0-100+. */
    pctOfCarrierRetail:
      r.listedRetailUSD > 0
        ? Math.round((r.listedRevenueUSD / r.listedRetailUSD) * 1000) / 10
        : null,
    markupX: r.costUSD > 0 ? Math.round((r.ratedRevenueUSD / r.costUSD) * 1000) / 1000 : null,
  }));

  const sum = (pick: (r: MarginRow) => number) => rows.reduce((a, r) => a + pick(r), 0);
  const totalCost = sum((r) => r.costUSD);
  const totalRatedRevenue = sum((r) => r.ratedRevenueUSD);

  return NextResponse.json({
    period,
    rows,
    totals: {
      count: sum((r) => r.count),
      revenueUSD: round2(sum((r) => r.revenueUSD)),
      ratedCount: sum((r) => r.ratedCount),
      ratedRevenueUSD: round2(totalRatedRevenue),
      costUSD: round2(totalCost),
      marginUSD: round2(sum((r) => r.marginUSD)),
      markupX: totalCost > 0 ? Math.round((totalRatedRevenue / totalCost) * 1000) / 1000 : null,
      negativeCount: sum((r) => r.negativeCount),
      publishedCount: sum((r) => r.publishedCount),
      overriddenCount: sum((r) => r.overriddenCount),
      aboveCarrierRetailCount: sum((r) => r.aboveCarrierRetailCount),
      listedRevenueUSD: round2(sum((r) => r.listedRevenueUSD)),
      listedRetailUSD: round2(sum((r) => r.listedRetailUSD)),
      /** Money left on the table against the carrier's own retail. */
      headroomUSD: round2(sum((r) => r.listedRetailUSD) - sum((r) => r.listedRevenueUSD)),
      pctOfCarrierRetail:
        sum((r) => r.listedRetailUSD) > 0
          ? Math.round((sum((r) => r.listedRevenueUSD) / sum((r) => r.listedRetailUSD)) * 1000) / 10
          : null,
    },
    /** The intended markup, so the UI can show target vs actual side by side. */
    targetMarkupX: SHIPPING_MARKUP,
    /** Shipments with no carrier rating (USPS/DHL) — margin genuinely unknown. */
    unratedCount: sum((r) => r.count - r.ratedCount),
  });
}
