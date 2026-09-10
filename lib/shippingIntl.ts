/**
 * International shipping helpers — build the carrier-specific customs payloads
 * (FedEx customsClearanceDetail, UPS InternationalForms) from our neutral
 * CustomsInfo. Kept separate from any domestic code so the domestic label
 * routes are never touched.
 */
import type { CustomsInfo, Commodity, ReasonForExport, Incoterm } from '@/app/admin/types/shippingIntl';
import { totalCustomsValue } from '@/app/admin/types/shippingIntl';
import { localDateStamp } from '@/lib/localDate';

const money = (n: number) => Number(Number(n || 0).toFixed(2));
const lineTotal = (c: Commodity) => money(Number(c.quantity || 0) * Number(c.unitValueUSD || 0));

// ── FedEx mappings ─────────────────────────────────────────────────────────
// FedEx commercialInvoice.purpose enum.
const FEDEX_PURPOSE: Record<ReasonForExport, string> = {
  SALE: 'SOLD',
  GIFT: 'GIFT',
  SAMPLE: 'SAMPLE',
  RETURN: 'RETURN_AND_REPAIR',
  REPAIR: 'REPAIR_AND_RETURN',
  PERSONAL: 'PERSONAL_EFFECTS',
};

// FedEx termsOfSale accepts the Incoterm code directly (DAP/DDP/DDU/CPT).
const fedexTermsOfSale = (incoterm: Incoterm): string => incoterm;

/**
 * Build the FedEx `customsClearanceDetail` block for the Ship/Rate APIs.
 * `senderAccount` is required when the sender prepays duties (DDP).
 *
 * `opts.forRating`: the FedEx Rate API only accepts `dutiesPayment.paymentType`
 * of SENDER (RECIPIENT is rejected with RATE.PAYMENTTYPE.NOTALLOWED). Duties
 * aren't part of the shipping charge when the recipient pays, so forcing SENDER
 * for the quote is safe — the real payer is applied on the label.
 */
export function fedexCustomsClearanceDetail(
  customs: CustomsInfo,
  senderAccount?: string,
  opts?: { forRating?: boolean }
) {
  const dutiesPayment =
    !opts?.forRating && customs.dutiesPayer === 'sender'
      ? {
          paymentType: 'SENDER',
          payor: { responsibleParty: { accountNumber: { value: senderAccount ?? '' } } },
        }
      : opts?.forRating
        ? { paymentType: 'SENDER', payor: { responsibleParty: { accountNumber: { value: senderAccount ?? '' } } } }
        : { paymentType: 'RECIPIENT' };

  return {
    dutiesPayment,
    commercialInvoice: {
      termsOfSale: fedexTermsOfSale(customs.incoterm),
      purpose: FEDEX_PURPOSE[customs.reasonForExport] ?? 'SOLD',
    },
    commodities: customs.commodities.map((c) => {
      const hs = String(c.hsCode || '').replace(/\D/g, '');
      return {
        description: c.description || 'Merchandise',
        countryOfManufacture: String(c.countryOfManufacture || 'US'),
        // Omit when unknown (rating) — FedEx rejects an empty harmonizedCode string.
        ...(hs ? { harmonizedCode: hs } : {}),
        quantity: Number(c.quantity || 1),
        quantityUnits: 'PCS',
        unitPrice: { amount: money(c.unitValueUSD), currency: customs.currency },
        customsValue: { amount: lineTotal(c), currency: customs.currency },
        weight: { units: 'LB', value: Number(c.weightLbs || 0.1) },
        numberOfPieces: Number(c.quantity || 1),
      };
    }),
  };
}

/** FedEx total customs value (sum of commodity line totals). */
export function fedexTotalCustomsValue(customs: CustomsInfo) {
  return { amount: money(totalCustomsValue(customs)), currency: customs.currency };
}

// ── UPS mappings ───────────────────────────────────────────────────────────
const UPS_REASON: Record<ReasonForExport, string> = {
  SALE: 'SALE',
  GIFT: 'GIFT',
  SAMPLE: 'SAMPLE',
  RETURN: 'RETURN',
  REPAIR: 'REPAIR',
  PERSONAL: 'PERSONAL EFFECTS',
};

/**
 * Today's date in the store's zone, as UPS's compact `YYYYMMDD`.
 *
 * This is the commercial INVOICE date — the day the paperwork is raised — so
 * it stays the actual current date and does NOT roll forward to the next
 * pickup day the way a ship date does (see nextPickupDateStamp).
 *
 * It did use the server's clock, which on the UTC host post-dated every
 * invoice raised after 7 pm Central by a day. Customs paperwork dated in the
 * future is exactly the sort of thing that gets a shipment held.
 */
function yyyymmdd(): string {
  return localDateStamp().replace(/-/g, '');
}

/**
 * Build the UPS `InternationalForms` block (goes under
 * Shipment.ShipmentServiceOptions.InternationalForms in the Ship API).
 * `soldTo` is the buyer/recipient — UPS requires it on the invoice form.
 */
export function upsInternationalForms(
  customs: CustomsInfo,
  soldTo: {
    name: string;
    phone?: string;
    addressLines: string[];
    city: string;
    stateProvinceCode?: string;
    postalCode: string;
    countryCode: string;
  }
) {
  return {
    // 01 = Commercial Invoice
    FormType: ['01'],
    InvoiceDate: yyyymmdd(),
    ReasonForExport: UPS_REASON[customs.reasonForExport] ?? 'SALE',
    CurrencyCode: customs.currency,
    Contacts: {
      SoldTo: {
        Name: soldTo.name || 'Customer',
        AttentionName: (soldTo.name || 'Customer').slice(0, 35),
        ...(soldTo.phone ? { Phone: { Number: soldTo.phone } } : {}),
        Address: {
          AddressLine: soldTo.addressLines.filter(Boolean),
          City: soldTo.city,
          ...(soldTo.stateProvinceCode ? { StateProvinceCode: soldTo.stateProvinceCode } : {}),
          PostalCode: soldTo.postalCode,
          CountryCode: soldTo.countryCode,
        },
      },
    },
    Product: customs.commodities.map((c) => ({
      Description: c.description,
      CommodityCode: String(c.hsCode || '').replace(/\D/g, ''),
      OriginCountryCode: String(c.countryOfManufacture || 'US'),
      Unit: {
        Number: String(Number(c.quantity || 1)),
        Value: money(c.unitValueUSD).toFixed(2),
        UnitOfMeasurement: { Code: 'PCS', Description: 'Pieces' },
      },
    })),
  };
}

// ── USPS mappings ──────────────────────────────────────────────────────────
// USPS customsForm.customsContentType enum (International Labels v3).
const USPS_CONTENT_TYPE: Record<ReasonForExport, string> = {
  SALE: 'MERCHANDISE',
  GIFT: 'GIFT',
  SAMPLE: 'SAMPLE',
  RETURN: 'RETURNED_GOODS',
  REPAIR: 'OTHER',
  PERSONAL: 'OTHER',
};

/**
 * Build the USPS `customsForm` block for the International Labels API
 * (POST /international-labels/v3/international-label). Unlike FedEx/UPS — which
 * produce a separate commercial invoice document — USPS integrates the customs
 * declaration (CN22/CN23) INTO the label, so this rides on the label request.
 *
 * Maps our neutral CustomsInfo/Commodity to USPS's contents items. HS code is
 * digits-only and omitted when unknown (USPS rejects an empty tariff string, as
 * FedEx does with harmonizedCode). Per-item value is the line total
 * (unitValue × quantity), consistent with the FedEx/UPS mappings above.
 */
export function uspsInternationalCustoms(customs: CustomsInfo) {
  return {
    customsContentType: USPS_CONTENT_TYPE[customs.reasonForExport] ?? 'MERCHANDISE',
    // AES/EEI filing. Retail shipments under $2,500 per Schedule B use the
    // standard exemption legend; shipments at/over the threshold legally require
    // a real AES ITN and are blocked upstream (see the label route's guard and
    // EEI_FILING_THRESHOLD_USD). Confirmed required by USPS sandbox validation.
    AESITN: 'NOEEI 30.37(a)',
    ...(customs.contentsDescription
      ? { contentComments: String(customs.contentsDescription).slice(0, 100) }
      : {}),
    // Field names verified against the USPS International Labels v3 schema:
    // itemTotalValue (line total), itemTotalWeight (not `weight`), countryofOrigin.
    contents: customs.commodities.map((c) => {
      const hs = String(c.hsCode || '').replace(/\D/g, '');
      return {
        itemDescription: (c.description || 'Merchandise').slice(0, 100),
        itemQuantity: Number(c.quantity || 1),
        itemTotalValue: lineTotal(c),
        itemTotalWeight: Number(c.weightLbs || 0.1),
        weightUOM: 'lb',
        ...(hs ? { HSTariffNumber: hs } : {}),
        countryofOrigin: String(c.countryOfManufacture || 'US'),
      };
    }),
  };
}
