"use client";

import { useState } from 'react';
import type { CartResult, ShipmentDocument } from '../../types/shipping';

/**
 * International documents modal. After payment, prints the shipping label AND
 * every customs document the carrier returned (commercial invoice, etc.).
 * Reuses the same base64 → Blob → window.print() approach as the domestic
 * ShippingLabelModal, but loops the full document set per package.
 */

interface Props {
  results: CartResult[];
  /** How many paper copies of the commercial invoice to open for printing. */
  invoiceCopies?: number;
  onClose: () => void;
}

const CARRIER_LABELS: Record<string, string> = { fedex: 'FedEx', ups: 'UPS', usps: 'USPS', dhl: 'DHL Express' };
const CARRIER_COLORS: Record<string, string> = { fedex: '#4D148C', ups: '#351C15', usps: '#004B87', dhl: '#D40511' };
const DOC_LABELS: Record<ShipmentDocument['type'], string> = {
  LABEL: 'Shipping Label',
  COMMERCIAL_INVOICE: 'Commercial Invoice',
  OTHER: 'Customs Document',
};

function printDocument(doc: ShipmentDocument, title: string) {
  if (doc.mimeType === 'application/pdf') {
    const byteChars = atob(doc.base64);
    const byteArray = new Uint8Array(byteChars.length);
    for (let i = 0; i < byteChars.length; i++) byteArray[i] = byteChars.charCodeAt(i);
    const blob = new Blob([byteArray], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const win = window.open(url, '_blank');
    if (win) {
      win.onload = () => {
        win.focus();
        win.print();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
      };
    }
    return;
  }
  // Image document (GIF/PNG)
  const win = window.open('', '_blank', 'width=700,height=900');
  if (!win) return;
  win.document.write(`<!DOCTYPE html><html><head><title>${title}</title>
    <style>*{margin:0;padding:0}body{background:#fff}img{width:100%;max-width:8in;display:block;margin:0 auto}@media print{body{margin:0}}</style>
    </head><body><img src="data:${doc.mimeType};base64,${doc.base64}" /></body></html>`);
  win.document.close();
  win.focus();
  win.onload = () => { win.print(); };
}

export default function IntlDocumentsModal({ results, invoiceCopies = 3, onClose }: Props) {
  const [index, setIndex] = useState(0);
  const current = results[index];
  const { item, trackingNumber, labelError } = current;
  const { carrier, rate, shipment } = item;
  const carrierLabel = CARRIER_LABELS[carrier] ?? carrier.toUpperCase();
  const accentColor = CARRIER_COLORS[carrier] ?? '#34aef8';

  // Build the document list: prefer the structured documents[]; fall back to the
  // bare label if the carrier only returned that.
  const documents: ShipmentDocument[] =
    current.documents && current.documents.length > 0
      ? current.documents
      : current.labelBase64
        ? [{ type: 'LABEL', base64: current.labelBase64, mimeType: current.labelMimeType ?? 'application/pdf' }]
        : [];

  function printAll() {
    for (const doc of documents) {
      const copies = doc.type === 'COMMERCIAL_INVOICE' ? invoiceCopies : 1;
      for (let c = 0; c < copies; c++) {
        printDocument(doc, `${DOC_LABELS[doc.type]} — ${trackingNumber}`);
      }
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy/60 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4" style={{ backgroundColor: accentColor }}>
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-white/60">
              International Documents{results.length > 1 ? ` · ${index + 1} of ${results.length}` : ''}
            </p>
            <h3 className="text-lg font-bold text-white">{carrierLabel} · {rate.serviceName}</h3>
          </div>
          <div className="flex gap-2">
            {results.length > 1 && (
              <>
                <button type="button" onClick={() => setIndex((i) => Math.max(0, i - 1))} disabled={index === 0} className="rounded-lg bg-white/20 px-2 py-1.5 text-sm font-bold text-white hover:bg-white/30 disabled:opacity-30">‹</button>
                <button type="button" onClick={() => setIndex((i) => Math.min(results.length - 1, i + 1))} disabled={index === results.length - 1} className="rounded-lg bg-white/20 px-2 py-1.5 text-sm font-bold text-white hover:bg-white/30 disabled:opacity-30">›</button>
              </>
            )}
            <button type="button" onClick={onClose} className="rounded-lg p-1 text-white/60 hover:bg-white/20 hover:text-white">✕</button>
          </div>
        </div>

        <div className="max-h-[70vh] overflow-y-auto px-6 py-5">
          {/* Tracking + status */}
          <div className="mb-4 rounded-lg border-2 border-dashed border-navy/30 px-3 py-2 text-center">
            <p className="text-[10px] uppercase tracking-widest text-navy/40">Tracking Number</p>
            <p className="mt-1 text-xl font-bold tracking-[0.15em] text-navy">{trackingNumber}</p>
          </div>

          {labelError ? (
            <div className="mb-4 rounded-lg border border-red-300 bg-red-50 px-3 py-2">
              <p className="text-[11px] font-semibold text-red-700">Carrier Label Error</p>
              <p className="mt-0.5 text-[10px] text-red-600">{labelError}</p>
              <p className="mt-0.5 text-[10px] text-red-500">Shipment may not be registered with {carrierLabel}. Verify manually.</p>
            </div>
          ) : trackingNumber && trackingNumber !== 'PENDING' ? (
            <div className="mb-4 rounded-lg border border-green-300 bg-green-50 px-3 py-2">
              <p className="text-[11px] font-semibold text-green-700">Shipment Confirmed — {carrierLabel}</p>
              <p className="text-[10px] text-green-600">Attach the commercial invoice to the outside of the package.</p>
            </div>
          ) : (
            <div className="mb-4 rounded-lg border border-yellow-300 bg-yellow-50 px-3 py-2">
              <p className="text-[11px] text-yellow-700">Tracking pending — label may need manual generation.</p>
            </div>
          )}

          {/* Document list */}
          {documents.length === 0 ? (
            <p className="rounded-lg bg-cream px-3 py-3 text-center text-sm text-navy/50">No documents returned by the carrier.</p>
          ) : (
            <ul className="space-y-2">
              {documents.map((doc, i) => (
                <li key={i} className="flex items-center justify-between rounded-lg border border-navy/10 bg-cream px-4 py-3">
                  <div>
                    <p className="text-sm font-semibold text-navy">{DOC_LABELS[doc.type]}</p>
                    <p className="text-[11px] text-navy/40">
                      {doc.mimeType}
                      {doc.type === 'COMMERCIAL_INVOICE' ? ` · ${invoiceCopies} copies to attach` : ''}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => printDocument(doc, `${DOC_LABELS[doc.type]} — ${trackingNumber}`)}
                    className="rounded-lg border border-navy/20 px-3 py-1.5 text-xs font-semibold text-navy/70 transition-colors hover:bg-white"
                  >
                    🖨 Print
                  </button>
                </li>
              ))}
            </ul>
          )}

          <p className="mt-3 text-[11px] text-navy/40">
            To ({shipment.destCity || shipment.destZip}, {shipment.destCountry}) · {shipment.weightLbs} lbs · ${rate.totalChargeUSD.toFixed(2)}
          </p>
        </div>

        {/* Actions */}
        <div className="flex gap-3 border-t border-navy/10 px-6 py-4">
          <button
            type="button"
            onClick={printAll}
            disabled={documents.length === 0}
            className="flex-1 rounded-lg px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-all active:scale-95 disabled:opacity-40"
            style={{ backgroundColor: accentColor }}
          >
            🖨 Print All Documents
          </button>
          {results.length > 1 && index < results.length - 1 ? (
            <button type="button" onClick={() => setIndex((i) => i + 1)} className="flex-1 rounded-lg bg-blue px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-navy active:scale-95">
              Next Package ({index + 2} of {results.length}) ›
            </button>
          ) : (
            <button type="button" onClick={onClose} className="flex-1 rounded-lg border border-navy/20 px-4 py-2.5 text-sm font-medium text-navy/70 transition-colors hover:bg-cream">Done</button>
          )}
        </div>
      </div>
    </div>
  );
}
