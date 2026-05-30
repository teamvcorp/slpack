import { NextRequest, NextResponse } from 'next/server';
import { getShipmentById } from '@/lib/shipmentLog';

/**
 * GET /api/shipping/label/[id]
 * Returns the stored label as a binary download (PNG/PDF) for reprint.
 * Falls back to JSON 404 when the shipment or label data is missing.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  const shipment = await getShipmentById(id);
  if (!shipment) return NextResponse.json({ error: 'Shipment not found' }, { status: 404 });
  if (!shipment.labelBase64) {
    return NextResponse.json({ error: 'No label stored for this shipment' }, { status: 404 });
  }

  // Detect MIME from leading bytes — PDFs start with %PDF, PNGs with the 8-byte signature.
  let bytes: Buffer;
  try {
    bytes = Buffer.from(shipment.labelBase64, 'base64');
  } catch {
    return NextResponse.json({ error: 'Stored label is not valid base64' }, { status: 500 });
  }
  const head = bytes.slice(0, 4).toString('binary');
  const isPdf = head.startsWith('%PDF');
  const mime = isPdf ? 'application/pdf' : 'image/png';
  const ext = isPdf ? 'pdf' : 'png';

  return new NextResponse(new Uint8Array(bytes), {
    status: 200,
    headers: {
      'Content-Type': mime,
      'Content-Disposition': `inline; filename="label-${shipment.trackingNumber ?? id}.${ext}"`,
      'Cache-Control': 'private, no-cache',
    },
  });
}
