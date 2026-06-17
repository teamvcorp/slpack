import { NextRequest, NextResponse } from 'next/server';
import { readSalesSince } from '@/lib/saleLog';
import { readShipmentsSince } from '@/lib/shipmentLog';
import { reportPeriodStart, type ReportPeriod } from '@/lib/reportPeriod';
import type { UnifiedSale } from '@/app/admin/types/reports';

const VALID: ReportPeriod[] = ['today', 'mtd', 'ytd'];

const CARRIER_LABELS: Record<string, string> = {
  fedex: 'FedEx',
  ups: 'UPS',
  usps: 'USPS',
  dhl: 'DHL',
};

/**
 * Unified sales feed for the Reports → Sales tab: register POS sales merged with
 * shipping sales, newest first. Money totals exclude voided shipments (matching
 * the shipping log), but voided rows are still returned so they can be shown.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const raw = searchParams.get('period') ?? 'today';
  const period: ReportPeriod = (VALID as string[]).includes(raw) ? (raw as ReportPeriod) : 'today';

  const since = reportPeriodStart(period).toISOString();
  const [sales, shipments] = await Promise.all([
    readSalesSince(since),
    readShipmentsSince(since),
  ]);

  const registerEntries: UnifiedSale[] = sales.map((s) => ({
    id: s.id,
    source: 'register',
    timestamp: s.timestamp,
    summary: s.items.map((i) => `${i.quantity}× ${i.name}`).join(', '),
    paymentMethod: s.paymentMethod,
    customerName: '',
    customerEmail: s.customerEmail ?? '',
    subtotalUSD: s.subtotalUSD,
    taxUSD: s.taxUSD,
    totalUSD: s.totalUSD,
    register: s,
  }));

  const shippingEntries: UnifiedSale[] = shipments.map((e) => {
    const carrierLabel = CARRIER_LABELS[e.carrier] ?? e.carrier.toUpperCase();
    const tracking = e.trackingNumber ? ` · ${e.trackingNumber}` : '';
    return {
      id: e.id,
      source: 'shipping',
      timestamp: e.timestamp,
      summary: `${carrierLabel} ${e.serviceName}${tracking}`,
      paymentMethod: e.paymentMethod === 'cash' ? 'cash' : 'card',
      customerName: e.customerName ?? '',
      customerEmail: e.customerEmail ?? '',
      subtotalUSD: e.totalUSD,
      taxUSD: 0,
      totalUSD: e.totalUSD,
      voided: Boolean(e.voided),
      shipment: e,
    };
  });

  const entries = [...registerEntries, ...shippingEntries].sort((a, b) =>
    a.timestamp < b.timestamp ? 1 : a.timestamp > b.timestamp ? -1 : 0
  );

  // Voided shipping sales are listed but excluded from revenue/payment totals.
  const counted = entries.filter((e) => !e.voided);
  const totalRevenue = counted.reduce((s, e) => s + e.totalUSD, 0);
  const totalTax = counted.reduce((s, e) => s + e.taxUSD, 0);
  const byPayment = counted.reduce<Record<string, { count: number; revenue: number }>>((acc, e) => {
    acc[e.paymentMethod] = acc[e.paymentMethod] ?? { count: 0, revenue: 0 };
    acc[e.paymentMethod].count += 1;
    acc[e.paymentMethod].revenue += e.totalUSD;
    return acc;
  }, {});

  return NextResponse.json({
    period,
    entries,
    total: counted.length,
    totalRevenue,
    totalTax,
    byPayment,
  });
}
