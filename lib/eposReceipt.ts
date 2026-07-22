/**
 * ESC/POS receipt renderers for the Epson TM-T20IV-SP thermal printer, driven
 * through the Epson ePOS SDK for JavaScript. These mirror the HTML builders in
 * `lib/receipt.ts` (which are still used for emailed copies and as the browser
 * print fallback), but emit native printer commands so receipts print silently
 * at the correct 80mm width with an auto-cut — no browser print dialog.
 *
 * Each renderer receives the SDK `printer` device object and issues add* calls;
 * the caller (see `app/admin/components/receiptPrinter.ts`) invokes `send()`.
 *
 * Cash drawer: the drawer pulse is emitted ONLY when the caller requests it AND
 * the payment was cash (`openDrawer && paymentMethod === 'cash'`). Reprints pass
 * `openDrawer: false` so re-printing a receipt never re-opens the drawer.
 */
import type { SaleRecord } from '@/app/admin/types/register';
import type { DropoffRecord } from '@/app/admin/types/dropoff';
import type { CombinedReceiptData } from '@/lib/receipt';
import { DROPOFF_CARRIER_LABELS, trackingUrl } from '@/lib/dropoff';
import { SITE } from '@/lib/siteConfig';

/**
 * Minimal typing of the Epson ePOS SDK printer device object. The SDK is loaded
 * as a global script (`window.epson`) and is untyped; we declare only what the
 * renderers use. Alignment/cut/drawer constants live on the device instance.
 */
export interface EposPrinter {
  addText(data: string): void;
  addTextAlign(align: number): void;
  addTextStyle(reverse: boolean, underline: boolean, emphasis: boolean, color?: number): void;
  addTextSize(width: number, height: number): void;
  addFeedLine(line: number): void;
  addCut(type: number): void;
  addPulse(drawer: number, time: number): void;
  addSymbol(data: string, type: number, level: number, width: number, height: number, size: number): void;
  send(): void;
  onreceive: ((res: { success: boolean; code?: string }) => void) | undefined;
  readonly ALIGN_LEFT: number;
  readonly ALIGN_CENTER: number;
  readonly ALIGN_RIGHT: number;
  readonly CUT_FEED: number;
  readonly DRAWER_1: number;
  readonly PULSE_100: number;
  readonly COLOR_1: number;
  readonly SYMBOL_QRCODE_MODEL_2: number;
  readonly LEVEL_M: number;
}

/** Printed on every receipt. Plain text (not HTML-escaped like the email copy). */
const SHOP_NAME = 'Storm Lake Pack & Ship';
const SHOP_SLOGAN = 'Shipping made easy';
// Commas (not a middot) so it renders on any ESC/POS code page.
const SHOP_ADDRESS = `${SITE.address.street}, ${SITE.address.city}, ${SITE.address.region} ${SITE.address.postalCode}`;

// Promo QR printed at the bottom of every customer receipt (paper only).
const PROMO_QR_URL = 'https://taekwondostormlake.com/promo';
const PROMO_QR_CAPTION = 'Support our current project';

/**
 * Characters per line. 80mm Font A is up to 48 columns; we use 42 so lines never
 * wrap on any 80mm TM printer — right-aligned amounts sit a few chars in from the
 * edge (reads as a small margin). Bump toward 48 if a wider layout is preferred.
 */
const COLS = 42;

const CARRIER_LABELS: Record<string, string> = {
  fedex: 'FedEx',
  ups: 'UPS',
  usps: 'USPS',
  dhl: 'DHL Express',
};

interface RenderOptions {
  /** Kick the cash drawer — only honored for cash payments. */
  openDrawer?: boolean;
}

function money(n: number): string {
  return `$${n.toFixed(2)}`;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Strip control characters so raw text can't corrupt the ESC/POS stream. */
function clean(value: unknown): string {
  // eslint-disable-next-line no-control-regex
  return String(value ?? '').replace(/[\x00-\x1f\x7f]/g, ' ').trim();
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function bold(p: EposPrinter, on: boolean): void {
  p.addTextStyle(false, false, on, p.COLOR_1);
}

function divider(p: EposPrinter): void {
  p.addTextAlign(p.ALIGN_LEFT);
  p.addText('-'.repeat(COLS) + '\n');
}

/**
 * Print a label on the left and a value flush-right on the same line. If the two
 * don't fit, the label prints on its own line and the value is right-aligned below.
 */
function twoCol(p: EposPrinter, left: string, right: string): void {
  p.addTextAlign(p.ALIGN_LEFT);
  const l = clean(left);
  const r = clean(right);
  if (l.length + r.length + 1 > COLS) {
    p.addText(l + '\n');
    p.addText(' '.repeat(Math.max(0, COLS - r.length)) + r + '\n');
  } else {
    p.addText(l + ' '.repeat(COLS - l.length - r.length) + r + '\n');
  }
}

function header(p: EposPrinter, subtitle: string, iso: string, brand = false): void {
  p.addTextAlign(p.ALIGN_CENTER);
  if (brand) p.addTextSize(1, 2); // double-height shop name (width unchanged so it won't wrap)
  bold(p, true);
  p.addText(SHOP_NAME + '\n');
  bold(p, false);
  if (brand) p.addTextSize(1, 1);
  if (brand) {
    p.addText(SHOP_SLOGAN + '\n');
    p.addText(SHOP_ADDRESS + '\n');
  }
  p.addText(subtitle + '\n');
  p.addText(fmtDate(iso) + '\n');
  divider(p);
}

function sectionTitle(p: EposPrinter, title: string): void {
  p.addTextAlign(p.ALIGN_LEFT);
  p.addText(title + '\n');
}

function footer(p: EposPrinter): void {
  divider(p);
  p.addTextAlign(p.ALIGN_CENTER);
  p.addText('Thank you for your business!\n');
}

/** Promo QR at the very bottom of the receipt (native QR, no image needed). */
function promoQr(p: EposPrinter): void {
  p.addFeedLine(1);
  divider(p);
  p.addTextAlign(p.ALIGN_CENTER);
  p.addText(PROMO_QR_CAPTION + '\n');
  // width 5 = module (dot) size; LEVEL_M = medium error correction; height/size unused for QR.
  p.addSymbol(PROMO_QR_URL, p.SYMBOL_QRCODE_MODEL_2, p.LEVEL_M, 5, 5, 0);
  p.addText(PROMO_QR_URL + '\n'); // scan-free fallback
}

/** Feed, optionally open the cash drawer, then cut. Always the last call. */
function finish(p: EposPrinter, openDrawer: boolean): void {
  p.addTextAlign(p.ALIGN_LEFT);
  p.addFeedLine(1);
  if (openDrawer) p.addPulse(p.DRAWER_1, p.PULSE_100);
  p.addCut(p.CUT_FEED);
}

function taxLabel(rate: number): string {
  if (rate > 0) {
    const pct = rate * 100;
    return `Tax (${pct.toFixed(pct % 1 === 0 ? 0 : 2)}%)`;
  }
  return 'Tax';
}

/** Register / POS sales receipt (mirrors buildSaleReceiptHtml). */
export function renderSale(p: EposPrinter, sale: SaleRecord, opts: RenderOptions = {}): void {
  p.addFeedLine(1); // a little white space at the top
  header(p, 'Sales Receipt', sale.timestamp, true);

  p.addTextAlign(p.ALIGN_LEFT);
  for (const it of sale.items) {
    const name = it.quantity > 1 ? `${clean(it.name)} x${it.quantity}` : clean(it.name);
    twoCol(p, name, money(it.lineTotalUSD));
    if (it.quantity > 1) p.addText(`  ${money(it.unitAmountUSD)} ea\n`);
  }

  divider(p);
  twoCol(p, 'Subtotal', money(sale.subtotalUSD));
  if (sale.taxUSD > 0 || sale.taxRate > 0) twoCol(p, taxLabel(sale.taxRate), money(sale.taxUSD));

  const cardFee = sale.cardFeeUSD ?? 0;
  if (cardFee > 0) twoCol(p, 'Card processing fee', money(cardFee));

  divider(p);
  bold(p, true);
  twoCol(p, 'TOTAL', money(round2(sale.totalUSD + cardFee)));
  bold(p, false);
  twoCol(p, 'Paid', sale.paymentMethod === 'cash' ? 'Cash' : 'Card');
  if (sale.paymentMethod === 'cash' && sale.cashTenderedUSD != null) {
    twoCol(p, 'Tendered', money(sale.cashTenderedUSD));
    twoCol(p, 'Change', money(sale.changeDueUSD ?? 0));
  }

  footer(p);
  promoQr(p);
  finish(p, !!opts.openDrawer && sale.paymentMethod === 'cash');
}

/**
 * Combined register + shipping receipt (mirrors buildCombinedReceiptHtml). Also
 * serves shipping-only card/cash receipts, where `data.sale` is null.
 */
export function renderCombined(p: EposPrinter, data: CombinedReceiptData, opts: RenderOptions = {}): void {
  p.addFeedLine(1); // a little white space at the top
  header(p, 'Sales Receipt', data.timestamp, true);

  const sale = data.sale;
  if (sale && sale.items.length > 0) {
    sectionTitle(p, 'ITEMS');
    for (const it of sale.items) {
      const name = it.quantity > 1 ? `${clean(it.name)} x${it.quantity}` : clean(it.name);
      twoCol(p, name, money(it.lineTotalUSD));
    }
    twoCol(p, 'Subtotal', money(sale.subtotalUSD));
    if (sale.taxUSD > 0) twoCol(p, 'Tax', money(sale.taxUSD));
  }

  if (data.packages.length > 0) {
    sectionTitle(p, 'SHIPPING');
    for (const pk of data.packages) {
      const label = CARRIER_LABELS[pk.carrier] ?? pk.carrier.toUpperCase();
      twoCol(p, `${label} ${clean(pk.serviceName)}`, money(pk.amountUSD));
      if (pk.trackingNumber && pk.trackingNumber !== 'PENDING') {
        p.addText(`  ${clean(pk.trackingNumber)}\n`);
      } else {
        p.addText('  Label pending\n');
      }
    }
  }

  const goodsTotal = sale?.totalUSD ?? 0;
  const shippingTotal = data.packages.reduce((s, x) => s + x.amountUSD, 0);
  const cardFee = data.cardFeeUSD ?? 0;

  divider(p);
  if (cardFee > 0) twoCol(p, 'Card processing fee', money(cardFee));
  bold(p, true);
  twoCol(p, 'TOTAL', money(round2(goodsTotal + shippingTotal + cardFee)));
  bold(p, false);
  twoCol(p, 'Paid', data.paymentMethod === 'cash' ? 'Cash' : 'Card');
  if (data.paymentMethod === 'cash' && data.cashTenderedUSD != null) {
    twoCol(p, 'Tendered', money(data.cashTenderedUSD));
    twoCol(p, 'Change', money(data.changeDueUSD ?? 0));
  }

  footer(p);
  promoQr(p);
  finish(p, !!opts.openDrawer && data.paymentMethod === 'cash');
}

/** Drop-off receipt for one or many scanned packages (mirrors buildDropoffReceiptHtml). No payment / no drawer. */
export function renderDropoff(p: EposPrinter, input: DropoffRecord | DropoffRecord[]): void {
  const records = Array.isArray(input) ? input : [input];
  const first = records[0];
  const count = records.length;
  const subtitle = count > 1 ? `Drop-off Receipt - ${count} packages` : 'Drop-off Receipt';

  p.addFeedLine(1); // a little white space at the top
  header(p, subtitle, first.timestamp, true);

  p.addTextAlign(p.ALIGN_LEFT);
  if (first.customerName) p.addText(`Customer: ${clean(first.customerName)}\n`);

  for (const r of records) {
    divider(p);
    const label = DROPOFF_CARRIER_LABELS[r.carrier] ?? r.carrier;
    p.addText(`Carrier: ${clean(label)}\n`);
    p.addText('Tracking number:\n');
    bold(p, true);
    p.addText(`${clean(r.trackingNumber)}\n`);
    bold(p, false);
    const url = trackingUrl(r.carrier, r.trackingNumber);
    if (url) p.addText(`Track: ${url}\n`);
  }

  divider(p);
  p.addTextAlign(p.ALIGN_CENTER);
  p.addText(
    count > 1
      ? `These ${count} packages were accepted for drop-off.\nThank you!\n`
      : 'This package was accepted for drop-off.\nThank you!\n'
  );
  promoQr(p);
  finish(p, false);
}

/** Sample receipt for the Settings → Test Print button. */
export function renderTest(p: EposPrinter): void {
  p.addTextAlign(p.ALIGN_CENTER);
  bold(p, true);
  p.addText(SHOP_NAME + '\n');
  bold(p, false);
  p.addText('Receipt Printer Test\n');
  divider(p);
  p.addTextAlign(p.ALIGN_LEFT);
  p.addText('If you can read this, the receipt\nprinter is connected and working.\n');
  footer(p);
  promoQr(p);
  finish(p, false);
}
