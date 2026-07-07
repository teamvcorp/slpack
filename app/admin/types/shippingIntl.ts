import type { ShipmentInput, ShippingRate, InsuranceOption, CarrierKey, ShipmentDocument, CartResult } from './shipping';

/**
 * International shipping types — kept in a SEPARATE file from the domestic
 * `shipping.ts` types so the two flows never share mutable contracts. Domestic
 * `ShipmentInput` is imported and EXTENDED (never modified) — a bug here cannot
 * change the shape domestic code relies on.
 */

/** A single line item on the commercial invoice / customs declaration. */
export interface Commodity {
  /** Plain-language description of the goods (customs requires specifics, not "gift"). */
  description: string;
  /** Harmonized System (HS) tariff code — both UPS & FedEx require this for MX/South America. */
  hsCode: string;
  /** Number of units of this commodity. */
  quantity: number;
  /** Value of ONE unit, in USD. Line total = quantity × unitValueUSD. */
  unitValueUSD: number;
  /** ISO-2 country where the goods were made (defaults to 'US'). */
  countryOfManufacture: string;
  /** Weight of the full line (all units) in pounds. */
  weightLbs: number;
}

/** Who is responsible for import duties & taxes at destination. */
export type DutiesPayer = 'recipient' | 'sender';

/** Reason the goods are being exported (drives the commercial-invoice "purpose"). */
export type ReasonForExport = 'SALE' | 'GIFT' | 'SAMPLE' | 'RETURN' | 'REPAIR' | 'PERSONAL';

/**
 * Incoterm / terms of sale.
 * - DAP/DDU: recipient pays duties on arrival (most common counter shipment)
 * - DDP: sender prepays duties
 * - CPT: carriage paid to
 */
export type Incoterm = 'DAP' | 'DDP' | 'DDU' | 'CPT';

/** Customs declaration captured for an international shipment. */
export interface CustomsInfo {
  commodities: Commodity[];
  reasonForExport: ReasonForExport;
  incoterm: Incoterm;
  dutiesPayer: DutiesPayer;
  /** Invoice currency. USD-only for MVP. */
  currency: 'USD';
  /** Optional overall contents summary (falls back to concatenated commodity descriptions). */
  contentsDescription?: string;
  /** Duties to collect from the customer when the SHIPPER prepays (DDP).
   *  FedEx-estimated (EDT) or manually entered; added to the charge total.
   *  Undefined/0 when the recipient pays duties (DAP/DDU). */
  dutiesCollectedUSD?: number;
}

/** Domestic shipment input plus the customs block required for cross-border shipping. */
export type IntlShipmentInput = ShipmentInput & { customs: CustomsInfo };

/** A printable document returned by the carrier (label + commercial invoice, etc.).
 *  Aliased from the domestic `ShipmentDocument` to keep one shared shape. */
export type IntlDocument = ShipmentDocument;

/** A single international package queued in the multi-package cart. */
export interface IntlCartItem {
  id: string;
  carrier: CarrierKey;
  rate: ShippingRate;
  shipment: IntlShipmentInput;
  insurance: InsuranceOption;
  /** Prepaid duties (DDP) collected from the customer, added to the total. */
  dutiesUSD?: number;
}

/** Result returned after submitting an international package to a carrier.
 *  Structurally a domestic `CartResult` (documents populated for intl). */
export type IntlCartResult = CartResult;

/** US Census EEI/AES filing kicks in per-commodity at this value — out of MVP scope. */
export const EEI_FILING_THRESHOLD_USD = 2500;

/** Sum of all commodity line totals — the total customs (declared) value. */
export function totalCustomsValue(customs: CustomsInfo): number {
  return customs.commodities.reduce(
    (sum, c) => sum + Number(c.quantity || 0) * Number(c.unitValueUSD || 0),
    0
  );
}
