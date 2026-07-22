# Card Reader Setup — Stripe Reader S700/S710 (shared)

Take in-person card payments at the counter. The reader connects to the internet and talks
**directly to Stripe** — our app drives it from the server, so there's nothing to install and no
cables to the PC. It works from any browser/OS (Kali, Windows, etc.).

**Shared reader:** this S710 is used by more than one of our sites on the **same Stripe account**.
A Terminal reader is an **account-level** device — you register it **once in the Stripe Dashboard**,
and every site then just *selects* it. Do **not** register/pair it separately per app (that would
create duplicates). Each site tags its charges so shared transactions stay distinguishable in Stripe.

## Step 1 — Register the reader ONCE (Stripe Dashboard)
Do this a single time for the shared reader (skip if it's already registered):
1. On the reader: power on, open **Settings** (admin **PIN: 07139**), connect via **Ethernet**
   (preferred) or **WiFi**, and **Generate pairing code**.
2. In the **Stripe Dashboard → Terminal → Readers → Register reader**, enter that code, give it a
   label (e.g. "Front counter") and a Location. Done — all sites can now use it.

## Step 2 — Select it in this app
1. In the admin app go to **Settings → Card reader**.
2. Pick the reader from the **dropdown** (it lists every reader on the account; click **Refresh
   list** if it's not there yet). Keep the **"Offer Tap / insert on reader at checkout"** checkbox
   enabled.
3. **Run diagnostics** to confirm it shows **online** with firmware/serial. Use **Clear selection**
   to unselect (it never deletes the shared reader).

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
