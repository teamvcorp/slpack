/**
 * Client-side bridge to the Epson TM-T20IV-SP receipt printer.
 *
 * The app is served over HTTPS from the cloud, so the server can't reach the
 * shop's LAN printer — printing happens here, in the admin browser, via the
 * Epson ePOS SDK for JavaScript (loaded as a global `window.epson` script in the
 * admin layout). Because the page is HTTPS, we connect over the printer's SSL
 * endpoint (default port 8043, `crypto: true`); the printer's self-signed cert
 * must be trusted once per browser (visit https://<printer-ip> and accept).
 *
 * `printReceipt` is the workhorse: it tries the Epson and, on any problem
 * (disabled, unreachable, cert not trusted, SDK not loaded), silently falls back
 * to the existing browser-print helper so the counter is never blocked.
 */
import { printHtml } from './printHtml';
import type { EposPrinter } from '@/lib/eposReceipt';
import { renderTest } from '@/lib/eposReceipt';

interface PrinterSettings {
  ip: string;
  port: number;
  enabled: boolean;
}

const CONNECT_TIMEOUT_MS = 8000;
const PRINT_TIMEOUT_MS = 10000;
const SETTINGS_TTL_MS = 60_000;

let settingsCache: PrinterSettings | null = null;
let settingsFetchedAt = 0;

// A live device is cached per address so repeated prints reuse one connection.
let connection: { key: string; printer: EposPrinter } | null = null;

/** Force the next getSettings() to re-fetch (call after saving settings). */
export function refreshSettings(): void {
  settingsCache = null;
  settingsFetchedAt = 0;
}

async function getSettings(): Promise<PrinterSettings> {
  if (settingsCache && Date.now() - settingsFetchedAt < SETTINGS_TTL_MS) return settingsCache;
  try {
    const res = await fetch('/api/admin/settings/printer', { cache: 'no-store' });
    if (res.ok) {
      const d = await res.json();
      settingsCache = {
        ip: String(d.ip ?? ''),
        port: Number(d.port) || 8043,
        enabled: Boolean(d.enabled),
      };
      settingsFetchedAt = Date.now();
      return settingsCache;
    }
  } catch {
    /* fall through to disabled default */
  }
  return { ip: '', port: 8043, enabled: false };
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function getSdk(): any {
  const sdk = (window as any).epson;
  if (!sdk || !sdk.ePOSDevice) throw new Error('Epson ePOS SDK not loaded');
  return sdk;
}

function connect(ip: string, port: number): Promise<EposPrinter> {
  const key = `${ip}:${port}`;
  if (connection && connection.key === key) return Promise.resolve(connection.printer);

  // Encrypt over the SSL port (8043) — required from an HTTPS page. On port 8008
  // (e.g. the app served from http://localhost) use a plain connection instead.
  const useSsl = port === 8043;

  return new Promise<EposPrinter>((resolve, reject) => {
    const sdk = getSdk();
    const device = new sdk.ePOSDevice();
    const timer = setTimeout(() => reject(new Error('Printer connection timed out')), CONNECT_TIMEOUT_MS);

    device.connect(ip, port, (result: string) => {
      // 'OK' for plain, 'SSL_CONNECT_OK' when connecting over the SSL port.
      if (result !== 'OK' && result !== 'SSL_CONNECT_OK') {
        clearTimeout(timer);
        reject(new Error(`Printer connection failed (${result})`));
        return;
      }
      device.createDevice(
        'local_printer',
        device.DEVICE_TYPE_PRINTER,
        { crypto: useSsl, buffer: false },
        (printer: any, code: string) => {
          clearTimeout(timer);
          if (code !== 'OK' || !printer) {
            reject(new Error(`Could not open printer (${code})`));
            return;
          }
          connection = { key, printer: printer as EposPrinter };
          resolve(printer as EposPrinter);
        }
      );
    });
  });
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Run a render function against a connected printer and await the print result. */
function runJob(printer: EposPrinter, render: (p: EposPrinter) => void): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      printer.onreceive = undefined;
      reject(new Error('Print timed out'));
    }, PRINT_TIMEOUT_MS);

    printer.onreceive = (res) => {
      clearTimeout(timer);
      printer.onreceive = undefined;
      if (res && res.success) resolve();
      else reject(new Error(`Print failed (${res?.code ?? 'unknown'})`));
    };

    try {
      render(printer);
      printer.send();
    } catch (err) {
      clearTimeout(timer);
      printer.onreceive = undefined;
      reject(err instanceof Error ? err : new Error('Print error'));
    }
  });
}

/**
 * Print a receipt to the Epson if it's configured and reachable; otherwise fall
 * back to the browser print dialog. Fire-and-forget — never throws to the caller.
 */
export async function printReceipt(
  render: (p: EposPrinter) => void,
  fallbackHtml: string
): Promise<void> {
  let settings: PrinterSettings;
  try {
    settings = await getSettings();
  } catch {
    settings = { ip: '', port: 8043, enabled: false };
  }

  if (!settings.enabled || !settings.ip) {
    printHtml(fallbackHtml);
    return;
  }

  try {
    const printer = await connect(settings.ip, settings.port);
    await runJob(printer, render);
  } catch (err) {
    // Drop the (possibly stale) connection and fall back so nothing is lost.
    connection = null;
    console.warn('[receiptPrinter] falling back to browser print:', err);
    printHtml(fallbackHtml);
  }
}

/**
 * Connect to a specific address and print a sample receipt. Used by the Settings
 * page — unlike printReceipt it ignores the enabled flag and rethrows errors so
 * the UI can show exactly what went wrong during setup.
 */
export async function testPrint(ip: string, port: number): Promise<void> {
  connection = null; // always use the address being tested
  const printer = await connect(ip, port);
  await runJob(printer, renderTest);
}
