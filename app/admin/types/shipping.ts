export interface ShipmentInput {
  originZip: string;
  originCountry: string;
  destStreet: string;
  destZip: string;
  destCity: string;
  destState: string;
  destCountry: string;
  weightLbs: number;
  lengthIn: number;
  widthIn: number;
  heightIn: number;
  declaredValueUSD: number;
  customerName: string;
  customerEmail: string;
}

export interface ShippingRate {
  serviceCode: string;
  serviceName: string;
  totalChargeUSD: number;
  estimatedDays: number | null;
  deliveryDate: string | null;
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

export interface InsuranceOption {
  enabled: boolean;
  /** Declared value in USD — mirrors shipment.declaredValueUSD */
  valueUSD: number;
  /** Calculated premium (10% of declared value, $1 minimum) */
  premiumUSD: number;
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
  totalUSD: number;
  trackingNumber: string | null;
  labelBase64: string | null;
  customerName: string;
  customerEmail: string;
}
