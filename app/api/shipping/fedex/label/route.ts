import { NextRequest, NextResponse } from 'next/server';
import { logAndRespond } from '@/lib/apiErrors';
import { getFedexToken } from '@/lib/carrierTokens';
import { SITE } from '@/lib/siteConfig';
import { normalizePostal } from '@/lib/postal';
import { localDateStamp } from '@/lib/localDate';

const ROUTE = 'shipping/fedex/label';

// FedEx offers Saturday delivery only on Express services (US), for a
// surcharge. The docs list First Overnight / Priority Overnight / 2Day, but
// the Rate API also returns Saturday variants for STANDARD_OVERNIGHT and
// FEDEX_2_DAY_AM (verified in sandbox 2026-08-07), so the whitelist covers
// every service FedEx itself quotes with commit.saturdayDelivery=true — a
// quoted+charged Saturday rate must never be silently booked as Mon–Fri.
// Whitelist = defense in depth: a hand-crafted request can't attach
// SATURDAY_DELIVERY to Ground/Home. See saturday_delivery_notes.md.
const SATURDAY_ELIGIBLE_SERVICES = new Set([
  'FIRST_OVERNIGHT',
  'PRIORITY_OVERNIGHT',
  'STANDARD_OVERNIGHT',
  'FEDEX_2_DAY',
  'FEDEX_2_DAY_AM',
]);

const ORIGIN = SITE.address;

const BASE = process.env.FEDEX_SANDBOX === 'false'
  ? 'https://apis.fedex.com'
  : 'https://apis-sandbox.fedex.com';

export async function POST(req: NextRequest) {
  let requestSummary: Record<string, unknown> | undefined;
  try {
    if (!process.env.FEDEX_CLIENT_ID || !process.env.FEDEX_CLIENT_SECRET || !process.env.FEDEX_ACCOUNT_NUMBER) {
      return await logAndRespond({
        route: ROUTE,
        carrier: 'fedex',
        status: 503,
        message: 'FedEx credentials not configured (FEDEX_CLIENT_ID / FEDEX_CLIENT_SECRET / FEDEX_ACCOUNT_NUMBER)',
      });
    }

    const { shipment, serviceCode, insurance, saturdayDelivery } = await req.json();

    // Strict-boolean coerce (never trust client strings like "false"), then
    // gate on the eligible-service whitelist above.
    const saturdayRequested = saturdayDelivery === true;
    const saturdayEligible =
      saturdayRequested && SATURDAY_ELIGIBLE_SERVICES.has(String(serviceCode));

    // Whitelist the packaging type — FEDEX_ENVELOPE books FedEx's own envelope
    // (cheaper document pricing, Express only); anything else = our packaging.
    const fedexPackaging =
      shipment?.packaging === 'FEDEX_ENVELOPE' ? 'FEDEX_ENVELOPE' : 'YOUR_PACKAGING';

    requestSummary = {
      serviceCode,
      saturdayDelivery: saturdayRequested,
      packaging: fedexPackaging,
      originZip: shipment?.originZip,
      destZip: shipment?.destZip,
      destCountry: shipment?.destCountry,
      residential: Boolean(shipment?.residential),
      weightLbs: shipment?.weightLbs,
      lengthIn: shipment?.lengthIn,
      widthIn: shipment?.widthIn,
      heightIn: shipment?.heightIn,
      insured: Boolean(insurance?.enabled),
    };

    const token = await getFedexToken();
    const accountNumber = process.env.FEDEX_ACCOUNT_NUMBER;
    // Store-local date — CRITICAL for the delivery commitment: with UTC, a
    // 7 pm Friday label was stamped *Saturday*, so FedEx committed to Monday
    // even for Saturday-delivery shipments. See lib/localDate.ts.
    const today = localDateStamp(); // YYYY-MM-DD

    // Build declared value object for insurance
    const declaredValue =
      insurance?.enabled && insurance?.valueUSD > 0
        ? {
            declaredValue: {
              amount: Number(insurance.valueUSD.toFixed(2)),
              currency: 'USD',
            },
          }
        : {};

    const payload = {
      labelResponseOptions: 'LABEL',
      accountNumber: { value: accountNumber },
      requestedShipment: {
        shipper: {
          contact: {
            personName: shipment.senderName?.trim() || 'Storm Lake Pack and Ship',
            phoneNumber: (shipment.senderPhone || '7122131234').replace(/\D/g, '').slice(0, 15) || '7122131234',
            companyName: 'Storm Lake Pack and Ship',
          },
          address: {
            streetLines: [ORIGIN.street],
            city: ORIGIN.city,
            stateOrProvinceCode: ORIGIN.region,
            postalCode: String(shipment.originZip || ORIGIN.postalCode),
            countryCode: ORIGIN.country,
          },
        },
        recipients: [
          {
            contact: {
              personName: shipment.customerName || 'Customer',
              phoneNumber: shipment.customerPhone || '5555555555',
            },
            address: {
              streetLines: [
                shipment.destStreet || '',
                ...(shipment.destStreet2?.trim() ? [shipment.destStreet2.trim()] : []),
                ...(shipment.destAttention?.trim() ? [`ATTN: ${String(shipment.destAttention).trim()}`] : []),
              ],
              city: shipment.destCity || '',
              stateOrProvinceCode: shipment.destState || '',
              postalCode: normalizePostal(shipment.destZip, shipment.destCountry),
              countryCode: String(shipment.destCountry || 'US'),
              // Match the rate quote: residential delivery carries a surcharge.
              ...(shipment.residential ? { residential: true } : {}),
            },
          },
        ],
        shipDatestamp: today,
        serviceType: String(serviceCode),
        packagingType: fedexPackaging,
        pickupType: 'USE_SCHEDULED_PICKUP',
        // Saturday delivery is a paid special service — WITHOUT this block the
        // label books the standard Mon–Fri commitment (the original bug: quoted
        // Saturday, label printed Monday). FedEx prints a big SAT box on the label.
        ...(saturdayEligible
          ? { shipmentSpecialServices: { specialServiceTypes: ['SATURDAY_DELIVERY'] } }
          : {}),
        shippingChargesPayment: {
          paymentType: 'SENDER',
          payor: {
            responsibleParty: {
              accountNumber: { value: accountNumber },
            },
          },
        },
        labelSpecification: {
          imageType: 'PDF',
          labelStockType: 'PAPER_LETTER',
        },
        requestedPackageLineItems: [
          {
            sequenceNumber: 1,
            weight: {
              units: 'LB',
              value: Number(shipment.weightLbs),
            },
            // Dimensions only for our own packaging — FedEx-branded packaging
            // (envelope) has known dimensions; sending ours can reject/mis-rate.
            ...(fedexPackaging === 'YOUR_PACKAGING'
              ? {
                  dimensions: {
                    length: Number(shipment.lengthIn),
                    width: Number(shipment.widthIn),
                    height: Number(shipment.heightIn),
                    units: 'IN',
                  },
                }
              : {}),
            ...declaredValue,
          },
        ],
      },
    };

    const shipRes = await fetch(`${BASE}/ship/v1/shipments`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'x-customer-transaction-id': `slpack-label-${Date.now()}`,
        'x-locale': 'en_US',
      },
      body: JSON.stringify(payload),
    });

    if (!shipRes.ok) {
      const body = await shipRes.text();
      let detail = body;
      try {
        const parsed = JSON.parse(body);
        const msg =
          parsed?.errors?.[0]?.message ??
          parsed?.output?.alerts?.[0]?.message ??
          null;
        if (msg) detail = msg;
      } catch { /* keep raw body */ }
      return await logAndRespond({
        route: ROUTE,
        carrier: 'fedex',
        status: shipRes.status,
        message: `FedEx ship error (${shipRes.status}): ${detail}`,
        upstreamStatus: shipRes.status,
        upstreamBody: body,
        requestSummary,
      });
    }

    const data = await shipRes.json();

    // Extract tracking number from response
    const completedShipment = data?.output?.transactionShipments?.[0];
    const trackingNumber: string =
      completedShipment?.masterTrackingNumber ??
      completedShipment?.completedPackageDetails?.[0]?.trackingIds?.[0]?.trackingNumber ??
      'PENDING';

    // Extract base64 label — FedEx returns it under pieceResponses[0].packageDocuments
    const pkgDetails = completedShipment?.completedPackageDetails?.[0];
    const labelBase64: string | null =
      completedShipment?.pieceResponses?.[0]?.packageDocuments?.find(
        (d: Record<string, unknown>) => d.contentType === 'LABEL'
      )?.encodedLabel ??
      pkgDetails?.label?.encodedLabel ??
      null;

    return NextResponse.json({ trackingNumber, labelBase64, labelMimeType: 'application/pdf' });
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
