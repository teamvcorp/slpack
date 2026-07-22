"use client";

import { useEffect, useState } from 'react';
import { testPrint, refreshSettings } from '../components/receiptPrinter';
import { refreshTerminalSettings } from '../components/stripeTerminal';

/**
 * Admin settings — hardware configuration:
 *  - Receipt printer (Epson TM-T20IV-SP): LAN address, see receiptPrinter.ts.
 *  - Card reader (Stripe Terminal S710): pairing + enable, driven server-side.
 */
export default function SettingsPage() {
  return (
    <div className="py-6">
      <h1 className="text-2xl font-bold text-navy">Settings</h1>
      <p className="mt-1 text-sm text-navy/50">
        Configure the receipt printer and card reader used at the counter. Shipping labels are
        unaffected.
      </p>
      <ReceiptPrinterCard />
      <CardReaderCard />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Receipt printer (Epson TM-T20IV-SP)
// ─────────────────────────────────────────────────────────────────────────────
function ReceiptPrinterCard() {
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
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Card reader (Stripe Terminal S700/S710)
// ─────────────────────────────────────────────────────────────────────────────
interface ReaderDiagnostics {
  deviceType: string | null;
  serialNumber: string | null;
  firmware: string | null;
  ipAddress: string | null;
  livemode: boolean | null;
  lastAction: { type: string; status: string; failureCode: string | null; failureMessage: string | null } | null;
}

interface AccountReader {
  id: string;
  label: string;
  status: string;
  deviceType: string | null;
  location: string | null;
  serialNumber: string | null;
}

function CardReaderCard() {
  const [loading, setLoading] = useState(true);
  const [readerId, setReaderId] = useState('');
  const [label, setLabel] = useState('');
  const [readerStatus, setReaderStatus] = useState<string>('');
  const [enabled, setEnabled] = useState(false);
  const [readers, setReaders] = useState<AccountReader[]>([]);
  const [readersError, setReadersError] = useState<string | null>(null);
  const [readersLoading, setReadersLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [diagLoading, setDiagLoading] = useState(false);
  const [diag, setDiag] = useState<ReaderDiagnostics | null>(null);
  const [readerError, setReaderError] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  async function loadReaders() {
    setReadersLoading(true);
    setReadersError(null);
    try {
      const res = await fetch('/api/admin/terminal/readers', { cache: 'no-store' });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error ?? `Server error ${res.status}`);
      setReaders(Array.isArray(d.readers) ? d.readers : []);
    } catch (err) {
      setReadersError(err instanceof Error ? err.message : 'Could not list readers.');
    } finally {
      setReadersLoading(false);
    }
  }

  async function loadStatus() {
    setDiagLoading(true);
    try {
      const res = await fetch('/api/admin/settings/terminal?status=1', { cache: 'no-store' });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        // Never leave the panel silently blank — show why the lookup failed.
        setReaderError(d.error ?? `Diagnostics request failed (status ${res.status}).`);
        return;
      }
      setReaderId(d.readerId ?? '');
      setLabel(d.label ?? '');
      setEnabled(Boolean(d.enabled));
      setReaderStatus(d.readerStatus ?? '');
      // Surface a reader lookup failure (stale id after re-pair, wrong test/live mode, etc.).
      setReaderError(
        d.readerError ?? (d.readerStatus === 'deleted' ? 'This reader was deleted in Stripe.' : null)
      );
      setDiag({
        deviceType: d.deviceType ?? null,
        serialNumber: d.serialNumber ?? null,
        firmware: d.firmware ?? null,
        ipAddress: d.ipAddress ?? null,
        livemode: typeof d.livemode === 'boolean' ? d.livemode : null,
        lastAction: d.lastAction ?? null,
      });
    } catch (err) {
      setReaderError(err instanceof Error ? err.message : 'Could not reach the diagnostics endpoint.');
    } finally {
      setLoading(false);
      setDiagLoading(false);
    }
  }

  async function handleUnpair() {
    if (!window.confirm('Clear the selected reader? You can pick it again anytime.')) return;
    setMessage(null);
    try {
      const res = await fetch('/api/admin/settings/terminal', { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `Server error ${res.status}`);
      setReaderId('');
      setLabel('');
      setEnabled(false);
      setReaderStatus('');
      setDiag(null);
      setReaderError(null);
      refreshTerminalSettings();
      setMessage({ kind: 'ok', text: 'Selection cleared. Pick a reader below.' });
    } catch (err) {
      setMessage({ kind: 'err', text: err instanceof Error ? err.message : 'Failed to clear selection.' });
    }
  }

  // Select (not register) a reader from the shared Stripe account.
  async function handleSelect(id: string, lbl: string) {
    if (!id) return;
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch('/api/admin/settings/terminal', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ readerId: id, label: lbl, enabled: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Server error ${res.status}`);
      setReaderId(data.readerId);
      setLabel(data.label ?? lbl);
      setEnabled(Boolean(data.enabled));
      refreshTerminalSettings();
      setMessage({ kind: 'ok', text: 'Reader selected and enabled.' });
      loadStatus();
    } catch (err) {
      setMessage({ kind: 'err', text: err instanceof Error ? err.message : 'Failed to select reader.' });
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    loadStatus();
    loadReaders();
  }, []);

  async function handleToggle(next: boolean) {
    setEnabled(next);
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch('/api/admin/settings/terminal', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: next }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Server error ${res.status}`);
      setEnabled(data.enabled);
      refreshTerminalSettings();
      setMessage({ kind: 'ok', text: 'Saved.' });
    } catch (err) {
      setEnabled(!next); // revert
      setMessage({ kind: 'err', text: err instanceof Error ? err.message : 'Failed to save.' });
    } finally {
      setSaving(false);
    }
  }

  const statusColor =
    readerStatus === 'online' ? 'text-green-700' : readerStatus === 'offline' ? 'text-amber-700' : 'text-navy/40';

  return (
    <div className="mt-6 max-w-lg rounded-2xl border border-navy/10 bg-white p-6 shadow-sm">
      <h2 className="text-base font-semibold text-navy">Card reader</h2>
      <p className="mt-0.5 text-xs text-navy/50">Stripe Terminal — Reader S700/S710</p>

      {loading ? (
        <p className="mt-4 text-sm text-navy/40">Loading…</p>
      ) : (
        <div className="mt-4 space-y-4">
          {readerId ? (
            <div className="rounded-xl bg-navy/5 px-4 py-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-navy">{label || 'Reader'}</span>
                <span className={`text-xs font-semibold uppercase ${statusColor}`}>
                  {readerStatus || 'unknown'}
                </span>
              </div>
              <p className="mt-0.5 font-mono text-[11px] text-navy/40">{readerId}</p>

              {diag && (
                <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 border-t border-navy/10 pt-3 text-[12px]">
                  <dt className="text-navy/50">Mode</dt>
                  <dd className={`font-medium ${diag.livemode === false ? 'text-amber-700' : 'text-navy'}`}>
                    {diag.livemode === null ? '—' : diag.livemode ? 'Live' : 'Test'}
                  </dd>
                  <dt className="text-navy/50">Device</dt>
                  <dd className="font-medium text-navy">{diag.deviceType ?? '—'}</dd>
                  <dt className="text-navy/50">Firmware</dt>
                  <dd className="font-mono text-navy">{diag.firmware ?? '—'}</dd>
                  <dt className="text-navy/50">Serial</dt>
                  <dd className="font-mono text-navy">{diag.serialNumber ?? '—'}</dd>
                  <dt className="text-navy/50">IP</dt>
                  <dd className="font-mono text-navy">{diag.ipAddress ?? '—'}</dd>
                  {diag.lastAction && (
                    <>
                      <dt className="text-navy/50">Last action</dt>
                      <dd className="font-medium text-navy">
                        {diag.lastAction.type} · {diag.lastAction.status}
                        {diag.lastAction.failureMessage ? (
                          <span className="block text-[11px] text-red">{diag.lastAction.failureMessage}</span>
                        ) : null}
                      </dd>
                    </>
                  )}
                </dl>
              )}

              {readerError && (
                <div className="mt-3 rounded-lg border border-red/30 bg-red/5 px-3 py-2 text-[12px] text-red">
                  <p className="font-semibold">Couldn&apos;t reach this reader</p>
                  <p className="mt-0.5 wrap-break-word">{readerError}</p>
                  <p className="mt-1 text-red/80">
                    This usually means the selected reader was removed or is in a different
                    test/live mode than your Stripe keys. Pick it again below.
                  </p>
                </div>
              )}

              <div className="mt-3 flex items-center gap-4">
                <button
                  type="button"
                  onClick={loadStatus}
                  disabled={diagLoading}
                  className="text-xs font-medium text-blue hover:underline disabled:opacity-50"
                >
                  {diagLoading ? 'Running…' : 'Run diagnostics'}
                </button>
                <button
                  type="button"
                  onClick={handleUnpair}
                  className="text-xs font-medium text-red hover:underline"
                >
                  Clear selection
                </button>
              </div>

              <p className="mt-2 text-[11px] leading-relaxed text-navy/40">
                Chip/tap not working but swipe does? Confirm the Firmware above matches the current
                version on the Stripe Dashboard reader page — if it lags, the on-device update
                hasn&apos;t landed. If it&apos;s current, share the Serial and Reader ID above with
                Stripe Terminal support for a hardware check.
              </p>
            </div>
          ) : (
            <p className="text-sm text-navy/50">No reader selected yet.</p>
          )}

          {readerId && (
            <label className="flex items-center gap-2 text-sm text-navy/80">
              <input
                type="checkbox"
                checked={enabled}
                disabled={saving}
                onChange={(e) => handleToggle(e.target.checked)}
                className="h-4 w-4 rounded border-navy/30 text-blue focus:ring-blue"
              />
              Offer &quot;Tap / insert on reader&quot; at checkout
            </label>
          )}

          {/* Select the shared reader (registered once in the Stripe Dashboard) */}
          <div className="rounded-xl border border-navy/10 p-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wide text-navy/50">
                {readerId ? 'Change reader' : 'Select a reader'}
              </p>
              <button
                type="button"
                onClick={loadReaders}
                disabled={readersLoading}
                className="text-xs font-medium text-blue hover:underline disabled:opacity-50"
              >
                {readersLoading ? 'Loading…' : 'Refresh list'}
              </button>
            </div>

            <select
              value={readerId}
              disabled={saving || readersLoading}
              onChange={(e) => {
                const r = readers.find((x) => x.id === e.target.value);
                if (r) handleSelect(r.id, r.label);
              }}
              className="mt-2 w-full rounded-lg border border-navy/20 bg-white px-3 py-2 text-sm text-navy focus:border-blue focus:outline-none focus:ring-1 focus:ring-blue"
            >
              <option value="" disabled>
                {readers.length ? 'Choose a reader…' : 'No readers found'}
              </option>
              {readers.map((r) => (
                <option key={r.id} value={r.id}>
                  {(r.label || '(no label)') + ' · ' + r.status + (r.deviceType ? ` · ${r.deviceType}` : '')}
                </option>
              ))}
            </select>

            {readersError && <p className="mt-2 text-[11px] text-red">{readersError}</p>}
            {!readersError && readers.length === 0 && !readersLoading && (
              <p className="mt-2 text-[11px] text-navy/50">
                No readers on this Stripe account. Register the shared reader once in the Stripe
                Dashboard (Terminal → Readers), then Refresh list.
              </p>
            )}
            <p className="mt-2 text-[11px] text-navy/40">
              The reader is shared across sites, so it&apos;s registered once in the Stripe Dashboard —
              here you just pick which one this counter uses.
            </p>
          </div>

          {message && (
            <p
              className={`rounded-lg px-3 py-2 text-sm ${
                message.kind === 'ok' ? 'bg-green-50 text-green-700' : 'bg-red/10 text-red'
              }`}
            >
              {message.text}
            </p>
          )}
        </div>
      )}

      <div className="mt-6 rounded-xl bg-navy/5 px-4 py-3 text-[11px] leading-relaxed text-navy/50">
        <p className="font-semibold text-navy/60">Setup (shared reader)</p>
        <ol className="mt-1 list-decimal space-y-0.5 pl-4">
          <li>Register the reader <span className="font-semibold">once</span> in the Stripe Dashboard (Terminal → Readers) — shared across all sites.</li>
          <li>Connect it to the internet (reader Settings → WiFi/Ethernet; admin PIN 07139).</li>
          <li>Here, pick it from the list above and keep the checkbox enabled. Every charge is tagged with this site so shared transactions stay distinguishable in Stripe.</li>
        </ol>
      </div>
    </div>
  );
}
