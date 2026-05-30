import { NextRequest } from 'next/server';
import { randomUUID } from 'crypto';
import { logAndRespond } from '@/lib/apiErrors';
import { appendSettlement } from '@/lib/settlements';
import type { CarrierKey, SettlementEntry } from '@/app/admin/types/shipping';

const ROUTE = 'shipping/balances/settle';
const VALID_CARRIERS: CarrierKey[] = ['fedex', 'ups', 'usps', 'dhl'];

function isIsoOrUndef(v: unknown): v is string | undefined {
  if (v === undefined || v === null || v === '') return true;
  if (typeof v !== 'string') return false;
  const ts = Date.parse(v);
  return !Number.isNaN(ts);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const carrier = body?.carrier;
    const amountUSD = Number(body?.amountUSD);

    if (!VALID_CARRIERS.includes(carrier)) {
      return await logAndRespond({
        route: ROUTE,
        status: 400,
        message: `Invalid carrier: ${carrier}`,
      });
    }
    if (!Number.isFinite(amountUSD) || amountUSD <= 0) {
      return await logAndRespond({
        route: ROUTE,
        status: 400,
        message: 'amountUSD must be a positive number',
      });
    }
    if (!isIsoOrUndef(body?.paidAt) || !isIsoOrUndef(body?.periodStart) || !isIsoOrUndef(body?.periodEnd)) {
      return await logAndRespond({
        route: ROUTE,
        status: 400,
        message: 'paidAt/periodStart/periodEnd must be ISO date strings when provided',
      });
    }

    const entry: SettlementEntry = {
      id: randomUUID(),
      carrier,
      amountUSD: Math.round(amountUSD * 100) / 100,
      paidAt: body?.paidAt ? new Date(body.paidAt).toISOString() : new Date().toISOString(),
      periodStart: body?.periodStart ? new Date(body.periodStart).toISOString() : undefined,
      periodEnd: body?.periodEnd ? new Date(body.periodEnd).toISOString() : undefined,
      invoiceRef: typeof body?.invoiceRef === 'string' ? body.invoiceRef.slice(0, 100) : undefined,
      note: typeof body?.note === 'string' ? body.note.slice(0, 500) : undefined,
    };

    await appendSettlement(entry);
    return Response.json({ ok: true, settlement: entry });
  } catch (err) {
    return await logAndRespond({
      route: ROUTE,
      status: 500,
      message: 'Failed to record settlement',
      err,
    });
  }
}
