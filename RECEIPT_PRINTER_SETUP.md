# Receipt Printer Setup — Epson TM-T20IV-SP (Kali Linux or Windows)

This POS machine drives the **Epson TM-T20IV-SP** receipt printer (80mm, Ethernet) for
drop-off, sales, combined, and card-payment receipts. **Labels are unaffected.**

Printing happens **in the browser** using Epson's ePOS SDK (already bundled in the app) —
the browser talks to the printer directly over the LAN. This is **OS-agnostic: the same
setup works on Kali Linux, Windows, or macOS** — only a few peripheral steps differ per OS
(noted inline, with a Windows quick-reference at the end). **No Epson driver is required for
the receipt printing itself.** A driver (CUPS on Linux / Epson APD on Windows) is only
needed if you want the *fallback* browser print dialog to physically print, and is optional
(Step 5).

---

## Pick your scenario first

**How do you open the admin app on this Kali machine?**

| Scenario | You open… | Use port | SSL / certificate |
|----------|-----------|----------|-------------------|
| **A — App runs locally on Kali** (`npm run start` on this box) | `http://localhost:3000/admin` | **8008** | Not needed (simplest) ✅ |
| **B — Live hosted site** | `https://slpacknship.com/admin` | **8043** | Must trust the printer's certificate |

> Scenario A is simpler because a page served from `http://localhost` may talk to the
> printer over plain HTTP (port 8008) with no certificate step. The hosted HTTPS site
> (Scenario B) is blocked from plain HTTP, so it must use the printer's SSL port 8043 and
> you must trust the printer's self-signed certificate once in the browser.

---

## Step 1 — Put the printer on the network and find its IP

1. Connect the printer to the LAN via Ethernet and power it on.
2. Print the network status sheet: **power the printer off, then hold the FEED button while
   powering on** (hold ~5s) — it prints the current IP/DHCP info.
3. From Kali, confirm you can reach it (replace with the real IP):
   ```bash
   ping -c3 192.168.1.50
   # If you don't know the IP, scan the LAN for the Epson:
   sudo apt-get install -y arp-scan
   sudo arp-scan --localnet | grep -i epson
   ```
4. **Strongly recommended:** give the printer a **static IP** or a **DHCP reservation** on
   your router so the address never changes.

## Step 2 — Enable ePOS-Print on the printer

1. Open the printer's built-in web config in a browser:  `http://<printer-ip>`
   (you may need to set a printer admin password on first use).
2. Enable the **ePOS-Print** (Web service / device) feature and **Save / reboot** the printer.
3. Confirm the paper is set to **80mm** and the **auto-cutter** is enabled.

## Step 3 — Trust the printer's certificate (Scenario B only — skip for Scenario A)

The hosted HTTPS site can only reach the printer over SSL, and the printer uses a
self-signed certificate you must trust once **per browser** on this machine.

**Firefox (recommended on Kali):**
1. Visit **`https://<printer-ip>:8043`** in Firefox.
2. On the warning page click **Advanced → Accept the Risk and Continue** (adds a permanent
   exception for that origin).

**Chromium/Chrome:** self-signed exceptions are less reliable for background connections.
Prefer Firefox, or import the printer's certificate into the system trust store:
```bash
# Fetch the printer's cert and add it as a trusted CA (system-wide)
echo | openssl s_client -connect <printer-ip>:8043 2>/dev/null \
  | openssl x509 > /tmp/epson-printer.crt
sudo cp /tmp/epson-printer.crt /usr/local/share/ca-certificates/epson-printer.crt
sudo update-ca-certificates
```
Then restart the browser.

## Step 4 — Configure the app

1. Open the admin app (per your scenario) and go to **Settings** (top nav).
2. Enter:
   - **Printer IP address:** the IP from Step 1
   - **Port:** `8008` for Scenario A, or `8043` for Scenario B
   - **Enable** the "Print receipts to this printer" checkbox
3. Click **Save**, then **🖨 Test print**. A short test receipt should print and the paper cut.
   - If it fails, the on-screen error tells you what to fix (see Troubleshooting).

## Step 5 — (Optional) CUPS driver, for the browser-print fallback

If the Epson is unreachable, the app falls back to the browser's print dialog. For that
fallback to physically print (rather than "Save to PDF"), install the printer in CUPS:

```bash
sudo apt-get update
sudo apt-get install -y cups
sudo systemctl enable --now cups
sudo usermod -aG lpadmin $USER   # log out/in after this
```
Then open **http://localhost:631 → Administration → Add Printer**, select the networked
Epson (or "AppSocket/JetDirect" to `socket://<printer-ip>:9100`), and choose an Epson TM /
generic ESC-POS 80mm driver. For the best driver, download Epson's **"TM/BA Series Thermal
Printer Driver for Linux"** from the Epson support site and install the included CUPS `.deb`,
then pick the **TM-T20IV** model. This step is **not** required for normal receipt printing.

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Test print: **"Epson ePOS SDK not loaded"** | Reload the admin page; ensure you're on an `/admin` page (the SDK loads there). |
| Test print: **"connection timed out" / "connection failed"** | Wrong IP, printer off, or not on the same LAN. Re-check Step 1 `ping`. |
| Works on Scenario A but **fails on the live site** | You skipped Step 3 — trust the cert at `https://<printer-ip>:8043` (Firefox), or import it (Chromium). |
| Prints but **won't cut / wrong width** | Set 80mm paper + enable auto-cutter in the printer web config (Step 2). |
| **Cash drawer won't open** | Drawer only pops on **cash** sales (never card/drop-off/reprints). Confirm the drawer's RJ11 cable is in the printer's **DK** port. |
| Receipts still go to the **browser dialog** | The printer is disabled or unreachable — enable it in Settings and pass Test print. |

## Windows PC — quick reference

The scenarios (A/B), ports, and app Settings (Step 4) are **identical** on Windows. Only
these OS-specific commands change:

- **Step 1 — find the IP:** `ping 192.168.1.50` works the same. To discover it, open the
  status sheet (FEED-button method above), or install Epson's **EpsonNet Config** (Windows)
  and let it list the printer. `arp -a` in Command Prompt also lists LAN devices.
- **Step 3 — trust the certificate (Scenario B):** easiest is **Firefox** (same "Accept the
  Risk and Continue" step). For **Edge/Chrome**, import the printer's cert into the Windows
  store: browse `https://<printer-ip>:8043` → click the cert warning → export the
  certificate → run `certlm.msc` → **Trusted Root Certification Authorities → Certificates →
  All Tasks → Import** → select the file → restart the browser.
- **Step 5 — optional fallback driver:** install Epson's **Advanced Printer Driver (APD) for
  TM-T20IV** (Windows), then set it as needed. Not required for normal receipt printing.

Everything else — enabling ePOS-Print on the printer, entering the IP/port in **Settings**,
and **Test print** — is exactly the same.

## Notes
- Technical details & code map: see `epson_receipt_printer_notes.md`.
- The ePOS SDK is bundled at `public/ePOS_SDK_JavaScript_v2.27.0i/epos-2.27.0.js` — nothing to install for it.
- Label/customs printing is untouched by this setup.
