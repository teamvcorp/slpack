/**
 * Actual carrier cost for a *completed* label, pulled from the carrier's ship
 * response.
 *
 * Why this exists: until now the shop's margin was only ever assumed. The rate
 * quote returned at Compare time was treated as the cost forever after, and the
 * ship response — which reports what the carrier is really billing for the label
 * that was just created — was discarded. Anything that moved between quote and
 * label (a fuel-surcharge change, a stale quote sitting in the cart, a service
 * substitution) silently ate into margin with nothing to show for it.
 *
 * Storing this on the shipment log lets /admin/log compare quoted vs actual.
 *
 * IMPORTANT — what this does NOT catch: FedEx and UPS re-weigh and re-measure at
 * the hub and bill corrections days later on the invoice (dim-weight, residential
 * surcharge, address correction, additional handling). Those adjustments never
 * appear in the ship response, so a shipment can still look profitable here and
 * lose money on the weekly invoice. Catching those needs invoice reconciliation.
 *
 * Both parsers return null rather than 0 when the carrier reports no rating —
 * null means "unknown", and must not be mistaken for a free label.
 */

/** Walk a path of object keys through unknown JSON, returning undefined off-path. */
function dig(source: unknown, ...path: (string | number)[]): unknown {
  let cur: unknown = source;
  for (const key of path) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string | number, unknown>)[key];
  }
  return cur;
}

/** Coerce a carrier's money field (string or number) to a positive number, else null. */
function money(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  const n = typeof raw === 'number' ? raw : parseFloat(String(raw));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}

/**
 * FedEx /ship/v1/shipments → completedShipmentDetail.shipmentRating.
 * Prefers the ACCOUNT (negotiated) rate detail, matching how the rate route at
 * app/api/shipping/fedex/route.ts picks its figure — otherwise the comparison
 * would be negotiated-vs-list and every shipment would look like a loss.
 */
export function fedexActualCostUSD(data: unknown): number | null {
  const raw = dig(
    data, 'output', 'transactionShipments', 0,
    'completedShipmentDetail', 'shipmentRating', 'shipmentRateDetails'
  );
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const details = raw as Record<string, unknown>[];

  const preferred =
    details.find(
      (d) =>
        d.rateType === 'ACCOUNT' ||
        d.rateType === 'PAYOR_ACCOUNT_SHIPMENT' ||
        d.rateType === 'PAYOR_ACCOUNT_PACKAGE'
    ) ?? details[0];

  return money(preferred?.totalNetFedExCharge) ?? money(preferred?.totalNetCharge);
}

/**
 * UPS /api/shipments/.../ship → ShipmentResults.
 * NegotiatedRateCharges is our actual cost; ShipmentCharges is published rate and
 * is only a fallback for accounts without negotiated rates.
 */
export function upsActualCostUSD(data: unknown): number | null {
  const results = dig(data, 'ShipmentResponse', 'ShipmentResults');
  if (!results) return null;

  return (
    money(dig(results, 'NegotiatedRateCharges', 'TotalCharge', 'MonetaryValue')) ??
    money(dig(results, 'ShipmentCharges', 'TotalCharges', 'MonetaryValue'))
  );
}
