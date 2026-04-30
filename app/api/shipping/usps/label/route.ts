import { NextRequest, NextResponse } from 'next/server';
import { getUspsToken } from '@/lib/uspsToken';

export async function POST(req: NextRequest) {
  try {
    if (!process.env.USPS_CLIENT_ID || !process.env.USPS_CLIENT_SECRET) {
      return NextResponse.json({ error: 'USPS credentials not configured' }, { status: 503 });
    }

    const { shipment, serviceCode, insurance } = await req.json();

    const token = await getUspsToken();

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
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!labelRes.ok) {
      const body = await labelRes.text();
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
