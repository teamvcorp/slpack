"use client";

import { useState, useRef } from 'react';
import type { CartResult } from '../types/shipping';

interface Props {
  results: CartResult[];
  onClose: () => void;
}

const CARRIER_LABELS: Record<string, string> = {
  fedex: 'FedEx',
  ups: 'UPS',
  usps: 'USPS',
  dhl: 'DHL Express',
};

const CARRIER_COLORS: Record<string, string> = {
  fedex: '#4D148C',
  ups: '#351C15',
  usps: '#004B87',
  dhl: '#D40511',
};

export default function ShippingLabelModal({ results, onClose }: Props) {
  const [index, setIndex] = useState(0);
  const printRef = useRef<HTMLDivElement>(null);

  const current = results[index];
  const { item, trackingNumber, labelBase64, labelMimeType, labelError } = current;
  const { carrier, rate, shipment } = item;
  const carrierLabel = CARRIER_LABELS[carrier] ?? carrier.toUpperCase();
  const accentColor = CARRIER_COLORS[carrier] ?? '#34aef8';
  const now = new Date();

  function handlePrint() {
    // If we have a PDF label, open it directly and print
    if (labelBase64 && labelMimeType === 'application/pdf') {
      const byteChars = atob(labelBase64);
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

    // If we have an image label (PNG/GIF), print it directly
    if (labelBase64 && labelMimeType && labelMimeType !== 'application/pdf') {
      const win = window.open('', '_blank', 'width=600,height=800');
      if (!win) return;
      win.document.write(`<!DOCTYPE html><html><head><title>Shipping Label — ${trackingNumber}</title>
        <style>* { margin:0; padding:0; } body { background:#fff; } img { width:4in; display:block; margin:0 auto; } @media print { body { margin:0; } }</style>
        </head><body><img src="data:${labelMimeType};base64,${labelBase64}" /></body></html>`);
      win.document.close();
      win.focus();
      win.onload = () => { win.print(); win.onafterprint = () => win.close(); };
      return;
    }

    if (!printRef.current) return;
    const content = printRef.current.innerHTML;
    const win = window.open('', '_blank', 'width=600,height=800');
    if (!win) return;
    win.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Shipping Label — ${trackingNumber}</title>
          <style>
            * { box-sizing: border-box; margin: 0; padding: 0; }
            body { font-family: monospace; font-size: 12px; background: #fff; }
            .label-wrap { width: 4in; padding: 0.25in; border: 2px solid #000; margin: 0.25in auto; }
            .header { background: ${accentColor}; color: #fff; padding: 6px 10px; font-size: 16px; font-weight: bold; }
            .section { border-top: 1px solid #ccc; padding: 6px 0; }
            .row { display: flex; justify-content: space-between; margin-bottom: 4px; }
            .tracking { font-size: 20px; font-weight: bold; letter-spacing: 2px; text-align: center; padding: 8px 0; border: 2px dashed #333; margin: 8px 0; }
            .barcode-img { display: block; margin: 0 auto; max-width: 100%; }
            @media print { body { margin: 0; } }
          </style>
        </head>
        <body>${content}</body>
      </html>
    `);
    win.document.close();
    win.focus();
    win.onafterprint = () => win.close();
    win.print();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy/60 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl">
        {/* Header */}
        <div
          className="flex items-center justify-between px-6 py-4"
          style={{ backgroundColor: accentColor }}
        >
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-white/60">
              Shipping Label{results.length > 1 ? ` · ${index + 1} of ${results.length}` : ''}
            </p>
            <h3 className="text-lg font-bold text-white">{carrierLabel} Label Ready</h3>
          </div>
          <div className="flex gap-2">
            {results.length > 1 && (
              <>
                <button
                  type="button"
                  onClick={() => setIndex((i) => Math.max(0, i - 1))}
                  disabled={index === 0}
                  className="rounded-lg bg-white/20 px-2 py-1.5 text-sm font-bold text-white transition-colors hover:bg-white/30 disabled:opacity-30"
                >
                  ‹
                </button>
                <button
                  type="button"
                  onClick={() => setIndex((i) => Math.min(results.length - 1, i + 1))}
                  disabled={index === results.length - 1}
                  className="rounded-lg bg-white/20 px-2 py-1.5 text-sm font-bold text-white transition-colors hover:bg-white/30 disabled:opacity-30"
                >
                  ›
                </button>
              </>
            )}
            <button
              type="button"
              onClick={handlePrint}
              className="rounded-lg bg-white/20 px-3 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-white/30"
            >
              🖨 Print
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1 text-white/60 transition-colors hover:bg-white/20 hover:text-white"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Label preview */}
        <div className="overflow-y-auto max-h-[70vh] px-6 py-5">
          <div ref={printRef}>
            <div className="label-wrap border-2 border-navy font-mono text-xs">
              {/* Carrier header */}
              <div
                className="header px-3 py-2 text-lg font-bold text-white"
                style={{ backgroundColor: accentColor }}
              >
                {carrierLabel} · {rate.serviceName}
              </div>

              {/* From / To */}
              <div className="grid grid-cols-2 gap-4 p-3">
                <div>
                  <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-navy/40">From</p>
                  <p className="font-semibold text-navy">Storm Lake Pack &amp; Ship</p>
                  <p className="text-navy/70">Storm Lake, IA {shipment.originZip}</p>
                  <p className="text-navy/70">{shipment.originCountry}</p>
                </div>
                <div>
                  <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-navy/40">To</p>
                  <p className="font-semibold text-navy">{shipment.customerName || 'Customer'}</p>
                  {shipment.customerPhone && (
                    <p className="text-navy/70">{shipment.customerPhone}</p>
                  )}
                  {shipment.destStreet && (
                    <p className="text-navy/70">{shipment.destStreet}</p>
                  )}
                  {shipment.destCity && (
                    <p className="text-navy/70">
                      {shipment.destCity}
                      {shipment.destState ? `, ${shipment.destState}` : ''} {shipment.destZip}
                    </p>
                  )}
                  {!shipment.destCity && (
                    <p className="text-navy/70">{shipment.destZip}</p>
                  )}
                  <p className="text-navy/70">{shipment.destCountry}</p>
                </div>
              </div>

              {/* Tracking */}
              <div className="mx-3 mb-3 rounded-lg border-2 border-dashed border-navy/30 px-3 py-2 text-center">
                <p className="text-[10px] uppercase tracking-widest text-navy/40">Tracking Number</p>
                <p className="mt-1 text-xl font-bold tracking-[0.15em] text-navy">{trackingNumber}</p>
              </div>

              {/* Carrier processing status */}
              {labelError ? (
                <div className="mx-3 mb-3 rounded-lg border border-red-300 bg-red-50 px-3 py-2 flex items-start gap-2">
                  <span className="mt-0.5 text-red-500">⚠</span>
                  <div>
                    <p className="text-[11px] font-semibold text-red-700">Carrier Label Error</p>
                    <p className="text-[10px] text-red-600 mt-0.5">{labelError}</p>
                    <p className="text-[10px] text-red-500 mt-0.5">Shipment may not be registered with {carrierLabel}. Verify manually.</p>
                  </div>
                </div>
              ) : (trackingNumber && trackingNumber !== 'PENDING') ? (
                <div className="mx-3 mb-3 rounded-lg border border-green-300 bg-green-50 px-3 py-2 flex items-center gap-2">
                  <svg className="h-4 w-4 text-green-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                  </svg>
                  <div>
                    <p className="text-[11px] font-semibold text-green-700">Shipment Confirmed — {carrierLabel}</p>
                    <p className="text-[10px] text-green-600">Package successfully registered with carrier.</p>
                  </div>
                </div>
              ) : (
                <div className="mx-3 mb-3 rounded-lg border border-yellow-300 bg-yellow-50 px-3 py-2 flex items-center gap-2">
                  <span className="text-yellow-500 text-sm">⏳</span>
                  <p className="text-[11px] text-yellow-700">Tracking number pending — label may need manual generation.</p>
                </div>
              )}

              {/* If carrier returned a label image */}
              {labelBase64 && labelMimeType === 'application/pdf' && (
                <div className="mx-3 mb-3">
                  <embed
                    src={`data:application/pdf;base64,${labelBase64}`}
                    type="application/pdf"
                    className="w-full rounded"
                    style={{ height: '680px' }}
                  />
                </div>
              )}
              {labelBase64 && labelMimeType !== 'application/pdf' && (
                <div className="mx-3 mb-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`data:${labelMimeType ?? 'image/png'};base64,${labelBase64}`}
                    alt="Carrier label barcode"
                    className="barcode-img w-full rounded"
                  />
                </div>
              )}

              {/* Package info */}
              <div className="border-t border-navy/10 px-3 py-2">
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div>
                    <p className="text-[10px] uppercase text-navy/40">Weight</p>
                    <p className="font-semibold text-navy">{shipment.weightLbs} lbs</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase text-navy/40">Dims</p>
                    <p className="font-semibold text-navy">
                      {shipment.lengthIn}×{shipment.widthIn}×{shipment.heightIn}&quot;
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase text-navy/40">Charge</p>
                    <p className="font-semibold text-navy">${rate.totalChargeUSD.toFixed(2)}</p>
                  </div>
                </div>
              </div>

              {/* Footer */}
              <div className="border-t border-navy/10 px-3 py-2 text-center text-[10px] text-navy/30">
                Shipped {now.toLocaleDateString()} · Storm Lake Pack &amp; Ship
              </div>
            </div>
          </div>
        </div>

        <div className="flex gap-3 border-t border-navy/10 px-6 py-4">
          <button
            type="button"
            onClick={handlePrint}
            className="flex-1 rounded-lg px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-all active:scale-95"
            style={{ backgroundColor: accentColor }}
          >
            🖨 Print Label
          </button>
          {results.length > 1 && index < results.length - 1 ? (
            <button
              type="button"
              onClick={() => setIndex((i) => i + 1)}
              className="flex-1 rounded-lg bg-blue px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-navy active:scale-95"
            >
              Next Label ({index + 2} of {results.length}) ›
            </button>
          ) : (
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-lg border border-navy/20 px-4 py-2.5 text-sm font-medium text-navy/70 transition-colors hover:bg-cream"
            >
              Done
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
