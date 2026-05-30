import { NextRequest } from 'next/server';
import { logAndRespond } from '@/lib/apiErrors';
import { markShipmentAcceptance, getShipmentById } from '@/lib/shipmentLog';

const ROUTE = 'shipping/tracking/mark-tendered';

/**
 * POST /api/shipping/tracking/mark-tendered
 * Body: { id: string }
 * Manually flags a shipment as accepted by the carrier. Use when tracking
 * lookups don't reflect a known hand-off (sandbox, weekend lag, etc.).
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const id = String(body?.id ?? '');
    if (!id) {
      return await logAndRespond({ route: ROUTE, status: 400, message: 'Missing shipment id' });
    }
    const shipment = await getShipmentById(id);
    if (!shipment) {
      return await logAndRespond({ route: ROUTE, status: 404, message: `Shipment ${id} not found` });
    }
    await markShipmentAcceptance(id, {
      accepted: true,
      acceptedAt: new Date().toISOString(),
      acceptedSource: 'manual',
    });
    return Response.json({ ok: true });
  } catch (err) {
    return await logAndRespond({
      route: ROUTE,
      status: 500,
      message: 'Failed to mark tendered',
      err,
    });
  }
}
