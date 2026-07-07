"use client";

import { useState } from 'react';
import type { Commodity, CustomsInfo, ReasonForExport, Incoterm, DutiesPayer } from '../../types/shippingIntl';
import { EEI_FILING_THRESHOLD_USD } from '../../types/shippingIntl';

/**
 * Customs declaration modal for international shipments. Captures the line
 * items that populate the commercial invoice (both UPS & FedEx require HS
 * codes and per-item values for Mexico / South America). Emits a CustomsInfo.
 */

interface Props {
  carrierColor: string;
  carrierLabel: string;
  /** Seeds the first commodity's unit value (from the form's declared value). */
  defaultValueUSD?: number;
  onConfirm: (customs: CustomsInfo) => void;
  onClose: () => void;
}

const REASONS: { value: ReasonForExport; label: string }[] = [
  { value: 'SALE', label: 'Sale' },
  { value: 'GIFT', label: 'Gift' },
  { value: 'SAMPLE', label: 'Commercial sample' },
  { value: 'RETURN', label: 'Return' },
  { value: 'REPAIR', label: 'Repair' },
  { value: 'PERSONAL', label: 'Personal effects' },
];

const INCOTERMS: { value: Incoterm; label: string }[] = [
  { value: 'DAP', label: 'DAP — recipient pays duties on arrival' },
  { value: 'DDU', label: 'DDU — recipient pays duties (unpaid)' },
  { value: 'DDP', label: 'DDP — sender prepays duties' },
  { value: 'CPT', label: 'CPT — carriage paid to' },
];

function blankCommodity(unitValueUSD = 0): Commodity {
  return { description: '', hsCode: '', quantity: 1, unitValueUSD, countryOfManufacture: 'US', weightLbs: 0.5 };
}

export default function CustomsFormModal({ carrierColor, carrierLabel, defaultValueUSD = 0, onConfirm, onClose }: Props) {
  const [commodities, setCommodities] = useState<Commodity[]>([blankCommodity(defaultValueUSD)]);
  const [reasonForExport, setReasonForExport] = useState<ReasonForExport>('SALE');
  const [incoterm, setIncoterm] = useState<Incoterm>('DAP');
  const [dutiesPayer, setDutiesPayer] = useState<DutiesPayer>('recipient');
  const [contentsDescription, setContentsDescription] = useState('');

  const total = commodities.reduce((s, c) => s + Number(c.quantity || 0) * Number(c.unitValueUSD || 0), 0);
  const overThreshold = total >= EEI_FILING_THRESHOLD_USD;

  const valid =
    commodities.length > 0 &&
    commodities.every((c) => c.description.trim() && c.hsCode.trim() && c.quantity > 0 && c.unitValueUSD > 0 && c.countryOfManufacture.trim()) &&
    !overThreshold;

  function updateCommodity(i: number, patch: Partial<Commodity>) {
    setCommodities((prev) => prev.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
  }
  function addRow() { setCommodities((prev) => [...prev, blankCommodity()]); }
  function removeRow(i: number) { setCommodities((prev) => prev.filter((_, idx) => idx !== i)); }

  // Keep Incoterm and duties payer in sync (DDP ⇒ sender pays).
  function chooseIncoterm(value: Incoterm) {
    setIncoterm(value);
    setDutiesPayer(value === 'DDP' ? 'sender' : 'recipient');
  }

  function handleConfirm() {
    if (!valid) return;
    onConfirm({
      commodities: commodities.map((c) => ({
        ...c,
        description: c.description.trim(),
        hsCode: c.hsCode.trim(),
        countryOfManufacture: c.countryOfManufacture.trim().toUpperCase(),
      })),
      reasonForExport,
      incoterm,
      dutiesPayer,
      currency: 'USD',
      contentsDescription: contentsDescription.trim() || undefined,
    });
  }

  const input = 'w-full rounded-lg border border-navy/20 bg-white px-2.5 py-1.5 text-sm text-navy placeholder-navy/30 focus:border-blue focus:outline-none focus:ring-1 focus:ring-blue';
  const lbl = 'mb-1 block text-[10px] font-semibold uppercase tracking-wide text-navy/50';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy/60 p-4 backdrop-blur-sm">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4" style={{ backgroundColor: carrierColor }}>
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-white/60">Customs Declaration</p>
            <h3 className="text-lg font-bold text-white">{carrierLabel} · Commercial Invoice</h3>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1 text-white/60 transition-colors hover:bg-white/20 hover:text-white">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {/* Commodity rows */}
          <div className="space-y-3">
            {commodities.map((c, i) => (
              <div key={i} className="rounded-xl border border-navy/10 bg-cream/50 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-[11px] font-bold uppercase tracking-wide text-navy/50">Item {i + 1}</span>
                  {commodities.length > 1 && (
                    <button type="button" onClick={() => removeRow(i)} className="rounded p-0.5 text-navy/30 hover:bg-red/10 hover:text-red" title="Remove item">✕</button>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-12">
                  <div className="sm:col-span-5">
                    <label className={lbl}>Description</label>
                    <input className={input} value={c.description} onChange={(e) => updateCommodity(i, { description: e.target.value })} maxLength={120} placeholder="Cotton t-shirts" />
                  </div>
                  <div className="sm:col-span-3">
                    <label className={lbl}>HS / Tariff code</label>
                    <input className={input} value={c.hsCode} onChange={(e) => updateCommodity(i, { hsCode: e.target.value })} maxLength={14} placeholder="610910" />
                  </div>
                  <div className="sm:col-span-2">
                    <label className={lbl}>Made in</label>
                    <input className={input} value={c.countryOfManufacture} onChange={(e) => updateCommodity(i, { countryOfManufacture: e.target.value.toUpperCase() })} maxLength={2} placeholder="US" />
                  </div>
                  <div className="sm:col-span-2">
                    <label className={lbl}>Qty</label>
                    <input className={input} type="number" min="1" step="1" value={c.quantity} onChange={(e) => updateCommodity(i, { quantity: parseInt(e.target.value) || 0 })} />
                  </div>
                  <div className="sm:col-span-3">
                    <label className={lbl}>Unit value ($)</label>
                    <input className={input} type="number" min="0" step="0.01" value={c.unitValueUSD || ''} onChange={(e) => updateCommodity(i, { unitValueUSD: parseFloat(e.target.value) || 0 })} placeholder="0.00" />
                  </div>
                  <div className="sm:col-span-3">
                    <label className={lbl}>Line weight (lbs)</label>
                    <input className={input} type="number" min="0" step="0.1" value={c.weightLbs || ''} onChange={(e) => updateCommodity(i, { weightLbs: parseFloat(e.target.value) || 0 })} placeholder="0.5" />
                  </div>
                  <div className="flex items-end sm:col-span-6">
                    <p className="text-xs text-navy/50">Line total: <span className="font-semibold text-navy">${(Number(c.quantity || 0) * Number(c.unitValueUSD || 0)).toFixed(2)}</span></p>
                  </div>
                </div>
              </div>
            ))}
            <button type="button" onClick={addRow} className="rounded-lg border border-dashed border-navy/30 px-3 py-2 text-xs font-semibold text-navy/60 transition-colors hover:bg-cream">+ Add item</button>
          </div>

          {/* Export details */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label className={lbl}>Reason for export</label>
              <select className={input} value={reasonForExport} onChange={(e) => setReasonForExport(e.target.value as ReasonForExport)}>
                {REASONS.map((r) => (<option key={r.value} value={r.value}>{r.label}</option>))}
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className={lbl}>Terms of sale (Incoterm)</label>
              <select className={input} value={incoterm} onChange={(e) => chooseIncoterm(e.target.value as Incoterm)}>
                {INCOTERMS.map((t) => (<option key={t.value} value={t.value}>{t.label}</option>))}
              </select>
            </div>
          </div>

          <div>
            <label className={lbl}>Overall contents summary (optional)</label>
            <input className={input} value={contentsDescription} onChange={(e) => setContentsDescription(e.target.value)} maxLength={150} placeholder="Apparel and accessories" />
          </div>

          {/* Duties payer readout */}
          <div className="rounded-lg bg-navy/5 px-3 py-2 text-xs text-navy/60">
            Import duties &amp; taxes: <span className="font-semibold text-navy">{dutiesPayer === 'sender' ? 'Sender prepays (DDP)' : 'Recipient pays on arrival'}</span>
          </div>

          {/* Total + EEI warning */}
          <div className="flex items-center justify-between rounded-xl bg-cream px-4 py-3">
            <span className="text-sm font-semibold text-navy/60">Total customs value</span>
            <span className="text-2xl font-extrabold text-navy">${total.toFixed(2)}</span>
          </div>
          {overThreshold && (
            <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700">
              ⚠ Total is ${total.toFixed(2)}. Shipments valued at ${EEI_FILING_THRESHOLD_USD.toLocaleString()} or more per commodity require US EEI/AES (ITN) filing, which this tool does not yet handle. File the EEI separately or split the shipment.
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-3 border-t border-navy/10 px-6 py-4">
          <button type="button" onClick={onClose} className="flex-1 rounded-lg border border-navy/20 px-4 py-2.5 text-sm font-medium text-navy/70 transition-colors hover:bg-cream">Back</button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!valid}
            title={valid ? undefined : 'Complete every item (description, HS code, qty, value, origin) and stay under the EEI threshold'}
            className="flex-1 rounded-lg px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-all active:scale-95 disabled:opacity-40"
            style={{ backgroundColor: carrierColor }}
          >
            Continue to insurance →
          </button>
        </div>
      </div>
    </div>
  );
}
