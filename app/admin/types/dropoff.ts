import type { CarrierKey } from './shipping';

/** Drop-off labels are usually one of the four carriers; 'other' is a fallback. */
export type DropoffCarrier = CarrierKey | 'other';

/** One scanned drop-off package — stored in slpack.dropoffs. */
export interface DropoffRecord {
  id: string;
  timestamp: string; // ISO — scan date/time
  trackingNumber: string;
  carrier: DropoffCarrier;
  /** Optional customer contact captured at the counter */
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;
  /** Whether a receipt email was sent at scan time */
  receiptEmailed?: boolean;
  /** Groups packages scanned for the same customer onto one receipt */
  batchId?: string;
}

export type DropoffPeriod = 'today' | 'mtd' | 'ytd';
