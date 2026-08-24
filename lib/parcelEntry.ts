import type { ShipmentInput } from '@/app/admin/types/shipping';

/**
 * Package weight/dimension entry rules, shared by the domestic and international
 * compare screens so the two can't drift apart.
 *
 * WHY THIS EXISTS: both forms used to seed a plausible-looking package
 * (2 lb, 12 x 9 x 6). The inputs carried `required`, but `required` only fires on
 * an EMPTY field — a prefilled one always passes — so staff could quote a package
 * with the previous customer's numbers and never be stopped. The carrier bills on
 * the real parcel, so every forgotten update is money out the door, and worst on
 * express where rates climb steeply per pound.
 *
 * The fix is to start the fields blank and refuse to quote until they're filled.
 */

/**
 * Actual outside dimensions of the FedEx-branded envelope, in inches.
 *
 * The form hides the dimension inputs when FEDEX_ENVELOPE is selected (FedEx
 * knows its own packaging and its rate route omits dims entirely). UPS and USPS
 * do NOT — they quote the same shipment as a parcel and need real numbers, so we
 * substitute these at submit rather than sending zeros.
 */
export const FEDEX_ENVELOPE_DIMS = {
  lengthIn: 12.5,
  widthIn: 9.5,
  heightIn: 0.5,
} as const;

/** Human labels, in the order they appear on the form. */
const FIELD_LABELS: Record<'weightLbs' | 'lengthIn' | 'widthIn' | 'heightIn', string> = {
  weightLbs: 'weight',
  lengthIn: 'length',
  widthIn: 'width',
  heightIn: 'height',
};

export type ParcelField = keyof typeof FIELD_LABELS;

/** The four fields staff must enter, in form order. */
export const PARCEL_FIELDS: ParcelField[] = ['weightLbs', 'lengthIn', 'widthIn', 'heightIn'];

/**
 * Which required package fields are still blank or zero.
 *
 * Dimensions are exempt for FedEx-branded packaging, whose size is fixed and
 * whose inputs the form hides — requiring them would be unfillable. Weight is
 * always required: even an envelope is rated by weight.
 *
 * Returns field keys (not labels) so callers can highlight the exact inputs.
 */
export function missingParcelFields(s: Pick<ShipmentInput, ParcelField | 'packaging'>): ParcelField[] {
  const required: ParcelField[] =
    s.packaging === 'FEDEX_ENVELOPE' ? ['weightLbs'] : PARCEL_FIELDS;

  return required.filter((key) => {
    const value = Number(s[key]);
    return !Number.isFinite(value) || value <= 0;
  });
}

/** "weight, length and width" — for the inline error message. */
export function describeMissing(fields: ParcelField[]): string {
  const labels = fields.map((f) => FIELD_LABELS[f]);
  if (labels.length <= 1) return labels[0] ?? '';
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
}

/**
 * Fill in dimensions the form deliberately hides, so every carrier gets a real
 * parcel to rate.
 *
 * Apply this at BOTH submit and the parent-sync callback: the page's shipment
 * snapshot feeds the cart and the label, and its rate signature must match what
 * was quoted or the stale-rate guard will fire on a shipment nothing changed.
 */
export function withPackagingDims(s: ShipmentInput): ShipmentInput {
  return s.packaging === 'FEDEX_ENVELOPE' ? { ...s, ...FEDEX_ENVELOPE_DIMS } : s;
}
