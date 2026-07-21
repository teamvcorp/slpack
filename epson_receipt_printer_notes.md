# Epson TM-T20IV-SP Receipt Printer — integration notes

Dedicated thermal receipt printer for **customer receipts only** (drop-off, sales/register,
combined checkout, and card/"stripe" payment receipts). **Label/customs printing is NOT
routed here** — those keep using the browser print path (`ShippingLabelModal`,
`IntlDocumentsModal`).

## Hardware / connection
- **Model:** Epson TM-T20IV-SP · **80mm** thermal roll · **Ethernet** on the shop LAN.
- **Docs portal:** https://support.epson.net/p_doc/a5e (login-gated; blocks scripted fetch).
- **SDK:** Epson **ePOS SDK for JavaScript** v2.27.0, vendored at
  `public/ePOS_SDK_JavaScript_v2.27.0i/epos-2.27.0.js`, loaded via `next/script` in
  `app/admin/layout.tsx`. Exposes the global `window.epson` (with `epson.ePOSDevice`).
- **API reference:** https://download4.epson.biz/sec_pubs/pos/reference_en/epos_js/index.html

## Why client-side (not server)
The app is Vercel-hosted over **HTTPS**; the cloud server cannot reach a LAN printer, so
printing runs **in the admin browser** on the shop LAN. Because the page is HTTPS, the SDK
must connect to the printer's **SSL endpoint (port 8043, `crypto: true`)** — plain HTTP:8008
is blocked as mixed content.

### One-time per-browser setup (required)
1. Give the printer a **static/reserved LAN IP**; enable **ePOS-Print + SSL** in its web config.
2. On each shop browser, visit `https://<printer-ip>` once and **trust the self-signed cert**
   (otherwise the wss/SSL connection is silently blocked).
3. Admin → **Settings**: enter IP, keep port **8043**, enable, click **Test print**.

## Connect / print flow (ePOS SDK JavaScript)
```js
const dev = new window.epson.ePOSDevice();
dev.connect(ip, 8043, (result) => {          // 'SSL_CONNECT_OK' over SSL, 'OK' plain
  dev.createDevice('local_printer', dev.DEVICE_TYPE_PRINTER,
    { crypto: true, buffer: false }, (printer, code) => {   // code === 'OK'
      printer.onreceive = (res) => { /* res.success */ };
      printer.addTextAlign(printer.ALIGN_CENTER);
      printer.addTextStyle(false, false, /*bold*/ true, printer.COLOR_1);
      printer.addText('Storm Lake Pack & Ship\n');
      printer.addFeedLine(1);
      printer.addPulse(printer.DRAWER_1, printer.PULSE_100); // cash drawer kick (cash only)
      printer.addCut(printer.CUT_FEED);
      printer.send();                          // silent — no browser dialog
    });
});
```
Column width: 80mm Font A is up to 48 cols; we pad to **42** so lines never wrap on any 80mm TM.

## Code map (this repo)
- `lib/eposReceipt.ts` — ESC/POS renderers mirroring the HTML builders in `lib/receipt.ts`:
  `renderSale`, `renderCombined` (also shipping-only), `renderDropoff`, `renderTest`. Exports
  the `EposPrinter` type. Cash drawer opens only when `openDrawer === true` **and** payment is
  cash (reprints pass `openDrawer: false`).
- `app/admin/components/receiptPrinter.ts` — connection manager + `printReceipt(render, fallbackHtml)`
  (tries Epson, else falls back to `printHtml`) and `testPrint(ip, port)` (throws so Settings can
  show errors). Reads config from `/api/admin/settings/printer`.
- `app/api/admin/settings/printer/route.ts` — GET/PUT single doc `slpack.settings/_id:'receiptPrinter'`
  `{ ip, port, enabled }`. Auth handled by the global `proxy.ts` middleware (admin session).
- `app/admin/settings/page.tsx` — IP/port/enable form + Test print + setup instructions.
- Call sites routed to the printer: `RegisterCheckout` (finish + reprint), `CombinedCheckout`
  (`printCombinedReceipt`), `dropoff/page.tsx` (finish + per-scan), `SalesReport` (register reprint),
  `StripeCheckout` (new: prints on every card/cash charge). Fallback = existing browser print.

## Behavior rules
- **Cash drawer:** pops on fresh **cash** transactions only; never on card, drop-off, or reprints.
- **Register/combined:** cash always prints (drawer must open); card with an email skips the auto
  print (email is the copy) — unchanged from before.
- **Fallback:** printer disabled/unreachable/cert-untrusted ⇒ `printHtml` browser dialog, logged to console.
- Wide, non-80mm layouts stay on browser print: `buildShipmentReceiptHtml` (shipment reprint),
  `buildDropoffReportHtml` (drop-off period report).
