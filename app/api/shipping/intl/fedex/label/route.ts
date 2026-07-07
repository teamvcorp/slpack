import { NextRequest, NextResponse } from 'next/server';
import { logAndRespond } from '@/lib/apiErrors';
import { getFedexToken } from '@/lib/carrierTokens';
import { SITE } from '@/lib/siteConfig';
import { normalizePostal } from '@/lib/postal';
import { fedexCustomsClearanceDetail, fedexTotalCustomsValue } from '@/lib/shippingIntl';
import type { IntlShipmentInput, IntlDocument } from '@/app/admin/types/shippingIntl';

// International FedEx label + commercial invoice. Separate from the domestic
// label route so the customs payload can never affect domestic shipping.
const ROUTE = 'shipping/intl/fedex/label';

const ORIGIN = SITE.address;

const BASE = process.env.FEDEX_SANDBOX === 'false'
  ? 'https://apis.fedex.com'
  : 'https://apis-sandbox.fedex.com';

// ETD electronically transmits the commercial invoice to FedEx. Requires the
// shipper account to be ETD-enabled — gate behind an env flag so a non-enabled
// account still produces a printable invoice (below) instead of erroring.
const ETD_ENABLED = process.env.FEDEX_ETD_ENABLED === 'true';

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

    const { shipment, serviceCode, insurance } = await req.json() as {
      shipment: IntlShipmentInput;
      serviceCode: string;
      insurance?: { enabled?: boolean; valueUSD?: number };
    };

    const customs = shipment?.customs;
    if (!customs || !customs.commodities?.length) {
      return await logAndRespond({
        route: ROUTE,
        carrier: 'fedex',
        status: 400,
        message: 'International FedEx label requires customs commodities',
      });
    }

    requestSummary = {
      serviceCode,
      originZip: shipment?.originZip,
      destZip: shipment?.destZip,
      destCountry: shipment?.destCountry,
      residential: Boolean(shipment?.residential),
      weightLbs: shipment?.weightLbs,
      commodities: customs.commodities.length,
      insured: Boolean(insurance?.enabled),
    };

    const token = await getFedexToken();
    const accountNumber = process.env.FEDEX_ACCOUNT_NUMBER;
    const today = new Date().toISOString().split('T')[0];

    const declaredValue =
      insurance?.enabled && Number(insurance?.valueUSD) > 0
        ? {
            declaredValue: {
              amount: Number(Number(insurance!.valueUSD).toFixed(2)),
              currency: customs.currency,
            },
          }
        : {};

    // Electronic trade documents (opt-in) + always request a printable copy.
    const etdSpecialServices = ETD_ENABLED
      ? {
          shipmentSpecialServices: {
            specialServiceTypes: ['ELECTRONIC_TRADE_DOCUMENTS'],
            etdDetail: { requestedDocumentTypes: ['COMMERCIAL_INVOICE'] },
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
              phoneNumber: (shipment.customerPhone || '5555555555').replace(/\D/g, '').slice(0, 15) || '5555555555',
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
              ...(shipment.residential ? { residential: true } : {}),
            },
          },
        ],
        shipDatestamp: today,
        serviceType: String(serviceCode),
        packagingType: 'YOUR_PACKAGING',
        pickupType: 'USE_SCHEDULED_PICKUP',
        shippingChargesPayment: {
          paymentType: 'SENDER',
          payor: {
            responsibleParty: { accountNumber: { value: accountNumber } },
          },
        },
        // ── Customs (commercial invoice) ────────────────────────────────────
        customsClearanceDetail: fedexCustomsClearanceDetail(customs, accountNumber),
        totalCustomsValue: fedexTotalCustomsValue(customs),
        ...etdSpecialServices,
        labelSpecification: {
          imageType: 'PDF',
          labelStockType: 'PAPER_LETTER',
        },
        // Request a printable commercial invoice regardless of ETD enablement.
        shippingDocumentSpecification: {
          shippingDocumentTypes: ['COMMERCIAL_INVOICE'],
          commercialInvoiceDetail: {
            documentFormat: { stockType: 'PAPER_LETTER', docType: 'PDF' },
          },
        },
        requestedPackageLineItems: [
          {
            sequenceNumber: 1,
            weight: { units: 'LB', value: Number(shipment.weightLbs) },
            dimensions: {
              length: Number(shipment.lengthIn),
              width: Number(shipment.widthIn),
              height: Number(shipment.heightIn),
              units: 'IN',
            },
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
        'x-customer-transaction-id': `slpack-intl-label-${Date.now()}`,
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
        message: `FedEx intl ship error (${shipRes.status}): ${detail}`,
        upstreamStatus: shipRes.status,
        upstreamBody: body,
        requestSummary,
      });
    }

    const data = await shipRes.json();
    const completedShipment = data?.output?.transactionShipments?.[0];
    const trackingNumber: string =
      completedShipment?.masterTrackingNumber ??
      completedShipment?.completedPackageDetails?.[0]?.trackingIds?.[0]?.trackingNumber ??
      'PENDING';

    // Label
    const pkgDetails = completedShipment?.completedPackageDetails?.[0];
    const labelBase64: string | null =
      completedShipment?.pieceResponses?.[0]?.packageDocuments?.find(
        (d: Record<string, unknown>) => d.contentType === 'LABEL'
      )?.encodedLabel ??
      pkgDetails?.label?.encodedLabel ??
      null;

    const documents: IntlDocument[] = [];
    if (labelBase64) documents.push({ type: 'LABEL', base64: labelBase64, mimeType: 'application/pdf' });

    // Commercial invoice — returned under shipmentDocuments (ETD) and/or as a
    // package document with contentType COMMERCIAL_INVOICE.
    const shipmentDocs: Record<string, unknown>[] = completedShipment?.shipmentDocuments ?? [];
    const pieceDocs: Record<string, unknown>[] =
      completedShipment?.pieceResponses?.[0]?.packageDocuments ?? [];
    const invoiceDoc =
      shipmentDocs.find((d) => String(d.contentType).toUpperCase().includes('INVOICE')) ??
      pieceDocs.find((d) => String(d.contentType).toUpperCase().includes('INVOICE'));
    const invoiceB64 =
      (invoiceDoc?.encodedLabel as string) ?? (invoiceDoc?.encodedDocument as string) ?? null;
    if (invoiceB64) {
      documents.push({ type: 'COMMERCIAL_INVOICE', base64: invoiceB64, mimeType: 'application/pdf' });
    }

    return NextResponse.json({
      trackingNumber,
      labelBase64,
      labelMimeType: 'application/pdf',
      documents,
    });
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
