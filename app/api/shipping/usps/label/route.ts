import { NextRequest, NextResponse } from 'next/server';
import { getUspsToken, BASE } from '@/lib/uspsToken';

interface LegacyShipment {
  customerName?: string;
  customerPhone?: string;
  destStreet?: string;
  destCity?: string;
  destState?: string;
  destZip?: string;
  originZip?: string;
  weightLbs?: number | string;
  lengthIn?: number | string;
  widthIn?: number | string;
  heightIn?: number | string;
}

interface NewUspsRequest {
  groupName?: string;
  shipment?: {
    mailingDate?: string;
    fromAddress?: {
      firstName?: string;
      lastName?: string;
      streetAddress?: string;
      city?: string;
      state?: string;
      ZIPCode?: string;
      ZIPPlus4?: string;
      phone?: string;
    };
    toAddress?: {
      firstName?: string;
      lastName?: string;
      streetAddress?: string;
      city?: string;
      state?: string;
      ZIPCode?: string;
      ZIPPlus4?: string;
      phone?: string;
    };
    packageDetails?: Array<{
      weight?: number | string;
      weightUOM?: string;
      length?: number | string;
      width?: number | string;
      height?: number | string;
      dimensionsUOM?: string;
      mailClass?: string;
      rateIndicator?: string;
      processingCategory?: string;
      destinationEntryFacilityType?: string;
      priceType?: string;
      extraServices?: Array<{ extraService: number }>;
    }>;
  };
  payment?: {
    paymentMethod?: string;
    accountNumber?: string;
    crid?: string;
    mid?: string;
    manifestMid?: string;
    accountType?: string;
  };
}

function zipParts(zip: string): { ZIPCode: string; ZIPPlus4?: string } {
  const digits = String(zip ?? '').replace(/\D/g, '');
  const ZIPCode = digits.slice(0, 5);
  return digits.length > 5 ? { ZIPCode, ZIPPlus4: digits.slice(5, 9) } : { ZIPCode };
}

export async function POST(req: NextRequest) {
  try {
    if (!process.env.USPS_CLIENT_ID || !process.env.USPS_CLIENT_SECRET) {
      return NextResponse.json({ error: 'USPS credentials not configured' }, { status: 503 });
    }
    if (!process.env.USPS_CRID || !process.env.USPS_MID) {
      return NextResponse.json(
        { error: 'USPS_CRID and USPS_MID are required for label printing' },
        { status: 503 }
      );
    }

    const body = (await req.json()) as {
      shipment?: LegacyShipment;
      serviceCode?: string;
      insurance?: { enabled?: boolean; valueUSD?: number };
    } & NewUspsRequest;

    const hasNewShape = Boolean(body?.shipment && (body as NewUspsRequest).payment);

    // Legacy UI payload: { shipment, serviceCode, insurance }
    const legacyShipment = body.shipment as LegacyShipment | undefined;
    const legacyServiceCode = body.serviceCode;
    const insurance = body.insurance;

    // New payload shape:
    // {
    //   groupName,
    //   shipment: { mailingDate, fromAddress, toAddress, packageDetails: [...] },
    //   payment: { paymentMethod, accountNumber, crid }
    // }
    const modern = body as NewUspsRequest;
    const pkg = modern.shipment?.packageDetails?.[0];

    const token = await getUspsToken('labels');

    // Get payment authorization token (required for Labels API)
    // PC Postage accounts use the PC Postage flow: LABEL_OWNER only, no PAYER role
    const paymentMethod = modern.payment?.paymentMethod ?? process.env.USPS_ACCOUNT_TYPE ?? 'EPS';
    const effectiveCrid = modern.payment?.crid ?? process.env.USPS_CRID;
    const effectiveMid = modern.payment?.mid ?? process.env.USPS_MID;
    const effectiveManifestMid = modern.payment?.manifestMid ?? process.env.USPS_MANIFEST_MID ?? effectiveMid;
    const effectiveAccountNumber = modern.payment?.accountNumber ?? process.env.USPS_EPS_ACCOUNT_NUMBER;
    const effectiveAccountType = modern.payment?.accountType ?? paymentMethod;

    const pcPostageFlow = !effectiveAccountNumber || process.env.USPS_PC_POSTAGE === 'true';
    const payAuthRoles: object[] = [
      {
        roleName: 'LABEL_OWNER',
        CRID: effectiveCrid,
        MID: effectiveMid,
        manifestMID: effectiveManifestMid,
      },
    ];
    if (!pcPostageFlow) {
      payAuthRoles.push({
        roleName: 'PAYER',
        CRID: effectiveCrid,
        accountType: effectiveAccountType,
        accountNumber: effectiveAccountNumber,
      });
    }
    const payAuthPayload = { roles: payAuthRoles };
    console.log('USPS payment auth payload:', JSON.stringify(payAuthPayload));

    const payAuthRes = await fetch(`${BASE}/payments/v3/payment-authorization`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payAuthPayload),
    });
    if (!payAuthRes.ok) {
      const body = await payAuthRes.text();
      console.error(`USPS payment auth error ${payAuthRes.status}: ${body}`);
      // 500 with empty message = USPS account configuration issue.
      // Fix: (1) link the developer app to your business account in the USPS
      //          Business Customer Gateway (business.usps.com),
      //      (2) confirm Level-2 API access is approved in developer.usps.com,
      //      (3) verify CRID / MID / EPS account number match your BCG account.
      // For testing, set USPS_SANDBOX=true and use test credentials from
      // the USPS developer portal (apis-tem.usps.com).
      return NextResponse.json(
        {
          error: `USPS payment auth error (${payAuthRes.status}) — ${body}`,
          hint: 'Shipment may not be registered with USPS. Verify manually.',
        },
        { status: payAuthRes.status }
      );
    }
    const payAuthData = await payAuthRes.json();
    const paymentToken: string = payAuthData.paymentAuthorizationToken;

    // Build insurance extra service if enabled (legacy flow)
    const extraServices: { extraService: number }[] = [];
    if (insurance?.enabled && (insurance?.valueUSD ?? 0) > 0) {
      extraServices.push({ extraService: 930 }); // 930 = Insurance (Retail)
    }

    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

    // Split customer name into first/last for USPS address format (legacy flow)
    const nameParts = (legacyShipment?.customerName || 'Customer').trim().split(' ');
    const firstName = nameParts[0] ?? 'Customer';
    const lastName = nameParts.slice(1).join(' ') || firstName;

    const legacyToZip = zipParts(String(legacyShipment?.destZip ?? ''));
    const legacyFromZip = zipParts(String(legacyShipment?.originZip ?? ''));

    const payload = hasNewShape
      ? {
          imageInfo: {
            imageType: 'PDF',
            labelType: '4X6LABEL',
          },
          toAddress: {
            firstName: modern.shipment?.toAddress?.firstName ?? 'Customer',
            lastName: modern.shipment?.toAddress?.lastName ?? modern.shipment?.toAddress?.firstName ?? 'Customer',
            streetAddress: modern.shipment?.toAddress?.streetAddress ?? '',
            city: modern.shipment?.toAddress?.city ?? '',
            state: modern.shipment?.toAddress?.state ?? '',
            ZIPCode: modern.shipment?.toAddress?.ZIPCode ?? '',
            ...(modern.shipment?.toAddress?.ZIPPlus4 ? { ZIPPlus4: modern.shipment.toAddress.ZIPPlus4 } : {}),
            ...(modern.shipment?.toAddress?.phone ? { phone: modern.shipment.toAddress.phone } : {}),
          },
          fromAddress: {
            firstName: modern.shipment?.fromAddress?.firstName ?? 'Storm Lake Pack and Ship',
            lastName: modern.shipment?.fromAddress?.lastName ?? '',
            streetAddress: modern.shipment?.fromAddress?.streetAddress ?? '407 Lake Ave',
            city: modern.shipment?.fromAddress?.city ?? 'Storm Lake',
            state: modern.shipment?.fromAddress?.state ?? 'IA',
            ZIPCode: modern.shipment?.fromAddress?.ZIPCode ?? '',
            ...(modern.shipment?.fromAddress?.ZIPPlus4 ? { ZIPPlus4: modern.shipment.fromAddress.ZIPPlus4 } : {}),
            ...(modern.shipment?.fromAddress?.phone ? { phone: modern.shipment.fromAddress.phone } : {}),
          },
          packageDescription: {
            weight: Number(pkg?.weight ?? 0),
            weightUOM: pkg?.weightUOM ?? 'lb',
            length: Number(pkg?.length ?? 1),
            width: Number(pkg?.width ?? 1),
            height: Number(pkg?.height ?? 1),
            dimensionsUOM: pkg?.dimensionsUOM ?? 'in',
            mailClass: String(pkg?.mailClass ?? legacyServiceCode ?? 'USPS_GROUND_ADVANTAGE'),
            rateIndicator: pkg?.rateIndicator ?? 'SP',
            processingCategory: pkg?.processingCategory ?? 'MACHINABLE',
            destinationEntryFacilityType: pkg?.destinationEntryFacilityType ?? 'NONE',
            priceType: pkg?.priceType ?? 'RETAIL',
            extraServices: pkg?.extraServices ?? [],
            mailingDate: modern.shipment?.mailingDate ?? today,
          },
          ...(modern.groupName ? { groupName: modern.groupName } : {}),
        }
      : {
      imageInfo: {
        imageType: 'PDF',
        labelType: '4X6LABEL',
      },
      toAddress: {
        firstName,
        lastName,
        streetAddress: legacyShipment?.destStreet || '',
        city: legacyShipment?.destCity || '',
        state: legacyShipment?.destState || '',
        ZIPCode: legacyToZip.ZIPCode,
        ...(legacyToZip.ZIPPlus4 ? { ZIPPlus4: legacyToZip.ZIPPlus4 } : {}),
        ...(legacyShipment?.customerPhone ? { phone: legacyShipment.customerPhone } : {}),
      },
      fromAddress: {
        firstName: 'Storm Lake Pack and Ship',
        lastName: '',
        streetAddress: '407 Lake Ave',
        city: 'Storm Lake',
        state: 'IA',
        ZIPCode: legacyFromZip.ZIPCode,
        ...(legacyFromZip.ZIPPlus4 ? { ZIPPlus4: legacyFromZip.ZIPPlus4 } : {}),
      },
      packageDescription: {
        weight: Number(legacyShipment?.weightLbs),
        weightUOM: 'lb',
        length: Number(legacyShipment?.lengthIn),
        width: Number(legacyShipment?.widthIn),
        height: Number(legacyShipment?.heightIn),
        dimensionsUOM: 'in',
        mailClass: String(legacyServiceCode),
        rateIndicator: 'SP',
        processingCategory: 'MACHINABLE',
        destinationEntryFacilityType: 'NONE',
        priceType: 'RETAIL',
        extraServices,
        mailingDate: today,
      },
    };

    const labelRes = await fetch(`${BASE}/labels/v3/label`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Payment-Authorization-Token': paymentToken,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!labelRes.ok) {
      const body = await labelRes.text();
      console.error(`USPS label error ${labelRes.status}: ${body}`);
      return NextResponse.json(
        { error: `USPS label error (${labelRes.status})`, details: body },
        { status: labelRes.status }
      );
    }

    const data = await labelRes.json();
    const trackingNumber: string = data.trackingNumber ?? 'PENDING';
    const labelBase64: string | null = data.labelImage ?? null;

    return NextResponse.json({
      trackingNumber,
      labelBase64,
      labelMimeType: labelBase64 ? 'application/pdf' : null,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
