export interface ShipmentInput {
  originZip: string;
  originCountry: string;
  destStreet: string;
  /** Optional apartment / suite / unit number (second address line) */
  destStreet2?: string;
  destZip: string;
  destCity: string;
  destState: string;
  destCountry: string;
  /** Optional "ATTN:" line for the recipient — printed on the label address. */
  destAttention?: string;
  /** True = residential delivery (carrier surcharge applies); false = commercial. */
  residential: boolean;
  weightLbs: number;
  lengthIn: number;
  widthIn: number;
  heightIn: number;
  declaredValueUSD: number;
  /** Recipient (ship-to) contact */
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  /** Sender (paying customer at the counter) — used for Stripe billing details
   *  and as the carrier label's ship-from contact when present */
  senderName?: string;
  senderPhone?: string;
  senderEmail?: string;
}

export interface ShippingRate {
  serviceCode: string;
  serviceName: string;
  totalChargeUSD: number;
  estimatedDays: number | null;
  deliveryDate: string | null;
  /** True when package is 108–130" combined length+girth (oversized surcharge applies) */
  oversized?: boolean;
}

export type CarrierKey = 'fedex' | 'ups' | 'usps' | 'dhl';

export interface CarrierResult {
  carrier: CarrierKey;
  rates: ShippingRate[];
  error: string | null;
  loading: boolean;
  lastFetched: string | null;
}

export interface SelectedRate {
  carrier: CarrierKey;
  rate: ShippingRate;
  shipment: ShipmentInput;
  insurance: InsuranceOption;
}

/** A single package queued in the multi-package cart */
export interface CartItem {
  id: string;
  carrier: CarrierKey;
  rate: ShippingRate;
  shipment: ShipmentInput;
  insurance: InsuranceOption;
  /** International only: prepaid duties (DDP) collected from the customer,
   *  added to the charge total. Undefined for domestic — totals unaffected. */
  dutiesUSD?: number;
}

/** A printable document returned by a carrier (label, commercial invoice, …).
 *  Used by the international flow; optional on domestic results (never set there). */
export interface ShipmentDocument {
  type: 'LABEL' | 'COMMERCIAL_INVOICE' | 'OTHER';
  /** Base64-encoded document payload. */
  base64: string;
  mimeType: string;
}

/** Result returned after submitting a CartItem to a carrier */
export interface CartResult {
  item: CartItem;
  /** Stored shipment-log id — lets the label print via /api/shipping/label/[id]
   *  (native viewer, true scale), the same proven path as the Reports reprint. */
  shipmentId?: string | null;
  trackingNumber: string;
  labelBase64: string | null;
  labelMimeType: string | null;
  labelError: string | null;
  /** International only: all documents to print (label + commercial invoice).
   *  Undefined for domestic shipments, so existing domestic code is unaffected. */
  documents?: ShipmentDocument[];
}

export interface InsuranceOption {
  enabled: boolean;
  /** Declared value in USD — mirrors shipment.declaredValueUSD */
  valueUSD: number;
  /** Carrier declared-value (liability) fee — see lib/shippingPricing declaredValueFee */
  premiumUSD: number;
  /** Optional description of what's being insured (for records / claims) */
  description?: string;
}

/** Stored in /api/shipping/log — one entry per completed shipment */
export interface ShipmentLogEntry {
  id: string;
  timestamp: string; // ISO
  carrier: CarrierKey;
  serviceName: string;
  originZip: string;
  destZip: string;
  destCity: string;
  destState: string;
  weightLbs: number;
  shippingUSD: number;
  insuranceUSD: number;
  packingFeeUSD?: number;
  /** International only: prepaid duties (DDP) collected from the customer. */
  dutiesUSD?: number;
  /** Credit-card processing surcharge added to this shipment's charge (card only). */
  cardFeeUSD?: number;
  totalUSD: number;
  trackingNumber: string | null;
  labelBase64: string | null;
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  /** "ATTN:" line for the recipient, if provided */
  destAttention?: string;
  /** Description of the insured contents, if declared-value coverage was added */
  insuranceDescription?: string;
  paymentMethod?: 'card' | 'cash';
  /** Ties this shipment to a combined register+shipping transaction (one charge, one receipt) */
  transactionId?: string;
  /** Sender info captured when creating the shipment (for re-creating ship-from contact) */
  senderName?: string;
  senderPhone?: string;
  senderEmail?: string;
  /** Void state — voided shipments are excluded from revenue totals */
  voided?: boolean;
  voidedAt?: string; // ISO
  voidReason?: string;
  /** Outcome of the carrier-side cancel attempt (success/failed/skipped/manual) */
  voidCarrierStatus?: 'success' | 'failed' | 'skipped' | 'manual';
  voidCarrierMessage?: string;
  /** True once the carrier has actually scanned/accepted the package. Only
   *  accepted shipments count toward carrier balances owed. */
  accepted?: boolean;
  acceptedAt?: string;       // ISO of first carrier scan
  acceptanceCheckedAt?: string; // ISO of last tracking poll
  acceptedSource?: 'tracking' | 'manual';
}

/** Stored in /api/shipping/errors — one entry per server-side API error */
export interface ErrorLogEntry {
  id: string;
  timestamp: string; // ISO
  route: string; // e.g. 'shipping/fedex'
  carrier?: CarrierKey;
  /** HTTP status returned to the client */
  status: number;
  /** Short human-readable message */
  message: string;
  /** Upstream carrier HTTP status, when the failure was a forwarded response */
  upstreamStatus?: number;
  /** Upstream response body excerpt (truncated to ~2 KB) — vendor JSON/HTML */
  upstreamBody?: string;
  /** Sanitized request summary (no PII — zip/country/weight/dims only) */
  requestSummary?: Record<string, unknown>;
  /** Stack trace — recorded in development only */
  stack?: string;
}

