import type { SaleRecord } from '@/app/admin/types/register';
import type { DropoffRecord, DropoffPeriod } from '@/app/admin/types/dropoff';
import { DROPOFF_CARRIER_LABELS, trackingUrl } from '@/lib/dropoff';

const SHOP_NAME = 'Storm Lake Pack & Ship';

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

/**
 * Receipt for a scanned drop-off package — confirms the tracking number,
 * carrier, and date, and links the customer to the carrier's tracking page.
 * Used for both the printed copy and the emailed copy.
 */
export function buildDropoffReceiptHtml(record: DropoffRecord): string {
  const date = new Date(record.timestamp);
  const dateStr = date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
  const carrierLabel = DROPOFF_CARRIER_LABELS[record.carrier] ?? record.carrier;
  const url = trackingUrl(record.carrier, record.trackingNumber);
  const trackBlock = url
    ? `<div style="text-align:center;margin:14px 0;">
         <a href="${url}" style="display:inline-block;background:#1a2744;color:#fff;text-decoration:none;font-family:Arial,sans-serif;font-size:13px;font-weight:bold;padding:10px 18px;border-radius:6px;">Track at ${carrierLabel} →</a>
         <div style="margin-top:6px;font-family:Arial,sans-serif;font-size:10px;color:#888;word-break:break-all;">${url}</div>
       </div>`
    : `<div style="text-align:center;margin:14px 0;font-family:Arial,sans-serif;font-size:11px;color:#888;">Track with ${carrierLabel} using your tracking number.</div>`;

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
      <div style="font-size:11px;color:#666;margin-top:2px;">Drop-off Receipt</div>
      <div style="font-size:11px;color:#666;">${dateStr}</div>
    </div>

    ${record.customerName ? `<div style="font-size:12px;margin-bottom:8px;">Customer: ${esc(record.customerName)}</div>` : ''}

    <div style="font-size:11px;color:#666;text-transform:uppercase;letter-spacing:0.06em;">Carrier</div>
    <div style="font-size:15px;font-weight:bold;margin-bottom:8px;">${esc(carrierLabel)}</div>

    <div style="font-size:11px;color:#666;text-transform:uppercase;letter-spacing:0.06em;">Tracking Number</div>
    <div style="font-size:15px;font-weight:bold;letter-spacing:0.04em;word-break:break-all;">${esc(record.trackingNumber)}</div>

    ${trackBlock}

    <div style="text-align:center;border-top:1px dashed #aaa;margin-top:12px;padding-top:10px;font-size:11px;color:#666;">
      This package was accepted for drop-off.<br>Thank you!
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
