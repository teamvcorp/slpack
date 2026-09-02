/**
 * Signature confirmation on a shipment, and the per-carrier enums it maps to.
 *
 * One module so UPS's numeric codes and FedEx's string enum live in exactly one
 * place — the RATE route and the LABEL route must agree or we quote one service
 * and book another.
 *
 * WHY IT MUST REACH THE RATE CALL: signature is a paid carrier add-on (roughly
 * $7-9, more for adult). Booking it on a label that was quoted without it puts
 * the surcharge on the weekly invoice with nothing collected against it. Sent at
 * rate time it lands inside totalChargeUSD and, since carriers surcharge both
 * price books, inside listPriceUSD too — so carrierAnchoredPrice() prices it
 * with no pricing change at all.
 *
 * Carrier references in carrier_rate_pricing_notes.md.
 */

export type SignatureOption = 'none' | 'signature' | 'adult';

/** Counter-facing text — used by the form dropdown and the customer receipt. */
export const SIGNATURE_LABELS: Record<SignatureOption, string> = {
  none: 'No signature',
  signature: 'Signature required',
  adult: 'Adult signature (21+)',
};

/** Dropdown order. */
export const SIGNATURE_OPTIONS: SignatureOption[] = ['none', 'signature', 'adult'];

/**
 * Whitelist a client-supplied value.
 *
 * This selection changes what the carrier bills us, so it is never forwarded
 * verbatim. Anything unrecognised becomes 'none' — the cheapest and safest
 * outcome. Junk must never fall through to 'adult', which is the most expensive
 * tier.
 */
export function normalizeSignature(raw: unknown): SignatureOption {
  return raw === 'signature' || raw === 'adult' ? raw : 'none';
}

/**
 * UPS `DeliveryConfirmation.DCISType`.
 *
 *   1 = Delivery Confirmation (no signature — a different product, not offered)
 *   2 = Delivery Confirmation Signature Required
 *   3 = Delivery Confirmation Adult Signature Required
 *
 * Domestic US goes at PACKAGE level (Package.PackageServiceOptions), which is
 * distinct from the shipment-level ShipmentServiceOptions that Saturday delivery
 * uses. International uses the shipment-level element with different values and
 * is deliberately not wired up yet.
 *
 * Returns null for 'none' so callers can spread-or-omit instead of branching.
 */
export function upsDCISType(option: SignatureOption): '2' | '3' | null {
  if (option === 'signature') return '2';
  if (option === 'adult') return '3';
  return null;
}

/**
 * FedEx `packageSpecialServices.signatureOptionType`.
 *
 * Must be sent TOGETHER with `specialServiceTypes: ['SIGNATURE_OPTION']` —
 * either one alone returns "Special service SIGNATURE_OPTION is invalid".
 *
 * INDIRECT exists but is residential-only at FedEx, so it is not offered; it
 * would have to hide itself based on the residential toggle or labels fail.
 */
export function fedexSignatureType(option: SignatureOption): 'DIRECT' | 'ADULT' | null {
  if (option === 'signature') return 'DIRECT';
  if (option === 'adult') return 'ADULT';
  return null;
}

/**
 * FedEx package-level special-service block, ready to spread into a
 * requestedPackageLineItems entry. Empty object when no signature is wanted.
 */
export function fedexSignatureBlock(option: SignatureOption): Record<string, unknown> {
  const signatureOptionType = fedexSignatureType(option);
  if (!signatureOptionType) return {};
  return {
    packageSpecialServices: {
      specialServiceTypes: ['SIGNATURE_OPTION'],
      signatureOptionType,
    },
  };
}

/**
 * UPS package-level DeliveryConfirmation block, ready to merge INTO an existing
 * PackageServiceOptions object. Returns the inner fields only — never a wrapped
 * `PackageServiceOptions`, because declared-value insurance writes to the same
 * key and two spreads of one key silently drop one of them.
 */
export function upsDeliveryConfirmation(option: SignatureOption): Record<string, unknown> {
  const DCISType = upsDCISType(option);
  return DCISType ? { DeliveryConfirmation: { DCISType } } : {};
}
