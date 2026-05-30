import { NextRequest } from 'next/server';
import { logAndRespond } from '@/lib/apiErrors';
import { readLog } from '@/lib/shipmentLog';
import { lastSettlementByCarrier } from '@/lib/settlements';
import { getUspsToken, BASE as USPS_BASE } from '@/lib/uspsToken';
import type { CarrierBalance, CarrierKey } from '@/app/admin/types/shipping';

const ROUTE = 'shipping/balances';
const CARRIERS: CarrierKey[] = ['fedex', 'ups', 'usps', 'dhl'];

/** Best-effort fetch of the USPS EPS prepaid balance. Returns null on any failure. */
async function fetchUspsPrepaid(): Promise<{ balanceUSD: number; asOf: string } | null> {
  const eps = process.env.USPS_EPS_ACCOUNT_NUMBER;
  if (!eps || !process.env.USPS_CLIENT_ID || !process.env.USPS_CLIENT_SECRET) return null;
  try {
    const token = await getUspsToken();
    // USPS Payments v3 — EPS account details endpoint
    const res = await fetch(`${USPS_BASE}/payments/v3/payment-account?accountNumber=${encodeURIComponent(eps)}&accountType=EPS`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    if (!res.ok) return null;
    const data = await res.json();
    // Response shape varies — try a few likely fields.
    const balance =
      typeof data?.balance === 'number' ? data.balance :
      typeof data?.accountBalance === 'number' ? data.accountBalance :
      typeof data?.availableBalance === 'number' ? data.availableBalance :
      null;
    if (balance == null) return null;
    return { balanceUSD: balance, asOf: new Date().toISOString() };
  } catch {
    return null;
  }
}

export async function GET(_req: NextRequest) {
  try {
    const [shipments, lastByCarrier, uspsPrepaid] = await Promise.all([
      readLog(),
      lastSettlementByCarrier(),
      fetchUspsPrepaid(),
    ]);

    const balances: CarrierBalance[] = CARRIERS.map((carrier) => {
      const last = lastByCarrier[carrier] ?? null;
      // Shipments after the cutoff count toward the running balance.
      const cutoffMs = last
        ? new Date(last.periodEnd ?? last.paidAt).getTime()
        : 0;

      const inWindow = shipments.filter(
        (s) => s.carrier === carrier && !s.voided && new Date(s.timestamp).getTime() > cutoffMs
      );
      // Only carrier-accepted shipments contribute to the actual owed balance.
      const accepted = inWindow.filter((s) => s.accepted === true);
      const pending = inWindow.filter((s) => s.accepted !== true);

      const owedUSD = accepted.reduce(
        (sum, s) => sum + (s.shippingUSD ?? 0) + (s.insuranceUSD ?? 0),
        0
      );
      const pendingUSD = pending.reduce(
        (sum, s) => sum + (s.shippingUSD ?? 0) + (s.insuranceUSD ?? 0),
        0
      );

      const oldest = accepted.reduce<string | null>(
        (acc, s) => (acc == null || s.timestamp < acc ? s.timestamp : acc),
        null
      );

      return {
        carrier,
        owedUSD: Math.round(owedUSD * 100) / 100,
        shipmentCount: accepted.length,
        oldestUnsettledAt: oldest,
        lastSettlement: last,
        pendingUSD: Math.round(pendingUSD * 100) / 100,
        pendingCount: pending.length,
      };
    });

    return Response.json({ balances, uspsPrepaid });
  } catch (err) {
    return await logAndRespond({
      route: ROUTE,
      status: 500,
      message: 'Failed to compute balances',
      err,
    });
  }
}
