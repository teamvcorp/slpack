import type { SaleRecord } from './register';
import type { ShipmentLogEntry } from './shipping';

/**
 * A single transaction in the unified Sales report — either a register POS sale
 * or a shipping sale. Carries the full source record so the client can rebuild
 * the correct receipt for reprint without an extra round-trip.
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
  /** Raw source record (exactly one is present, per `source`) */
  register?: SaleRecord;
  shipment?: ShipmentLogEntry;
}

export interface UnifiedSalesResponse {
  period: string;
  entries: UnifiedSale[];
  total: number;
  totalRevenue: number;
  totalTax: number;
  byPayment: Record<string, { count: number; revenue: number }>;
}
