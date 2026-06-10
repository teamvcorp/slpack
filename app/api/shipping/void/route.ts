import { NextRequest } from 'next/server';
import { logAndRespond } from '@/lib/apiErrors';
import { getShipmentById, markShipmentVoided } from '@/lib/shipmentLog';
import { getFedexToken, getUpsToken } from '@/lib/carrierTokens';
import type { CarrierKey } from '@/app/admin/types/shipping';

const ROUTE = 'shipping/void';

const FEDEX_BASE = process.env.FEDEX_SANDBOX === 'false'
  ? 'https://apis.fedex.com'
  : 'https://apis-sandbox.fedex.com';

const UPS_BASE = process.env.UPS_SANDBOX === 'false'
  ? 'https://onlinetools.ups.com'
  : 'https://wwwcie.ups.com';

/** Best-effort carrier-side cancel. Returns status + human-readable message. */
async function cancelAtCarrier(
  carrier: CarrierKey,
  trackingNumber: string
): Promise<{ status: 'success' | 'failed' | 'skipped' | 'manual'; message: string }> {
  if (carrier === 'fedex') {
    if (!process.env.FEDEX_CLIENT_ID || !process.env.FEDEX_ACCOUNT_NUMBER) {
      return { status: 'skipped', message: 'FedEx credentials not configured' };
    }
    try {
      const token = await getFedexToken();
      const res = await fetch(`${FEDEX_BASE}/ship/v1/shipments/cancel`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          accountNumber: { value: process.env.FEDEX_ACCOUNT_NUMBER },
          trackingNumber,
        }),
      });
      const body = await res.text();
      if (!res.ok) return { status: 'failed', message: `FedEx cancel ${res.status}: ${body.slice(0, 300)}` };
      return { status: 'success', message: 'FedEx label cancelled' };
    } catch (err) {
      return { status: 'failed', message: err instanceof Error ? err.message : 'FedEx cancel error' };
    }
  }

  if (carrier === 'ups') {
    if (!process.env.UPS_CLIENT_ID) {
      return { status: 'skipped', message: 'UPS credentials not configured' };
    }
    try {
      const token = await getUpsToken();
      // UPS Void Shipment API
      const res = await fetch(
        `${UPS_BASE}/api/shipments/v1/void/cancel/${encodeURIComponent(trackingNumber)}`,
        {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${token}`,
            transId: `void-${Date.now()}`,
            transactionSrc: 'slpack',
          },
        }
      );
      const body = await res.text();
      if (!res.ok) return { status: 'failed', message: `UPS void ${res.status}: ${body.slice(0, 300)}` };
      return { status: 'success', message: 'UPS label voided' };
    } catch (err) {
      return { status: 'failed', message: err instanceof Error ? err.message : 'UPS void error' };
    }
  }

  if (carrier === 'usps') {
    // USPS labels can only be refunded by submitting an SSF refund request through
    // Business Customer Gateway — no programmatic cancel API on the v3 endpoints.
    return {
      status: 'manual',
      message: 'USPS labels must be refunded manually via Business Customer Gateway within 30 days.',
    };
  }

  return { status: 'skipped', message: `No void support for ${carrier}` };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const id = String(body?.id ?? '');
    const reason = typeof body?.reason === 'string' ? body.reason.slice(0, 500) : undefined;
    const force = body?.force === true;

    if (!id) {
      return await logAndRespond({
        route: ROUTE,
        status: 400,
        message: 'Missing shipment id',
      });
    }

    const shipment = await getShipmentById(id);
    if (!shipment) {
      return await logAndRespond({
        route: ROUTE,
        status: 404,
        message: `Shipment ${id} not found`,
      });
    }

    if (shipment.voided) {
      return Response.json({
        ok: true,
        alreadyVoided: true,
        voidedAt: shipment.voidedAt,
      });
    }

    let carrierResult: Awaited<ReturnType<typeof cancelAtCarrier>> = {
      status: 'skipped',
      message: 'No tracking number on shipment',
    };
    if (shipment.trackingNumber) {
      carrierResult = await cancelAtCarrier(shipment.carrier, shipment.trackingNumber);
    }

    // If carrier cancel failed and caller didn't pass force, refuse so the
    // operator knows to retry or call the carrier directly.
    if (carrierResult.status === 'failed' && !force) {
      return await logAndRespond({
        route: ROUTE,
        carrier: shipment.carrier,
        status: 502,
        message: `Carrier cancel failed: ${carrierResult.message}`,
        requestSummary: { id, trackingNumber: shipment.trackingNumber },
      });
    }

    const updated = await markShipmentVoided(id, {
      voidReason: reason,
      voidCarrierStatus: carrierResult.status,
      voidCarrierMessage: carrierResult.message,
    });

    if (!updated) {
      return await logAndRespond({
        route: ROUTE,
        status: 500,
        message: 'Failed to update shipment record',
      });
    }

    return Response.json({
      ok: true,
      voidCarrierStatus: carrierResult.status,
      voidCarrierMessage: carrierResult.message,
    });
  } catch (err) {
    return await logAndRespond({
      route: ROUTE,
      status: 500,
      message: 'Unexpected error voiding shipment',
      err,
    });
  }
}
