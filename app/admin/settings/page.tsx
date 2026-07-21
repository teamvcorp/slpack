"use client";

import { useEffect, useState } from 'react';
import { testPrint, refreshSettings } from '../components/receiptPrinter';

/**
 * Receipt-printer settings (Epson TM-T20IV-SP). Stores the printer's LAN address
 * so receipts route to it without a redeploy. See app/admin/components/receiptPrinter.ts.
 */
export default function SettingsPage() {
  const [ip, setIp] = useState('');
  const [port, setPort] = useState('8043');
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/admin/settings/printer', { cache: 'no-store' });
        if (res.ok) {
          const d = await res.json();
          setIp(d.ip ?? '');
          setPort(String(d.port ?? 8043));
          setEnabled(Boolean(d.enabled));
        }
      } catch {
        /* leave defaults */
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function handleSave() {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch('/api/admin/settings/printer', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ip: ip.trim(), port: Number(port), enabled }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Server error ${res.status}`);
      setIp(data.ip);
      setPort(String(data.port));
      setEnabled(data.enabled);
      refreshSettings();
      setMessage({ kind: 'ok', text: 'Settings saved.' });
    } catch (err) {
      setMessage({ kind: 'err', text: err instanceof Error ? err.message : 'Failed to save.' });
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    if (!ip.trim()) {
      setMessage({ kind: 'err', text: 'Enter the printer IP first.' });
      return;
    }
    setTesting(true);
    setMessage(null);
    try {
      await testPrint(ip.trim(), Number(port) || 8043);
      setMessage({ kind: 'ok', text: 'Test receipt sent — check the printer.' });
    } catch (err) {
      setMessage({
        kind: 'err',
        text: `${err instanceof Error ? err.message : 'Test print failed.'} — confirm the printer IP, that ePOS/SSL is enabled, and that this browser has trusted the printer's certificate (visit https://${ip.trim()} once).`,
      });
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="py-6">
      <h1 className="text-2xl font-bold text-navy">Settings</h1>
      <p className="mt-1 text-sm text-navy/50">
        Configure the receipt printer used for drop-off, sales, and card payment receipts. Labels are
        unaffected.
      </p>

      <div className="mt-6 max-w-lg rounded-2xl border border-navy/10 bg-white p-6 shadow-sm">
        <h2 className="text-base font-semibold text-navy">Receipt printer</h2>
        <p className="mt-0.5 text-xs text-navy/50">Epson TM-T20IV-SP (80mm, Ethernet)</p>

        {loading ? (
          <p className="mt-4 text-sm text-navy/40">Loading…</p>
        ) : (
          <div className="mt-4 space-y-4">
            <div>
              <label htmlFor="printerIp" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-navy/50">
                Printer IP address
              </label>
              <input
                id="printerIp"
                type="text"
                inputMode="decimal"
                placeholder="192.168.1.50"
                value={ip}
                onChange={(e) => setIp(e.target.value)}
                className="w-full rounded-lg border border-navy/20 bg-white px-3 py-2 font-mono text-sm text-navy focus:border-blue focus:outline-none focus:ring-1 focus:ring-blue"
              />
              <p className="mt-1 text-[11px] text-navy/40">
                Use a static/reserved IP so it doesn&apos;t change. Find it on the printer&apos;s status sheet.
              </p>
            </div>

            <div className="w-32">
              <label htmlFor="printerPort" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-navy/50">
                Port
              </label>
              <input
                id="printerPort"
                type="number"
                value={port}
                onChange={(e) => setPort(e.target.value)}
                className="w-full rounded-lg border border-navy/20 bg-white px-3 py-2 font-mono text-sm text-navy focus:border-blue focus:outline-none focus:ring-1 focus:ring-blue"
              />
              <p className="mt-1 text-[11px] text-navy/40">8043 (SSL)</p>
            </div>

            <label className="flex items-center gap-2 text-sm text-navy/80">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
                className="h-4 w-4 rounded border-navy/30 text-blue focus:ring-blue"
              />
              Print receipts to this printer
              <span className="text-[11px] text-navy/40">(off = use the browser print dialog)</span>
            </label>

            {message && (
              <p
                className={`rounded-lg px-3 py-2 text-sm ${
                  message.kind === 'ok' ? 'bg-green-50 text-green-700' : 'bg-red/10 text-red'
                }`}
              >
                {message.text}
              </p>
            )}

            <div className="flex gap-3 pt-1">
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="rounded-lg bg-blue px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-navy disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
              <button
                type="button"
                onClick={handleTest}
                disabled={testing}
                className="rounded-lg border border-navy/20 px-4 py-2.5 text-sm font-medium text-navy/70 transition-colors hover:bg-cream disabled:opacity-50"
              >
                {testing ? 'Testing…' : '🖨 Test print'}
              </button>
            </div>
          </div>
        )}

        <div className="mt-6 rounded-xl bg-navy/5 px-4 py-3 text-[11px] leading-relaxed text-navy/50">
          <p className="font-semibold text-navy/60">One-time setup</p>
          <ol className="mt-1 list-decimal space-y-0.5 pl-4">
            <li>Give the printer a static/reserved LAN IP and enable ePOS-Print + SSL on it.</li>
            <li>On each shop browser, visit <span className="font-mono">https://&lt;printer-ip&gt;</span> once and trust the certificate.</li>
            <li>Enter the IP above, keep port 8043, enable, and click Test print.</li>
          </ol>
        </div>
      </div>
    </div>
  );
}
