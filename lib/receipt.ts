import type { SaleRecord } from '@/app/admin/types/register';

const SHOP_NAME = 'Storm Lake Pack & Ship';

function money(n: number): string {
  return `$${n.toFixed(2)}`;
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
          ? `${it.name} <span style="color:#888;">× ${it.quantity}</span>`
          : it.name;
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
