import { NextRequest, NextResponse } from 'next/server';
import { logAndRespond } from '@/lib/apiErrors';
import { getUpsToken } from '@/lib/carrierTokens';
import { SITE } from '@/lib/siteConfig';
import { normalizePostal } from '@/lib/postal';

const ROUTE = 'shipping/ups/label';

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

    const { shipment, serviceCode, insurance } = await req.json();
    requestSummary = {
      serviceCode,
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

    // Declared value goes under PackageServiceOptions.DeclaredValue in the UPS
    // Ship API (NOT a bare InsuredValue on the package — UPS ignores that).
    // Type defaults to 01 (EVS). This is what makes UPS actually cover the value.
    const packageServiceOptions =
      insurance?.enabled && insurance?.valueUSD > 0
        ? {
            PackageServiceOptions: {
              DeclaredValue: {
                CurrencyCode: 'USD',
                MonetaryValue: String(insurance.valueUSD.toFixed(2)),
              },
            },
          }
        : {};

    const payload = {
      ShipmentRequest: {
        Request: {
          RequestOption: 'nonvalidate',
          TransactionReference: { CustomerContext: 'slpack-label' },
        },
        Shipment: {
          Description: 'Package',
          Shipper: {
            Name: shipment.senderName?.trim() || 'Storm Lake Pack and Ship',
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
            ...(shipment.destAttention?.trim()
              ? { AttentionName: String(shipment.destAttention).trim().slice(0, 35) }
              : {}),
            Phone: { Number: shipment.customerPhone || '5555555555' },
            Address: {
              AddressLine: [shipment.destStreet || '', ...(shipment.destStreet2?.trim() ? [shipment.destStreet2.trim()] : [])],
              City: shipment.destCity || '',
              StateProvinceCode: shipment.destState || '',
              PostalCode: normalizePostal(shipment.destZip, shipment.destCountry),
              CountryCode: String(shipment.destCountry || 'US'),
              // Match the rate quote: presence marks residential (surcharge applies).
              ...(shipment.residential ? { ResidentialAddressIndicator: '' } : {}),
            },
          },
          ShipFrom: {
            Name: shipment.senderName?.trim() || 'Storm Lake Pack and Ship',
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
          Service: { Code: serviceCode ?? '03', Description: 'Service' },
          Package: [
            {
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
        message: `UPS label error (${labelRes.status}): ${detail}`,
        upstreamStatus: labelRes.status,
        upstreamBody: body,
        requestSummary,
      });
    }

    const data = await labelRes.json();
    const shipResponse = data?.ShipmentResponse?.ShipmentResults;
    const trackingNumber: string =
      shipResponse?.ShipmentIdentificationNumber ?? 'PENDING';

    // PackageResults may be array or single object
    const pkgResults = Array.isArray(shipResponse?.PackageResults)
      ? shipResponse.PackageResults[0]
      : shipResponse?.PackageResults;
    const labelBase64: string | null =
      pkgResults?.ShippingLabel?.GraphicImage ?? null;

    const labelMimeType = labelBase64 ? 'image/gif' : null;

    return NextResponse.json({ trackingNumber, labelBase64, labelMimeType });
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
