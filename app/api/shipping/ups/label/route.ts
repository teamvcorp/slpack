import { NextRequest, NextResponse } from 'next/server';
import { logAndRespond } from '@/lib/apiErrors';
import { getUpsToken } from '@/lib/carrierTokens';
import { SITE } from '@/lib/siteConfig';
import { normalizePostal } from '@/lib/postal';
import { normalizeSignature, upsDeliveryConfirmation } from '@/lib/signatureOption';
import { upsActualCostUSD } from '@/lib/carrierCost';

const ROUTE = 'shipping/ups/label';

const ORIGIN = SITE.address;

const BASE = process.env.UPS_SANDBOX === 'false'
  ? 'https://onlinetools.ups.com'
  : 'https://wwwcie.ups.com';

// UPS Saturday delivery only exists for the air services (Next Day Air family,
// 2nd Day Air family). Whitelist = defense in depth against hand-crafted
// requests pairing the flag with an ineligible service.
// See saturday_delivery_notes.md.
const SATURDAY_ELIGIBLE_SERVICES = new Set(['01', '13', '14', '02', '59']);

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

    const { shipment, serviceCode, insurance, saturdayDelivery } = await req.json();

    // Strict-boolean coerce (never trust client strings), then whitelist-gate.
    const saturdayEligible =
      saturdayDelivery === true && SATURDAY_ELIGIBLE_SERVICES.has(String(serviceCode));
    // Whitelisted, never taken verbatim — this selection changes what UPS bills us.
    const signatureOption = normalizeSignature(shipment?.signature);

    requestSummary = {
      serviceCode,
      saturdayDelivery: saturdayDelivery === true,
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

    // Declared value AND signature confirmation both live under the SAME
    // PackageServiceOptions key, so they must be merged into one inner object
    // and wrapped once. Spreading two separate `{ PackageServiceOptions: … }`
    // objects would silently drop whichever came first — an insured, signature-
    // required parcel would lose one of the two with no error from UPS.
    //
    // DeclaredValue (NOT a bare InsuredValue — UPS ignores that) defaults to
    // type 01 (EVS) and is what makes UPS actually cover the value.
    // DeliveryConfirmation.DCISType is 2 = signature, 3 = adult; domestic US is
    // package level, unlike the shipment-level Saturday indicator below.
    const serviceOptionsInner: Record<string, unknown> = {
      ...(insurance?.enabled && insurance?.valueUSD > 0
        ? {
            DeclaredValue: {
              CurrencyCode: 'USD',
              MonetaryValue: String(insurance.valueUSD.toFixed(2)),
            },
          }
        : {}),
      ...upsDeliveryConfirmation(signatureOption),
    };
    const packageServiceOptions =
      Object.keys(serviceOptionsInner).length > 0
        ? { PackageServiceOptions: serviceOptionsInner }
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
          // Shipment-level Saturday delivery (distinct from the package-level
          // PackageServiceOptions above). Element presence = true, per UPS's
          // indicator convention. Without it the label books Mon–Fri delivery
          // even when a Saturday rate was quoted.
          ...(saturdayEligible
            ? { ShipmentServiceOptions: { SaturdayDeliveryIndicator: '' } }
            : {}),
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

    // What UPS is actually billing us for this label — null when unrated.
    const carrierCostUSD = upsActualCostUSD(data);

    return NextResponse.json({ trackingNumber, labelBase64, labelMimeType, carrierCostUSD });
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
