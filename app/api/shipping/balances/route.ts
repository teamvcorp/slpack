import { logAndRespond } from '@/lib/apiErrors';
import { readLog } from '@/lib/shipmentLog';
import { readSettlements, lastSettlementByCarrier } from '@/lib/settlements';
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

export async function GET() {
  try {
    const [shipments, settlements, lastByCarrier, uspsPrepaid] = await Promise.all([
      readLog(),
      readSettlements(),
      lastSettlementByCarrier(),
      fetchUspsPrepaid(),
    ]);

    const balances: CarrierBalance[] = CARRIERS.map((carrier) => {
      const last = lastByCarrier[carrier] ?? null;

      const carrierShipments = shipments.filter((s) => s.carrier === carrier && !s.voided);
      // Only carrier-confirmed (scanned) shipments count toward what's owed.
      // Awaiting-scan labels are tracked for visibility but excluded from the balance.
      const confirmed = carrierShipments.filter((s) => s.accepted === true);
      const pendingCount = carrierShipments.length - confirmed.length;

      const confirmedUSD = confirmed.reduce(
        (sum, s) => sum + (s.shippingUSD ?? 0) + (s.insuranceUSD ?? 0),
        0
      );
      // Balance is a running ledger: total confirmed charges minus payments made.
      const paidUSD = settlements
        .filter((s) => s.carrier === carrier)
        .reduce((sum, s) => sum + (s.amountUSD ?? 0), 0);
      const owedUSD = confirmedUSD - paidUSD;

      const oldest = confirmed.reduce<string | null>(
        (acc, s) => (acc == null || s.timestamp < acc ? s.timestamp : acc),
        null
      );

      return {
        carrier,
        owedUSD: Math.round(owedUSD * 100) / 100,
        confirmedUSD: Math.round(confirmedUSD * 100) / 100,
        paidUSD: Math.round(paidUSD * 100) / 100,
        shipmentCount: confirmed.length,
        pendingCount,
        oldestUnsettledAt: oldest,
        lastSettlement: last,
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
