import type { SaleRecord } from '@/app/admin/types/register';
import type { DropoffRecord, DropoffPeriod } from '@/app/admin/types/dropoff';
import type { ShipmentLogEntry, CarrierKey } from '@/app/admin/types/shipping';
import { DROPOFF_CARRIER_LABELS, trackingUrl } from '@/lib/dropoff';

const SHOP_NAME = 'Storm Lake Pack & Ship';

const CARRIER_LABELS: Record<CarrierKey, string> = {
  fedex: 'FedEx',
  ups: 'UPS',
  usps: 'USPS',
  dhl: 'DHL Express',
};

function money(n: number): string {
  return `$${n.toFixed(2)}`;
}

/** Escape user/vendor-supplied text before interpolating into receipt HTML. */
function esc(value: unknown): string {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string
  );
}

/**
 * Builds a self-contained HTML receipt for a register sale.
 *
 * The layout is sized for a ~80mm thermal receipt printer (≈280px) but renders
 * fine on a standard sheet via the default printer too. The same markup is used
 * for the emailed copy, so it relies only on inline styles (no external CSS).
 */
export function buildSaleReceiptHtml(sale: SaleRecord): string {
  const date = new Date(sale.timestamp);
  const dateStr = date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

  const itemRows = sale.items
    .map((it) => {
      const qtyName =
        it.quantity > 1
          ? `${esc(it.name)} <span style="color:#888;">× ${it.quantity}</span>`
          : esc(it.name);
      const unit =
        it.quantity > 1
          ? `<div style="font-size:11px;color:#888;">${money(it.unitAmountUSD)} ea</div>`
          : '';
      return `<tr>
        <td style="padding:3px 0;vertical-align:top;">${qtyName}${unit}</td>
        <td style="padding:3px 0;text-align:right;vertical-align:top;white-space:nowrap;">${money(it.lineTotalUSD)}</td>
      </tr>`;
    })
    .join('');

  const taxLabel =
    sale.taxRate > 0
      ? `Tax (${(sale.taxRate * 100).toFixed(sale.taxRate * 100 % 1 === 0 ? 0 : 2)}%)`
      : 'Tax';
  const taxRow =
    sale.taxUSD > 0 || sale.taxRate > 0
      ? `<tr><td style="padding:2px 0;color:#555;">${taxLabel}</td><td style="padding:2px 0;text-align:right;">${money(sale.taxUSD)}</td></tr>`
      : '';

  const paymentLabel = sale.paymentMethod === 'cash' ? 'Cash' : 'Card';
  const cashRows =
    sale.paymentMethod === 'cash' && sale.cashTenderedUSD != null
      ? `<tr><td style="padding:2px 0;color:#555;">Tendered</td><td style="padding:2px 0;text-align:right;">${money(sale.cashTenderedUSD)}</td></tr>
         <tr><td style="padding:2px 0;color:#555;">Change</td><td style="padding:2px 0;text-align:right;">${money(sale.changeDueUSD ?? 0)}</td></tr>`
      : '';

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Receipt</title>
<style>
  @media print { @page { margin: 6mm; } body { margin: 0; } .no-print { display: none !important; } }
</style>
</head>
<body style="font-family:'Courier New',ui-monospace,monospace;color:#111;margin:0;padding:12px;">
  <div style="max-width:300px;margin:0 auto;">
    <div style="text-align:center;border-bottom:1px dashed #aaa;padding-bottom:10px;margin-bottom:10px;">
      <div style="font-size:17px;font-weight:bold;">${SHOP_NAME}</div>
      <div style="font-size:11px;color:#666;margin-top:2px;">Sales Receipt</div>
      <div style="font-size:11px;color:#666;">${dateStr}</div>
    </div>

    <table style="width:100%;border-collapse:collapse;font-size:13px;">
      ${itemRows}
    </table>

    <table style="width:100%;border-collapse:collapse;font-size:13px;border-top:1px dashed #aaa;margin-top:10px;padding-top:6px;">
      <tr><td style="padding:6px 0 2px;color:#555;">Subtotal</td><td style="padding:6px 0 2px;text-align:right;">${money(sale.subtotalUSD)}</td></tr>
      ${taxRow}
      <tr style="border-top:1px solid #111;">
        <td style="padding:6px 0 0;font-weight:bold;font-size:15px;">Total</td>
        <td style="padding:6px 0 0;text-align:right;font-weight:bold;font-size:15px;">${money(sale.totalUSD)}</td>
      </tr>
      <tr><td style="padding:6px 0 2px;color:#555;">Paid</td><td style="padding:6px 0 2px;text-align:right;">${paymentLabel}</td></tr>
      ${cashRows}
    </table>

    <div style="text-align:center;border-top:1px dashed #aaa;margin-top:12px;padding-top:10px;font-size:11px;color:#666;">
      Thank you for your business!
    </div>
  </div>
</body>
</html>`;
}

/** One shipping package line on a combined receipt. */
export interface CombinedPackageLine {
  carrier: string;
  serviceName: string;
  trackingNumber: string | null;
  amountUSD: number;
}

export interface CombinedReceiptData {
  timestamp: string; // ISO
  paymentMethod: 'card' | 'cash';
  /** Goods portion (register items); null for a shipping-only transaction. */
  sale: SaleRecord | null;
  /** Shipping packages on this transaction. */
  packages: CombinedPackageLine[];
  cashTenderedUSD?: number;
  changeDueUSD?: number;
}

/**
 * One unified receipt for a combined register + shipping sale: retail items
 * (with tax) and shipping packages (with tracking) under a single grand total.
 * Thermal-sized (~80mm) and inline-styled, so it prints and emails identically.
 */
export function buildCombinedReceiptHtml(data: CombinedReceiptData): string {
  const { sale, packages } = data;
  const date = new Date(data.timestamp);
  const dateStr = date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

  const goodsTotal = sale?.totalUSD ?? 0;
  const shippingTotal = packages.reduce((s, p) => s + p.amountUSD, 0);
  const grandTotal = Math.round((goodsTotal + shippingTotal) * 100) / 100;

  // ── Goods section (only when there are retail items) ───────────────────────
  let goodsBlock = '';
  if (sale && sale.items.length > 0) {
    const itemRows = sale.items
      .map((it) => {
        const qtyName =
          it.quantity > 1
            ? `${esc(it.name)} <span style="color:#888;">× ${it.quantity}</span>`
            : esc(it.name);
        return `<tr>
          <td style="padding:3px 0;vertical-align:top;">${qtyName}</td>
          <td style="padding:3px 0;text-align:right;vertical-align:top;white-space:nowrap;">${money(it.lineTotalUSD)}</td>
        </tr>`;
      })
      .join('');
    const taxRow =
      sale.taxUSD > 0
        ? `<tr><td style="padding:2px 0;color:#555;">Tax</td><td style="padding:2px 0;text-align:right;">${money(sale.taxUSD)}</td></tr>`
        : '';
    goodsBlock = `<div style="font-size:11px;color:#666;text-transform:uppercase;letter-spacing:0.06em;margin-top:4px;">Items</div>
    <table style="width:100%;border-collapse:collapse;font-size:13px;">${itemRows}</table>
    <table style="width:100%;border-collapse:collapse;font-size:12px;color:#555;margin-top:4px;">
      <tr><td style="padding:2px 0;">Subtotal</td><td style="padding:2px 0;text-align:right;">${money(sale.subtotalUSD)}</td></tr>
      ${taxRow}
    </table>`;
  }

  // ── Shipping section ───────────────────────────────────────────────────────
  let shippingBlock = '';
  if (packages.length > 0) {
    const pkgRows = packages
      .map((p) => {
        const carrierLabel = CARRIER_LABELS[p.carrier as CarrierKey] ?? p.carrier.toUpperCase();
        const tracking = p.trackingNumber && p.trackingNumber !== 'PENDING'
          ? `<div style="font-size:11px;color:#888;word-break:break-all;">${esc(p.trackingNumber)}</div>`
          : `<div style="font-size:11px;color:#b45309;">Label pending</div>`;
        return `<tr>
          <td style="padding:3px 0;vertical-align:top;">${esc(carrierLabel)} — ${esc(p.serviceName)}${tracking}</td>
          <td style="padding:3px 0;text-align:right;vertical-align:top;white-space:nowrap;">${money(p.amountUSD)}</td>
        </tr>`;
      })
      .join('');
    shippingBlock = `<div style="font-size:11px;color:#666;text-transform:uppercase;letter-spacing:0.06em;margin-top:10px;">Shipping</div>
    <table style="width:100%;border-collapse:collapse;font-size:13px;">${pkgRows}</table>`;
  }

  const paymentLabel = data.paymentMethod === 'cash' ? 'Cash' : 'Card';
  const cashRows =
    data.paymentMethod === 'cash' && data.cashTenderedUSD != null
      ? `<tr><td style="padding:2px 0;color:#555;">Tendered</td><td style="padding:2px 0;text-align:right;">${money(data.cashTenderedUSD)}</td></tr>
         <tr><td style="padding:2px 0;color:#555;">Change</td><td style="padding:2px 0;text-align:right;">${money(data.changeDueUSD ?? 0)}</td></tr>`
      : '';

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Receipt</title>
<style>
  @media print { @page { margin: 6mm; } body { margin: 0; } .no-print { display: none !important; } }
</style>
</head>
<body style="font-family:'Courier New',ui-monospace,monospace;color:#111;margin:0;padding:12px;">
  <div style="max-width:300px;margin:0 auto;">
    <div style="text-align:center;border-bottom:1px dashed #aaa;padding-bottom:10px;margin-bottom:10px;">
      <div style="font-size:17px;font-weight:bold;">${SHOP_NAME}</div>
      <div style="font-size:11px;color:#666;margin-top:2px;">Sales Receipt</div>
      <div style="font-size:11px;color:#666;">${dateStr}</div>
    </div>

    ${goodsBlock}
    ${shippingBlock}

    <table style="width:100%;border-collapse:collapse;font-size:13px;border-top:1px dashed #aaa;margin-top:10px;padding-top:6px;">
      <tr style="border-top:1px solid #111;">
        <td style="padding:6px 0 0;font-weight:bold;font-size:15px;">Total</td>
        <td style="padding:6px 0 0;text-align:right;font-weight:bold;font-size:15px;">${money(grandTotal)}</td>
      </tr>
      <tr><td style="padding:6px 0 2px;color:#555;">Paid</td><td style="padding:6px 0 2px;text-align:right;">${paymentLabel}</td></tr>
      ${cashRows}
    </table>

    <div style="text-align:center;border-top:1px dashed #aaa;margin-top:12px;padding-top:10px;font-size:11px;color:#666;">
      Thank you for your business!
    </div>
  </div>
</body>
</html>`;
}

/**
 * Builds a customer shipping receipt from a stored shipment log entry. Used for
 * both the email sent at purchase time and later reprint/resend from the Sales
 * report, so the two always match. Relies only on inline styles (no external CSS).
 */
export function buildShipmentReceiptHtml(entry: ShipmentLogEntry): string {
  const carrierLabel = CARRIER_LABELS[entry.carrier] ?? entry.carrier.toUpperCase();
  const insRow =
    entry.insuranceUSD > 0
      ? `<tr><td style="padding:4px 0;color:#666;">Insurance</td><td style="padding:4px 0;text-align:right;">${money(entry.insuranceUSD)}</td></tr>`
      : '';
  const packRow =
    (entry.packingFeeUSD ?? 0) > 0
      ? `<tr><td style="padding:4px 0;color:#666;">Packing fee</td><td style="padding:4px 0;text-align:right;">${money(entry.packingFeeUSD ?? 0)}</td></tr>`
      : '';
  const toLine = entry.destCity ? `${esc(entry.destCity)}, ${esc(entry.destState)} ${esc(entry.destZip)}` : esc(entry.destZip);

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Shipping Receipt</title></head>
<body style="font-family:Arial,sans-serif;background:#f5f0e8;margin:0;padding:24px;">
  <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
    <div style="background:#1a2744;padding:24px 32px;">
      <h1 style="color:#fff;margin:0;font-size:20px;">${SHOP_NAME}</h1>
      <p style="color:rgba(255,255,255,0.6);margin:4px 0 0;font-size:13px;">Shipping Receipt</p>
    </div>
    <div style="padding:24px 32px;">
      <p style="color:#1a2744;font-size:15px;">Hi ${esc(entry.customerName) || 'there'},</p>
      <p style="color:#555;font-size:14px;line-height:1.6;">
        Your shipment has been processed and is on its way. Here are your details:
      </p>

      <div style="background:#f5f0e8;border-radius:8px;padding:16px;margin:16px 0;">
        <p style="margin:0 0 4px;font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:#999;">Tracking Number</p>
        <p style="margin:0;font-size:22px;font-weight:bold;letter-spacing:0.12em;color:#1a2744;">${esc(entry.trackingNumber ?? '—')}</p>
      </div>

      <table style="width:100%;border-collapse:collapse;font-size:14px;margin:16px 0;">
        <tr><td style="padding:4px 0;color:#666;">Carrier</td><td style="padding:4px 0;text-align:right;font-weight:600;color:#1a2744;">${esc(carrierLabel)}</td></tr>
        <tr><td style="padding:4px 0;color:#666;">Service</td><td style="padding:4px 0;text-align:right;color:#1a2744;">${esc(entry.serviceName)}</td></tr>
        <tr><td style="padding:4px 0;color:#666;">From</td><td style="padding:4px 0;text-align:right;color:#1a2744;">${esc(entry.originZip)}</td></tr>
        <tr><td style="padding:4px 0;color:#666;">To</td><td style="padding:4px 0;text-align:right;color:#1a2744;">${toLine}</td></tr>
        <tr><td style="padding:4px 0;color:#666;">Weight</td><td style="padding:4px 0;text-align:right;color:#1a2744;">${entry.weightLbs} lbs</td></tr>
        <tr style="border-top:1px solid #eee;"><td style="padding:8px 0 4px;color:#666;">Shipping</td><td style="padding:8px 0 4px;text-align:right;">${money(entry.shippingUSD)}</td></tr>
        ${insRow}
        ${packRow}
        <tr style="border-top:2px solid #1a2744;"><td style="padding:8px 0 0;font-weight:bold;color:#1a2744;">Total Charged</td><td style="padding:8px 0 0;text-align:right;font-weight:bold;font-size:18px;color:#1a2744;">${money(entry.totalUSD)}</td></tr>
      </table>

      <p style="color:#888;font-size:12px;margin-top:24px;">
        Questions? Contact us at Storm Lake Pack &amp; Ship.<br>
        Thank you for your business!
      </p>
    </div>
  </div>
</body>
</html>`;
}

/**
 * Receipt for a scanned drop-off package — confirms the tracking number,
 * carrier, and date, and links the customer to the carrier's tracking page.
 * Used for both the printed copy and the emailed copy.
 */
export function buildDropoffReceiptHtml(input: DropoffRecord | DropoffRecord[]): string {
  const records = Array.isArray(input) ? input : [input];
  const first = records[0];
  const date = new Date(first.timestamp);
  const dateStr = date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

  // One block per package: carrier, tracking number, and a per-package track link.
  const packageBlocks = records
    .map((record) => {
      const carrierLabel = DROPOFF_CARRIER_LABELS[record.carrier] ?? record.carrier;
      const url = trackingUrl(record.carrier, record.trackingNumber);
      const trackBlock = url
        ? `<div style="text-align:center;margin:14px 0;">
         <a href="${url}" style="display:inline-block;background:#1a2744;color:#fff;text-decoration:none;font-family:Arial,sans-serif;font-size:13px;font-weight:bold;padding:10px 18px;border-radius:6px;">Track at ${carrierLabel} →</a>
         <div style="margin-top:6px;font-family:Arial,sans-serif;font-size:10px;color:#888;word-break:break-all;">${url}</div>
       </div>`
        : `<div style="text-align:center;margin:14px 0;font-family:Arial,sans-serif;font-size:11px;color:#888;">Track with ${carrierLabel} using your tracking number.</div>`;

      return `<div style="border-bottom:1px dashed #ddd;padding-bottom:10px;margin-bottom:10px;">
    <div style="font-size:11px;color:#666;text-transform:uppercase;letter-spacing:0.06em;">Carrier</div>
    <div style="font-size:15px;font-weight:bold;margin-bottom:8px;">${esc(carrierLabel)}</div>

    <div style="font-size:11px;color:#666;text-transform:uppercase;letter-spacing:0.06em;">Tracking Number</div>
    <div style="font-size:15px;font-weight:bold;letter-spacing:0.04em;word-break:break-all;">${esc(record.trackingNumber)}</div>

    ${trackBlock}
  </div>`;
    })
    .join('');

  const count = records.length;
  const subtitle = count > 1 ? `Drop-off Receipt · ${count} packages` : 'Drop-off Receipt';
  const closing =
    count > 1
      ? `These ${count} packages were accepted for drop-off.<br>Thank you!`
      : 'This package was accepted for drop-off.<br>Thank you!';

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Drop-off Receipt</title>
<style>
  @media print { @page { margin: 6mm; } body { margin: 0; } .no-print { display: none !important; } }
</style>
</head>
<body style="font-family:'Courier New',ui-monospace,monospace;color:#111;margin:0;padding:12px;">
  <div style="max-width:320px;margin:0 auto;">
    <div style="text-align:center;border-bottom:1px dashed #aaa;padding-bottom:10px;margin-bottom:10px;">
      <div style="font-size:17px;font-weight:bold;">${SHOP_NAME}</div>
      <div style="font-size:11px;color:#666;margin-top:2px;">${subtitle}</div>
      <div style="font-size:11px;color:#666;">${dateStr}</div>
    </div>

    ${first.customerName ? `<div style="font-size:12px;margin-bottom:8px;">Customer: ${esc(first.customerName)}</div>` : ''}

    ${packageBlocks}

    <div style="text-align:center;border-top:1px dashed #aaa;margin-top:12px;padding-top:10px;font-size:11px;color:#666;">
      ${closing}
    </div>
  </div>
</body>
</html>`;
}

const DROPOFF_PERIOD_LABELS: Record<DropoffPeriod, string> = {
  today: 'Today',
  mtd: 'Month to Date',
  ytd: 'Year to Date',
};

/** Printable / emailable drop-off report for a period (today / MTD / YTD). */
export function buildDropoffReportHtml(
  records: DropoffRecord[],
  period: DropoffPeriod,
  byCarrier: Record<string, number>
): string {
  const periodLabel = DROPOFF_PERIOD_LABELS[period] ?? period;
  const generated = new Date().toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

  const carrierChips = Object.entries(byCarrier)
    .map(
      ([c, n]) =>
        `<span style="display:inline-block;border:1px solid #ddd;border-radius:6px;padding:4px 10px;margin:2px;font-size:12px;color:#1a2744;"><strong>${
          DROPOFF_CARRIER_LABELS[c as keyof typeof DROPOFF_CARRIER_LABELS] ?? c
        }</strong>: ${n}</span>`
    )
    .join('');

  const rows = records
    .map((r) => {
      const dt = new Date(r.timestamp);
      return `<tr>
        <td style="padding:6px 8px;border-bottom:1px solid #eee;white-space:nowrap;">${dt.toLocaleDateString()} ${dt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #eee;">${esc(DROPOFF_CARRIER_LABELS[r.carrier] ?? r.carrier)}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #eee;font-family:monospace;">${esc(r.trackingNumber)}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #eee;">${esc(r.customerName)}</td>
      </tr>`;
    })
    .join('');

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Drop-off Report — ${periodLabel}</title>
<style>@media print { @page { margin: 12mm; } }</style>
</head>
<body style="font-family:Arial,sans-serif;color:#1a2744;margin:0;padding:24px;">
  <div style="max-width:720px;margin:0 auto;">
    <h1 style="margin:0;font-size:20px;">${SHOP_NAME}</h1>
    <p style="margin:2px 0 0;color:#666;font-size:13px;">Drop-off Report — ${periodLabel}</p>
    <p style="margin:2px 0 16px;color:#999;font-size:12px;">Generated ${generated}</p>

    <div style="background:#f5f0e8;border-radius:8px;padding:14px 16px;margin-bottom:16px;">
      <div style="font-size:13px;color:#666;">Total packages</div>
      <div style="font-size:28px;font-weight:bold;">${records.length}</div>
      <div style="margin-top:8px;">${carrierChips}</div>
    </div>

    <table style="width:100%;border-collapse:collapse;font-size:13px;">
      <thead>
        <tr style="text-align:left;background:#1a2744;color:#fff;">
          <th style="padding:8px;">Date/Time</th>
          <th style="padding:8px;">Carrier</th>
          <th style="padding:8px;">Tracking Number</th>
          <th style="padding:8px;">Customer</th>
        </tr>
      </thead>
      <tbody>
        ${rows || `<tr><td colspan="4" style="padding:16px;text-align:center;color:#999;">No drop-offs for this period.</td></tr>`}
      </tbody>
    </table>
  </div>
</body>
</html>`;
}
