import type { SaleRecord } from './register';
import type { ShipmentListEntry } from './shipping';

/**
 * A single transaction in the unified Sales report — either a register POS sale
 * or a shipping sale. Carries enough of the source record for the client to
 * rebuild the receipt for reprint without an extra round-trip.
 *
 * The shipping side is a ShipmentListEntry, NOT the full log entry: the stored
 * label image is deliberately withheld from list responses (see that type), and
 * a receipt never needed it. The label itself is fetched by id when printed.
 */
export interface UnifiedSale {
  id: string;
  source: 'register' | 'shipping';
  timestamp: string; // ISO
  /** Short human summary — register item list, or "UPS Ground · 1Z…" for shipping */
  summary: string;
  paymentMethod: 'card' | 'cash';
  customerName: string;
  customerEmail: string;
  subtotalUSD: number;
  taxUSD: number;
  totalUSD: number;
  /** Shipping only — voided sales are listed but excluded from money totals */
  voided?: boolean;
  /** Source record (exactly one is present, per `source`) */
  register?: SaleRecord;
  shipment?: ShipmentListEntry;
}

export interface UnifiedSalesResponse {
  period: string;
  entries: UnifiedSale[];
  total: number;
  totalRevenue: number;
  totalTax: number;
  byPayment: Record<string, { count: number; revenue: number }>;
  /** Shipment row cap hit — totals cover only the rows returned. */
  truncated?: boolean;
}
