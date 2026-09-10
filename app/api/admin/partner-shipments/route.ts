import { NextRequest, NextResponse } from 'next/server';
import {
  searchPartnerShipments,
  getPartnerShipmentByTracking,
  addPartnerShipmentAdjustment,
  setAdjustmentBillbackStatus,
  reconcileSummary,
  type PartnerShipmentAdjustment,
  type PartnerShipmentStatus,
} from '@/lib/partnerShipmentLog';

/**
 * Admin: partner-shipment reconciliation. Admin-gated by the proxy.
 *
 * GET   — search shipments (?tracking= | ?partnerId= | ?status= | ?adjusted=1).
 *         A carrier invoice quotes a tracking number; this finds the exact
 *         package, the partner who declared it, and the declared dimensions.
 * POST  — record a carrier billing adjustment against a package (by tracking or
 *         id): the higher/adjusted cost, the delta, and any corrected dimensions.
 * PATCH — update the billback status of one recorded adjustment.
 *
 * Each returned shipment carries a computed `reconcile` summary (effective cost
 * after adjustments and the freight margin) so the shop sees the loss at a glance.
 */
export const runtime = 'nodejs';

const VALID_STATUS = new Set(['shipped', 'awaiting_pack', 'needs_review']);
const VALID_BILLBACK = new Set(['pending', 'billed', 'absorbed']);

function withReconcile(rows: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return rows.map((r) => ({
    ...r,
    reconcile: reconcileSummary({
      freightRetailUSD: Number(r.freightRetailUSD) || 0,
      carrierCostUSD: r.carrierCostUSD as number | undefined,
      adjustments: r.adjustments as PartnerShipmentAdjustment[] | undefined,
    }),
  }));
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const tracking = url.searchParams.get('tracking')?.trim();
  const partnerId = url.searchParams.get('partnerId')?.trim();
  const statusRaw = url.searchParams.get('status')?.trim();
  const adjusted = url.searchParams.get('adjusted') === '1';
  const limit = Number(url.searchParams.get('limit') ?? '100');
  const status = statusRaw && VALID_STATUS.has(statusRaw) ? (statusRaw as PartnerShipmentStatus) : undefined;

  // A bare tracking lookup returns the single package (the invoice case).
  if (tracking && !partnerId && !status && !adjusted) {
    const one = await getPartnerShipmentByTracking(tracking);
    return NextResponse.json({ shipments: one ? withReconcile([one]) : [] });
  }

  const rows = await searchPartnerShipments({
    trackingNumber: tracking || undefined,
    partnerId: partnerId || undefined,
    status,
    hasAdjustments: adjusted || undefined,
    limit,
  });
  return NextResponse.json({ shipments: withReconcile(rows) });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
  const b = body as Record<string, unknown>;

  const id = b.id ? String(b.id).trim() : undefined;
  const trackingNumber = b.trackingNumber ? String(b.trackingNumber).trim() : undefined;
  if (!id && !trackingNumber) {
    return NextResponse.json({ error: 'Provide an id or trackingNumber to locate the shipment' }, { status: 400 });
  }

  const num = (v: unknown) => (v === '' || v === null || v === undefined ? undefined : Number(v));
  const adjustedCostUSD = num(b.adjustedCostUSD);
  const deltaUSD = num(b.deltaUSD);
  if (
    (adjustedCostUSD === undefined || !Number.isFinite(adjustedCostUSD)) &&
    (deltaUSD === undefined || !Number.isFinite(deltaUSD))
  ) {
    return NextResponse.json(
      { error: 'Provide either adjustedCostUSD (the corrected total) or deltaUSD (the extra billed)' },
      { status: 400 }
    );
  }

  const billbackStatus = VALID_BILLBACK.has(String(b.billbackStatus))
    ? (b.billbackStatus as PartnerShipmentAdjustment['billbackStatus'])
    : undefined;

  const updated = await addPartnerShipmentAdjustment(
    { id, trackingNumber },
    {
      adjustedCostUSD: Number.isFinite(adjustedCostUSD) ? adjustedCostUSD : undefined,
      deltaUSD: Number.isFinite(deltaUSD) ? deltaUSD : undefined,
      reason: b.reason ? String(b.reason) : undefined,
      correctedWeightLbs: num(b.correctedWeightLbs),
      correctedLengthIn: num(b.correctedLengthIn),
      correctedWidthIn: num(b.correctedWidthIn),
      correctedHeightIn: num(b.correctedHeightIn),
      carrierInvoiceRef: b.carrierInvoiceRef ? String(b.carrierInvoiceRef) : undefined,
      note: b.note ? String(b.note) : undefined,
      billbackStatus,
    }
  );

  if (!updated) {
    return NextResponse.json({ error: 'Shipment not found, or no quantifiable amount to record' }, { status: 404 });
  }
  return NextResponse.json({
    shipment: {
      ...updated,
      reconcile: reconcileSummary({
        freightRetailUSD: Number(updated.freightRetailUSD) || 0,
        carrierCostUSD: updated.carrierCostUSD as number | undefined,
        adjustments: updated.adjustments as PartnerShipmentAdjustment[] | undefined,
      }),
    },
  });
}

export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const b = (body ?? {}) as Record<string, unknown>;
  const shipmentId = String(b.shipmentId ?? '').trim();
  const adjustmentId = String(b.adjustmentId ?? '').trim();
  const billbackStatus = String(b.billbackStatus ?? '').trim();
  if (!shipmentId || !adjustmentId || !VALID_BILLBACK.has(billbackStatus)) {
    return NextResponse.json({ error: 'shipmentId, adjustmentId, and a valid billbackStatus are required' }, { status: 400 });
  }
  const ok = await setAdjustmentBillbackStatus(
    shipmentId,
    adjustmentId,
    billbackStatus as PartnerShipmentAdjustment['billbackStatus']
  );
  if (!ok) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
