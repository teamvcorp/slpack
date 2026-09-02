import { NextRequest, NextResponse } from 'next/server';
import { serverBuildId } from '@/lib/appVersion';
import { logAndRespond } from '@/lib/apiErrors';
import { getFedexToken } from '@/lib/carrierTokens';
import { fedexTransitToDays, formatDeliveryDate } from '@/lib/transit';
import { normalizePostal } from '@/lib/postal';
import { normalizeSignature, fedexSignatureBlock } from '@/lib/signatureOption';
import { localDateStamp } from '@/lib/localDate';

const ROUTE = 'shipping/fedex';

const BASE = process.env.FEDEX_SANDBOX === 'false'
  ? 'https://apis.fedex.com'
  : 'https://apis-sandbox.fedex.com';

export async function POST(req: NextRequest) {
  let requestSummary: Record<string, unknown> | undefined;
  try {
    if (!process.env.FEDEX_CLIENT_ID || !process.env.FEDEX_CLIENT_SECRET) {
      return await logAndRespond({
        route: ROUTE,
        carrier: 'fedex',
        status: 503,
        message: 'FedEx credentials not configured (FEDEX_CLIENT_ID / FEDEX_CLIENT_SECRET)',
      });
    }

    const {
      originZip, destZip, destCountry, residential,
      weightLbs, lengthIn, widthIn, heightIn, packaging, signature,
    } = await req.json();
    requestSummary = { originZip, destZip, destCountry, residential: Boolean(residential), weightLbs, lengthIn, widthIn, heightIn, packaging, signature };

    // Whitelist the packaging type — never pass a client string straight to the
    // carrier. FEDEX_ENVELOPE = FedEx's own envelope (cheaper document rate,
    // Express services only); anything else rates as our own packaging.
    const fedexPackaging = packaging === 'FEDEX_ENVELOPE' ? 'FEDEX_ENVELOPE' : 'YOUR_PACKAGING';

    // Signature carries a carrier surcharge, so it is priced HERE as well as on
    // the label — quoting without it would leave the fee on the invoice with
    // nothing collected against it. Whitelisted, never passed verbatim.
    const signatureOption = normalizeSignature(signature);

    const token = await getFedexToken();

    // Store-local date (America/Chicago) — UTC would roll past midnight at 7 pm
    // local and shift FedEx's committed delivery date. See lib/localDate.ts.
    const today = localDateStamp(); // YYYY-MM-DD

    const payload = {
      accountNumber: { value: process.env.FEDEX_ACCOUNT_NUMBER ?? '' },
      // returnTransitTimes: include commit/transit-time details with the rates.
      // variableOptions SATURDAY_DELIVERY: also return Saturday-delivery
      // variants — FedEx replies with DUPLICATE serviceType entries (standard +
      // Saturday, flagged commit.saturdayDelivery=true, surcharge already in
      // the net charge). NOTE: never request Saturday via shipmentSpecialServices
      // here — that would suppress the standard variants entirely.
      // See saturday_delivery_notes.md.
      rateRequestControlParameters: {
        returnTransitTimes: true,
        variableOptions: 'SATURDAY_DELIVERY',
      },
      requestedShipment: {
        shipper: { address: { postalCode: String(originZip), countryCode: 'US' } },
        recipient: {
          address: {
            postalCode: normalizePostal(destZip, destCountry),
            countryCode: String(destCountry || 'US'),
            // Residential deliveries carry a surcharge; omit/false for commercial.
            ...(residential ? { residential: true } : {}),
          },
        },
        pickupType: 'USE_SCHEDULED_PICKUP',
        shipDateStamp: today, // lets FedEx compute committed delivery dates
        packagingType: fedexPackaging,
        // ACCOUNT = our negotiated rate (actual cost); LIST = FedEx's published
        // retail. Asking for LIST returns list rates IN ADDITION to the account
        // ones (FedEx Rate API docs), so both arrive as separate
        // ratedShipmentDetails entries keyed by rateType — we price off ACCOUNT
        // and keep LIST as the customer-facing reference. See
        // carrier_rate_pricing_notes.md.
        rateRequestType: ['ACCOUNT', 'LIST'],
        requestedPackageLineItems: [
          {
            weight: { units: 'LB', value: Number(weightLbs) },
            // Dimensions only apply to our own packaging — FedEx-branded
            // packaging (envelope) has known dimensions; sending ours can
            // reject the request or mis-rate it.
            ...(fedexPackaging === 'YOUR_PACKAGING'
              ? {
                  dimensions: {
                    length: Number(lengthIn),
                    width: Number(widthIn),
                    height: Number(heightIn),
                    units: 'IN',
                  },
                }
              : {}),
            // signatureOptionType and specialServiceTypes must travel TOGETHER;
            // either alone returns "Special service SIGNATURE_OPTION is invalid".
            ...fedexSignatureBlock(signatureOption),
          },
        ],
      },
    };

    const rateRes = await fetch(`${BASE}/rate/v1/rates/quotes`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'x-customer-transaction-id': `slpack-${Date.now()}`,
        'x-locale': 'en_US',
      },
      body: JSON.stringify(payload),
    });

    if (!rateRes.ok) {
      const body = await rateRes.text();
      return await logAndRespond({
        route: ROUTE,
        carrier: 'fedex',
        status: rateRes.status,
        message: `FedEx rate error (${rateRes.status})`,
        upstreamStatus: rateRes.status,
        upstreamBody: body,
        requestSummary,
      });
    }

    const data = await rateRes.json();
    const details: unknown[] = data?.output?.rateReplyDetails ?? [];

    const rates = (details as Record<string, unknown>[]).map((d) => {
      const detailsArr = (d.ratedShipmentDetails as Record<string, unknown>[]) ?? [];
      // Prefer the ACCOUNT (negotiated) rated detail; fall back to the first.
      const account = detailsArr.find(
        (x) => x.rateType === 'ACCOUNT' || x.rateType === 'PAYOR_ACCOUNT_PACKAGE'
      );
      // No ACCOUNT detail means detailsArr[0] is normally the LIST (published)
      // price. The label response reports the negotiated figure regardless
      // (lib/carrierCost.ts), so quoting list here marks retail up off a number
      // we never pay. Flag it instead of degrading silently.
      const shipDetail = account ?? detailsArr[0];
      const rateSource = account ? 'negotiated' : 'published';
      const netCharge =
        (shipDetail?.totalNetFedExCharge as string) ??
        (shipDetail?.totalNetCharge as string) ??
        '0';
      // FedEx's published retail, returned alongside ACCOUNT because we now ask
      // for both rate types. Kept as the customer-facing reference and as the
      // fallback cost basis when no account rate came back.
      const list = detailsArr.find((x) => x.rateType === 'LIST');
      const listPrice = parseFloat(
        (list?.totalNetFedExCharge as string) ?? (list?.totalNetCharge as string) ?? ''
      );
      // FedEx returns transit time as an enum ("TWO_DAYS"), under either
      // commit.transitDays or commit.transitTime depending on the service.
      const commit = d.commit as Record<string, unknown> | undefined;
      const dateDetail = commit?.dateDetail as Record<string, string> | undefined;
      const estimatedDays =
        fedexTransitToDays(commit?.transitDays) ?? fedexTransitToDays(commit?.transitTime);
      const deliveryDate = formatDeliveryDate(
        dateDetail?.dayFormat ?? dateDetail?.dayCxsFormat
      );
      // Saturday variant? (duplicate serviceType entry from variableOptions —
      // its Saturday surcharge is already inside the net charge above).
      const saturdayDelivery = commit?.saturdayDelivery === true;
      const baseName = (d.serviceName as string) ?? (d.serviceType as string);
      return {
        serviceCode: d.serviceType as string,
        // Suffix appended HERE ONLY — cart, receipts, and the shipment log all
        // display serviceName, so they inherit it. Don't re-append downstream.
        serviceName: saturdayDelivery ? `${baseName} — Saturday Delivery` : baseName,
        totalChargeUSD: parseFloat(netCharge),
        estimatedDays,
        deliveryDate,
        rateSource,
        ...(Number.isFinite(listPrice) && listPrice > 0 ? { listPriceUSD: listPrice } : {}),
        ...(saturdayDelivery ? { saturdayDelivery: true } : {}),
      };
    });

    // buildId lets the page detect a tab left open across a deploy.
    return NextResponse.json({ rates, buildId: serverBuildId() });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return await logAndRespond({
      route: ROUTE,
      carrier: 'fedex',
      status: 500,
      message,
      requestSummary,
      err,
    });
  }
}
