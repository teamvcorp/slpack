import { NextRequest } from 'next/server';
import { logAndRespond } from '@/lib/apiErrors';
import { findShipmentsNeedingAcceptanceCheck, markShipmentAcceptance } from '@/lib/shipmentLog';
import { checkAcceptance } from '@/lib/carrierTracking';

const ROUTE = 'shipping/tracking/refresh';

/**
 * POST /api/shipping/tracking/refresh
 * Body (optional): { limit?: number, staleMinutes?: number }
 * Polls the carrier tracking APIs for shipments that haven't been confirmed
 * accepted yet. Updates `accepted`/`acceptedAt`/`acceptanceCheckedAt`.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const limit = Math.min(Math.max(Number(body?.limit) || 50, 1), 200);
    const staleMinutes = Number(body?.staleMinutes) || 240;

    const candidates = await findShipmentsNeedingAcceptanceCheck({ limit, staleMinutes });

    let acceptedCount = 0;
    let stillPending = 0;
    const errors: Array<{ id: string; reason?: string }> = [];

    // Sequential to keep within carrier rate limits.
    for (const s of candidates) {
      if (!s.trackingNumber) continue;
      const result = await checkAcceptance(s.carrier, s.trackingNumber);
      await markShipmentAcceptance(s.id, {
        accepted: result.accepted,
        acceptedAt: result.acceptedAt,
        acceptedSource: 'tracking',
      });
      if (result.accepted) acceptedCount += 1;
      else {
        stillPending += 1;
        if (result.reason) errors.push({ id: s.id, reason: result.reason });
      }
    }

    return Response.json({
      ok: true,
      checked: candidates.length,
      accepted: acceptedCount,
      pending: stillPending,
      errors: errors.slice(0, 20),
    });
  } catch (err) {
    return await logAndRespond({
      route: ROUTE,
      status: 500,
      message: 'Tracking refresh failed',
      err,
    });
  }
}
