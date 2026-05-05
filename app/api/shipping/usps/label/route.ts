import { NextRequest, NextResponse } from 'next/server';
import { getUspsToken, BASE } from '@/lib/uspsToken';

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

    const { shipment, serviceCode, insurance } = await req.json();

    const token = await getUspsToken('labels');

    // Get payment authorization token (required for Labels API)
    // PC Postage accounts use the PC Postage flow: LABEL_OWNER only, no PAYER role
    const pcPostageFlow = !process.env.USPS_EPS_ACCOUNT_NUMBER || process.env.USPS_PC_POSTAGE === 'true';
    const payAuthRoles: object[] = [
      {
        roleName: 'LABEL_OWNER',
        CRID: process.env.USPS_CRID,
        MID: process.env.USPS_MID,
        manifestMID: process.env.USPS_MANIFEST_MID ?? process.env.USPS_MID,
      },
    ];
    if (!pcPostageFlow) {
      payAuthRoles.push({
        roleName: 'PAYER',
        CRID: process.env.USPS_CRID,
        accountType: process.env.USPS_ACCOUNT_TYPE ?? 'EPS',
        accountNumber: process.env.USPS_EPS_ACCOUNT_NUMBER,
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
      return NextResponse.json(
        { error: `USPS payment auth error (${payAuthRes.status})`, details: body },
        { status: payAuthRes.status }
      );
    }
    const payAuthData = await payAuthRes.json();
    const paymentToken: string = payAuthData.paymentAuthorizationToken;

    // Build insurance extra service if enabled
    const extraServices: { extraService: number }[] = [];
    if (insurance?.enabled && insurance?.valueUSD > 0) {
      extraServices.push({ extraService: 930 }); // 930 = Insurance (Retail)
    }

    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

    // Split customer name into first/last for USPS address format
    const nameParts = (shipment.customerName || 'Customer').trim().split(' ');
    const firstName = nameParts[0] ?? 'Customer';
    const lastName = nameParts.slice(1).join(' ') || firstName;

    const payload = {
      imageInfo: {
        imageType: 'PDF',
        labelType: '4X6LABEL',
      },
      toAddress: {
        firstName,
        lastName,
        streetAddress: shipment.destStreet || '',
        city: shipment.destCity || '',
        state: shipment.destState || '',
        ZIPCode: String(shipment.destZip).slice(0, 5),
        ...(String(shipment.destZip).length > 5
          ? { ZIPPlus4: String(shipment.destZip).slice(6, 10) }
          : {}),
        ...(shipment.customerPhone ? { phone: shipment.customerPhone } : {}),
      },
      fromAddress: {
        firstName: 'Storm Lake Pack and Ship',
        lastName: '',
        streetAddress: '407 Lake Ave',
        city: 'Storm Lake',
        state: 'IA',
        ZIPCode: String(shipment.originZip).slice(0, 5),
      },
      packageDescription: {
        weight: Number(shipment.weightLbs),
        weightUOM: 'lb',
        length: Number(shipment.lengthIn),
        width: Number(shipment.widthIn),
        height: Number(shipment.heightIn),
        dimensionsUOM: 'in',
        mailClass: String(serviceCode),
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
