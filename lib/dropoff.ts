import type { DropoffCarrier } from '@/app/admin/types/dropoff';

/** This shop only accepts UPS and FedEx drop-offs; 'other' is a manual fallback. */
export const DROPOFF_CARRIERS: DropoffCarrier[] = ['ups', 'fedex'];

export const DROPOFF_CARRIER_LABELS: Record<DropoffCarrier, string> = {
  ups: 'UPS',
  fedex: 'FedEx',
  usps: 'USPS',
  dhl: 'DHL',
  other: 'Other',
};

/**
 * Best-effort carrier detection from a scanned tracking barcode. Drop-offs are
 * only ever UPS or FedEx here: UPS retail labels are "1Z…", everything else is
 * treated as FedEx. The scan UI lets the operator override the guess.
 */
export function detectCarrier(raw: string): DropoffCarrier {
  const tn = (raw ?? '').replace(/\s+/g, '').toUpperCase();
  if (/^1Z[0-9A-Z]{16}$/.test(tn) || tn.startsWith('1Z')) return 'ups';
  return 'fedex';
}

/** Public customer-facing tracking URL for a carrier, or null when unknown. */
export function trackingUrl(carrier: DropoffCarrier, trackingNumber: string): string | null {
  const t = encodeURIComponent((trackingNumber ?? '').trim());
  if (!t) return null;
  switch (carrier) {
    case 'usps':
      return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${t}`;
    case 'ups':
      return `https://www.ups.com/track?loc=en_US&tracknum=${t}`;
    case 'fedex':
      return `https://www.fedex.com/fedextrack/?trknbr=${t}`;
    case 'dhl':
      return `https://www.dhl.com/us-en/home/tracking/tracking-express.html?submit=1&tracking-id=${t}`;
    default:
      return null;
  }
}
