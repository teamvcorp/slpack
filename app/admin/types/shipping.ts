/** Packaging the customer's item ships in. FedEx-only for now: FEDEX_ENVELOPE
 *  gets FedEx's (cheaper) envelope pricing — Express services only, envelope
 *  rate applies up to 8 oz, dimensions omitted (FedEx knows its own packaging).
 *  Other carriers ignore this and quote as a parcel. Absent = YOUR_PACKAGING.
 *  To add more FedEx types later: extend this union, the ShipmentForm dropdown,
 *  and the whitelist in the FedEx rate/label routes (see fedex_packaging_notes.md). */
export type PackagingType = 'YOUR_PACKAGING' | 'FEDEX_ENVELOPE';

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
  /** Optional packaging selection (see PackagingType). Undefined = your own box. */
  packaging?: PackagingType;
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
  /** True = this rate is the carrier's Saturday-delivery variant. The Saturday
   *  surcharge is ALREADY included in totalChargeUSD (FedEx folds it into
   *  totalNetFedExCharge; UPS into the rated total) — never add it again.
   *  Must be forwarded to the label route or the label books standard
   *  (Mon–Fri) delivery. See saturday_delivery_notes.md. */
  saturdayDelivery?: boolean;
  /** Which price book totalChargeUSD came from.
   *
   *  'negotiated' = our account rate, i.e. what the carrier actually bills us.
   *  'published'  = the carrier returned no account rate and we fell back to the
   *                 public list price, which can run far above our real cost.
   *
   *  This matters because the LABEL response always reports the negotiated figure
   *  (lib/carrierCost.ts). When a quote is 'published' but the label bills
   *  negotiated, retail is marked up off a number we never pay — an 8 lb Next Day
   *  Air quoted at $120.79 list against a $74.89 account cost prices the customer
   *  at 2.5x our cost instead of the intended 1.55x. Surfaced in the panels and
   *  logged so the gap is measurable rather than silent. */
  rateSource?: RateSource;
  /** The carrier's PUBLISHED retail price for this service — what UPS/FedEx
   *  would charge a customer walking into their own counter.
   *
   *  Kept because it is a hard reference point: our true cost can never exceed
   *  it, so it both bounds what a shipment is really worth and gives staff a
   *  competitive yardstick. It is also the fallback cost basis when the carrier
   *  returns no account rate (see lib/carrierIncentive.ts).
   *
   *  Undefined for USPS and DHL, which return no list rate. */
  listPriceUSD?: number;
  /** What this shipment actually costs us — the figure our price is derived
   *  from. Computed on the page after rates arrive (see lib/carrierIncentive.ts
   *  costBasisUSD): the account rate when the carrier returned one, otherwise
   *  list discounted by our configured incentive.
   *
   *  Set client-side rather than by the rate route so the panels, the detail
   *  modal and the cart all price off ONE number — a panel showing a price the
   *  modal disagrees with is worse than either being wrong alone. */
  costBasisUSD?: number;
}

/** Which carrier price book a quote came from — see ShippingRate.rateSource. */
export type RateSource = 'negotiated' | 'published';

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
  /** True when staff set the freight price by hand in CarrierDetailModal rather
   *  than accepting the formula. Recorded so the margin report can separate
   *  judgement calls from mispricing. */
  priceOverridden?: boolean;
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
  /** Retail declared-value (liability) fee — see lib/shippingPricing
   *  retailDeclaredValueFee. Set in the browser for display, but re-derived from
   *  valueUSD server-side by priceInsurance() before it is charged or logged. */
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
  /** What the customer was actually charged (money collected), not a recomputed
   *  price — revenue reports sum this, so it must reconcile with the Stripe
   *  payout / till. Pricing disagreements are recorded in the error log instead. */
  totalUSD: number;
  /** Actual negotiated carrier charge for this label, from the carrier's ship
   *  response. Undefined when the carrier returned no rating (USPS and DHL label
   *  responses don't carry one). Compare with shippingUSD for real margin — but
   *  note carrier post-audit adjustments (reweigh, dim-weight, address
   *  correction) land on the invoice days later and are NOT reflected here. */
  carrierCostUSD?: number;
  /** Which price book the QUOTE was based on (see ShippingRate.rateSource).
   *  carrierCostUSD is always the negotiated figure, so a 'published' quote here
   *  means retail was derived from a list price we never actually pay — the
   *  margin report splits on this to size that gap per service. */
  rateSource?: RateSource;
  /** The carrier's published retail for this service at quote time — what
   *  UPS/FedEx would have charged this customer directly. Lets the margin report
   *  show where our price sat against the carrier's own counter. */
  listPriceUSD?: number;
  /** True when staff set the freight price by hand instead of taking the
   *  formula. Separates a deliberate judgement call from a mispriced quote. */
  priceOverridden?: boolean;
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
  /** True when the label was booked with the carrier's Saturday-delivery service */
  saturdayDelivery?: boolean;
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

