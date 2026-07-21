# Card Reader Setup — Stripe Reader S700/S710

Take in-person card payments at the counter. The reader connects to the internet and talks
**directly to Stripe** — our app drives it from the server, so there's nothing to install and no
cables to the PC. It works from any browser/OS (Kali, Windows, etc.).

## Step 1 — Power on and connect to the internet
1. Hold the power button (right side) until the screen turns on.
2. Open **Settings** on the reader (admin **PIN: 07139**).
3. Connect via **Ethernet** (plug into your LAN — most reliable) or **WiFi**. The reader gets an IP
   automatically; it does **not** need to be on the same network as the PC.

## Step 2 — Generate a pairing code
1. On the reader: **Settings → Generate pairing code** (wording may vary slightly).
2. A short code appears. It expires in ~10 minutes and is single-use.

## Step 3 — Pair it in the app
1. In the admin app go to **Settings → Card reader**.
2. Type the pairing code, give it a label (e.g. "Front counter"), and click **Pair reader**.
3. The reader registers and its status shows **online**. Keep the **"Offer Tap / insert on reader
   at checkout"** checkbox enabled.
   - If pairing fails, generate a fresh code (the old one expires) and try again.

## Step 4 — Take a payment
At checkout (Register, Combined, or Shipping), click **💳 Tap on reader**. The reader prompts the
customer to tap/insert/swipe. On approval the sale records and the receipt prints automatically.
The on-screen **Key in** button is still there for phone/keyed orders.

- **Cancel:** press **Cancel payment** on screen while the reader is waiting — it clears the reader
  and voids the charge.
- **No processing-fee line in person** — the reader charges the exact total.

## Test vs live mode (important)
The reader registers in whichever mode your Stripe keys are in:
- **Test key** (`sk_test_…`) → pair a reader in **test mode** and use Stripe's test cards to try it end-to-end.
- **Live key** (`sk_live_…`) → pair the real reader in **live mode** for real payments.

If a charge says the reader "isn't registered," the reader and your keys are likely in different
modes — switch the reader's mode (Settings) or re-pair with the matching key.

## Troubleshooting
| Symptom | Fix |
|---|---|
| No **"Tap on reader"** button at checkout | Reader not paired/enabled — Settings → Card reader → pair + enable. |
| Reader status **offline** | Check its internet connection (Ethernet/WiFi); click **Refresh status**. |
| "Could not start the reader payment" | Reader busy/offline, or another payment is stuck — press Cancel and retry. |
| Pairing fails | Code expired — generate a new one; confirm test/live mode matches your keys. |

## Notes
- Technical details & code map: `stripe_terminal_s710_notes.md`.
- Nothing to install on the PC; the reader is server-driven via the Stripe API.
- Receipt printing/label printing are unaffected — reader sales print like any other card sale.
