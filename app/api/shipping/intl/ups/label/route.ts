import { NextRequest, NextResponse } from 'next/server';
import { logAndRespond } from '@/lib/apiErrors';
import { getUpsToken } from '@/lib/carrierTokens';
import { SITE } from '@/lib/siteConfig';
import { normalizePostal } from '@/lib/postal';
import { upsInternationalForms } from '@/lib/shippingIntl';
import type { IntlShipmentInput, IntlDocument } from '@/app/admin/types/shippingIntl';

// International UPS label + commercial invoice (Paperless). Separate from the
// domestic label route so InternationalForms can never affect domestic labels.
const ROUTE = 'shipping/intl/ups/label';

const ORIGIN = SITE.address;

const BASE = process.env.UPS_SANDBOX === 'false'
  ? 'https://onlinetools.ups.com'
  : 'https://wwwcie.ups.com';

export async function POST(req: NextRequest) {
  let requestSummary: Record<string, unknown> | undefined;
  try {
    if (!process.env.UPS_CLIENT_ID || !process.env.UPS_CLIENT_SECRET) {
      return await logAndRespond({
        route: ROUTE,
        carrier: 'ups',
        status: 503,
        message: 'UPS credentials not configured',
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
        carrier: 'ups',
        status: 400,
        message: 'International UPS label requires customs commodities',
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

    const token = await getUpsToken();

    const packageWeight = {
      UnitOfMeasurement: { Code: 'LBS' },
      Weight: String(shipment.weightLbs),
    };
    const packageDims = {
      UnitOfMeasurement: { Code: 'IN' },
      Length: String(shipment.lengthIn),
      Width: String(shipment.widthIn),
      Height: String(shipment.heightIn),
    };

    const packageServiceOptions =
      insurance?.enabled && Number(insurance?.valueUSD) > 0
        ? {
            PackageServiceOptions: {
              DeclaredValue: {
                CurrencyCode: customs.currency,
                MonetaryValue: String(Number(insurance!.valueUSD).toFixed(2)),
              },
            },
          }
        : {};

    const destAddressLines = [
      shipment.destStreet || '',
      ...(shipment.destStreet2?.trim() ? [shipment.destStreet2.trim()] : []),
    ];

    const internationalForms = upsInternationalForms(customs, {
      name: shipment.customerName || 'Customer',
      phone: shipment.customerPhone,
      addressLines: destAddressLines,
      city: shipment.destCity || '',
      stateProvinceCode: shipment.destState || undefined,
      postalCode: normalizePostal(shipment.destZip, shipment.destCountry),
      countryCode: String(shipment.destCountry || 'US'),
    });

    const payload = {
      ShipmentRequest: {
        Request: {
          RequestOption: 'nonvalidate',
          TransactionReference: { CustomerContext: 'slpack-intl-label' },
        },
        Shipment: {
          Description: customs.contentsDescription?.trim() || 'International shipment',
          Shipper: {
            Name: shipment.senderName?.trim() || 'Storm Lake Pack and Ship',
            // International labels require an attention name on the shipper/ship-from.
            AttentionName: (shipment.senderName?.trim() || 'Storm Lake Pack and Ship').slice(0, 35),
            Phone: { Number: (shipment.senderPhone || '7122131234').replace(/\D/g, '').slice(0, 15) || '7122131234' },
            ShipperNumber: process.env.UPS_ACCOUNT_NUMBER ?? '',
            Address: {
              AddressLine: [ORIGIN.street],
              City: ORIGIN.city,
              StateProvinceCode: ORIGIN.region,
              PostalCode: shipment.originZip || ORIGIN.postalCode,
              CountryCode: ORIGIN.country,
            },
          },
          ShipTo: {
            Name: shipment.customerName || 'Customer',
            // International labels require a ship-to attention name; default to recipient.
            AttentionName: (shipment.destAttention?.trim() || shipment.customerName || 'Customer').slice(0, 35),
            Phone: { Number: shipment.customerPhone || '5555555555' },
            Address: {
              AddressLine: destAddressLines,
              City: shipment.destCity || '',
              StateProvinceCode: shipment.destState || '',
              PostalCode: normalizePostal(shipment.destZip, shipment.destCountry),
              CountryCode: String(shipment.destCountry || 'US'),
              ...(shipment.residential ? { ResidentialAddressIndicator: '' } : {}),
            },
          },
          ShipFrom: {
            Name: shipment.senderName?.trim() || 'Storm Lake Pack and Ship',
            AttentionName: (shipment.senderName?.trim() || 'Storm Lake Pack and Ship').slice(0, 35),
            Phone: { Number: (shipment.senderPhone || '7122131234').replace(/\D/g, '').slice(0, 15) || '7122131234' },
            Address: {
              AddressLine: [ORIGIN.street],
              City: ORIGIN.city,
              StateProvinceCode: ORIGIN.region,
              PostalCode: shipment.originZip || ORIGIN.postalCode,
              CountryCode: ORIGIN.country,
            },
          },
          PaymentInformation: {
            ShipmentCharge: {
              Type: '01',
              BillShipper: { AccountNumber: process.env.UPS_ACCOUNT_NUMBER ?? '' },
            },
          },
          Service: { Code: serviceCode ?? '65', Description: 'Service' },
          // ── Customs (commercial invoice / Paperless) ──────────────────────
          ShipmentServiceOptions: {
            InternationalForms: internationalForms,
          },
          Package: [
            {
              // Merchandise description is required on international packages.
              Description: (customs.contentsDescription?.trim() || customs.commodities[0]?.description || 'Merchandise').slice(0, 35),
              Packaging: { Code: '02' },
              Dimensions: packageDims,
              PackageWeight: packageWeight,
              ...packageServiceOptions,
            },
          ],
        },
        LabelSpecification: {
          LabelImageFormat: { Code: 'GIF', Description: 'GIF' },
        },
      },
    };

    const labelRes = await fetch(`${BASE}/api/shipments/v2501/ship`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!labelRes.ok) {
      const body = await labelRes.text();
      let detail = body;
      try {
        const parsed = JSON.parse(body);
        const msg =
          parsed?.response?.errors?.[0]?.message ??
          parsed?.Fault?.detail?.Errors?.ErrorDetail?.PrimaryErrorCode?.Description ??
          null;
        if (msg) detail = msg;
      } catch { /* keep raw body */ }
      return await logAndRespond({
        route: ROUTE,
        carrier: 'ups',
        status: labelRes.status,
        message: `UPS intl label error (${labelRes.status}): ${detail}`,
        upstreamStatus: labelRes.status,
        upstreamBody: body,
        requestSummary,
      });
    }

    const data = await labelRes.json();
    const shipResponse = data?.ShipmentResponse?.ShipmentResults;
    const trackingNumber: string =
      shipResponse?.ShipmentIdentificationNumber ?? 'PENDING';

    const pkgResults = Array.isArray(shipResponse?.PackageResults)
      ? shipResponse.PackageResults[0]
      : shipResponse?.PackageResults;
    const labelBase64: string | null = pkgResults?.ShippingLabel?.GraphicImage ?? null;

    const documents: IntlDocument[] = [];
    if (labelBase64) documents.push({ type: 'LABEL', base64: labelBase64, mimeType: 'image/gif' });

    // Commercial invoice image(s) come back under ShipmentResults.Form (array or object).
    const formsRaw = shipResponse?.Form ?? [];
    const forms: Record<string, unknown>[] = Array.isArray(formsRaw) ? formsRaw : [formsRaw];
    for (const form of forms) {
      const image = form?.Image as Record<string, unknown> | undefined;
      const graphic = image?.GraphicImage as string | undefined;
      if (!graphic) continue;
      const fmt = String(
        (image?.ImageFormat as Record<string, string> | undefined)?.Code ?? 'PDF'
      ).toUpperCase();
      const mimeType = fmt === 'GIF' ? 'image/gif' : fmt === 'PNG' ? 'image/png' : 'application/pdf';
      documents.push({ type: 'COMMERCIAL_INVOICE', base64: graphic, mimeType });
    }

    return NextResponse.json({
      trackingNumber,
      labelBase64,
      labelMimeType: labelBase64 ? 'image/gif' : null,
      documents,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return await logAndRespond({
      route: ROUTE,
      carrier: 'ups',
      status: 500,
      message,
      requestSummary,
      err,
    });
  }
}
