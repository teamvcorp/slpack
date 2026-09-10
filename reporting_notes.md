# Reporting and ship dates — clock and null bugs (fixed 2026-09-09/10)

Staff report: "it will load today's report, but when we change date it says
application error." Two unrelated faults, both of which only showed on the
deployed site. This records what they were so nobody re-researches them.

The data was never at fault. At the time of the fix the production database held
153 shipments, 143 register sales and 784 drop-offs, all writing normally.

---

## 1. `undefined` written to Mongo comes back as `null` — and crashed the page

### The crash

`app/admin/log/page.tsx` drew the per-shipment margin line behind this guard:

```tsx
{!isVoided && entry.carrierCostUSD !== undefined && (() => {
  const margin = entry.shippingUSD - entry.carrierCostUSD;   // null → coerces to 0, no error
  return <p title={`Carrier cost $${entry.carrierCostUSD.toFixed(2)}`}>   // null.toFixed() THROWS
```

**`null !== undefined` is `true`.** One row had `carrierCostUSD: null`, so the
guard admitted it and `null.toFixed(2)` raised a `TypeError`.

There was **no error boundary anywhere in `app/`**, so React unwound the whole
tree. In production that is the browser-level *"Application error: a client-side
exception has occurred"* — nav gone, no way back. In dev you get the overlay and
a stack instead, which is exactly why this looked like a live-site-only fault.

The row was `2026-09-04T15:44:01.402Z`, a USPS shipment whose label call failed
(`shipping/usps/label — USPS payment auth error (401)`, logged in the same
millisecond). Being dated Sep 4, it sat outside "Today" and inside every wider
window — hence "today works, changing the period breaks."

### Why a null existed

`app/api/shipping/submit/route.ts` is careful and writes:

```ts
carrierCostUSD: carrierCostUSD ?? undefined,   // deliberately ABSENT, not null
```

But **the MongoDB driver's default is `ignoreUndefined: false`, which serialises
`undefined` as BSON `null`.** The route's intent was silently overruled. Same
for its siblings `rateSource`, `listPriceUSD`, `priceOverridden`.

Fix: `IGNORE_UNDEFINED` in `lib/mongodb.ts`, passed to every write in
`shipmentLog.ts`, `saleLog.ts`, `dropoffLog.ts`, `errorLog.ts`.

**Do NOT set `ignoreUndefined` on the MongoClient.** The option applies to query
*filters* as well as documents. Client-wide, a bug that passed an undefined id
would turn `findOne({ id: undefined })` into `findOne({})` and return an
arbitrary customer's shipment. Keep it per-write.

### The guard: only `typeof` is correct

Verified against every value that can reach it:

| value | `!== undefined` (old) | `Number.isFinite(Number(x))` | `typeof x === 'number' && isFinite` |
|---|---|---|---|
| `null` | **true** → crash | **true** → `0`, fake margin | `null` → skipped |
| `undefined` | false | false | skipped |
| `NaN` | **true** → "NaN" | false | skipped |
| `0` | true | true | `0` (a real zero survives) |
| `19.9` | true | true | `19.9` |

`Number.isFinite(Number(x))` is a trap: **`Number(null)` is `0`**, so it reports
a $0.00 carrier cost and a fabricated margin. Wrong money is worse than a crash.
This was caught only by running the fix against real data — not by the compiler.

### Blast radius

`app/admin/error.tsx` now exists. Any future unexpected row costs one screen
with a Retry button, not the whole app. It shows the error `digest` only —
messages can carry connection details or record contents and the screen faces
the sales floor.

---

## 2. Report windows were built from the SERVER's clock

`lib/reportPeriod.ts` computed the day boundary as:

```ts
new Date(now.getFullYear(), now.getMonth(), now.getDate())   // midnight in the SERVER's zone
```

The dev machine is Central, so this was right locally. The production host is
**UTC**, so "Today" began at `00:00Z` = **19:00 CT the previous day**. Measured
against real rows for 2026-09-09:

| Report run at (CT) | Window starts | Drop-offs | Shipments |
|---|---|---|---|
| 4:00 pm | Sep 9 00:00Z | 7 | 0 |
| 6:00 pm | Sep 9 00:00Z | 9 | 1 |
| **7:00 pm** | **Sep 10 00:00Z** | **0** | **0** |

`app/api/shipping/log/route.ts` carried an independent second copy of the same
bug (`ts.toDateString() === now.toDateString()`), and it also loaded the entire
collection before filtering in JS.

### The fix

`lib/localDate.ts` — which already existed to kill this exact bug class for
carrier ship dates — gained `zoneOffsetMs()` and `startOfLocalDayUtc()`.
`Intl.DateTimeFormat.formatToParts`, no dependency, DST-safe via a two-pass
offset resolution (pass 1 can land on the wrong side of a transition; pass 2
re-reads the offset at the candidate and corrects).

Only ever call `startOfLocalDayUtc` for **midnight**. Central switches at 02:00
local, so local midnight is never a skipped or repeated wall time — there is no
ambiguity to resolve. That is why it takes no `hour` parameter.

`reportPeriodStartIso()` / `logPeriodStartIso()` return **UTC ISO strings**, not
Dates, because that is what the collections store and what the lexical
`{ timestamp: { $gte } }` comparison needs — the string is the contract, so no
caller can re-localise it and reintroduce this.

Verified boundaries (assert these if the code is ever touched):

| store-local date | → UTC instant | |
|---|---|---|
| `2026-09-08` | `2026-09-08T05:00:00.000Z` | CDT, UTC−5 |
| `2026-01-01` | `2026-01-01T06:00:00.000Z` | CST, UTC−6 |
| `2026-03-08` | `2026-03-08T06:00:00.000Z` | spring forward — still CST at midnight |
| `2026-11-01` | `2026-11-01T05:00:00.000Z` | fall back — still CDT at midnight |

And the cliff itself: at `2026-09-09T00:01:00Z` (7:01 pm CT on Sep 8) `today`
must resolve to `2026-09-08T05:00:00.000Z` — the day must NOT roll.

18 assertions were run under host `TZ` of UTC, America/Chicago, Asia/Tokyo and
Pacific/Kiritimati (UTC+14); all four produce identical output. Nothing in the
helpers calls a local-time `Date` getter, which is what makes that true.

**Behaviour change:** the Shipments tab's "This Week" is now today plus the
previous six store-local calendar days, not a rolling 168 hours. The old window
made a shipment drop out partway through the seventh morning.

---

## 3. List responses no longer carry label images

`/api/reports/sales` nested the entire source document per row, so every
response shipped every stored `labelBase64` (~25 KB each).

Measured before and after, against the same production data:

| endpoint | before | after |
|---|---|---|
| `/api/reports/sales?period=ytd` | 2.06 MB | **222 KB** |
| `/api/shipping/log?period=all` | 2.00 MB | **80 KB** |

The serverless response cap is 4.5 MB; at ~15-20 shipments/month this was about
a year from failing outright with `FUNCTION_PAYLOAD_TOO_LARGE`.

`SHIPMENT_LIST_PROJECTION` in `lib/shipmentLog.ts` is an **inclusion whitelist**,
not `{ labelBase64: 0 }` — a field added to the log later then cannot leak into
a browser response by default. Customer phone and sender contact are dropped
too: no report renders them, and there is no cause to ship a year of customer
phone numbers to a browser.

`hasLabel` is a computed projection (`$ne: [{ $ifNull: ['$labelBase64', ''] }, '']`).
It must be computed server-side precisely because the field it tests is the one
we refuse to send. **This is why the projection must be an inclusion** — Mongo
forbids mixing exclusions with computed fields (`_id: 0` is the one exception).

`log/page.tsx` used `entry.labelBase64` as the Print button's enabled-test. It
now uses `entry.hasLabel`. **The compiler could not catch this** — that page
declares its own `LogResponse` interface rather than importing the server's
return type, so the Print button would have silently gone dead forever. Check it
by hand after any change to the projection.

`SHIPMENT_LIST_LIMIT` (2000) caps a response near 2 MB. Both routes return
`truncated`, and both UIs render a warning: a silently short list makes a revenue
total quietly wrong, which at a counter is worse than an error.

---

## 4. Indexes

Created by hand against Atlas on 2026-09-09. **Not** in app code: `createIndex`
on a request path costs a round-trip on every cold start and races across
instances. It is a migration, not a query.

```js
use slpack
db.shipments.createIndex({ timestamp: -1 }, { name: 'timestamp_desc' })
db.sales.createIndex(    { timestamp: -1 }, { name: 'timestamp_desc' })
db.dropoffs.createIndex( { timestamp: -1 }, { name: 'timestamp_desc' })
db.errors.createIndex(   { timestamp: -1 }, { name: 'timestamp_desc' })
```

Descending matches `.sort({ timestamp: -1 })`, so the `$gte` range and the sort
are served by one index scan with no in-memory sort.

---

## Ship dates: the day a parcel is actually collected (fixed 2026-09-10)

Follow-on from the report fix. The store closes at 6 pm and UPS/FedEx collect
at closing; there are no weekend pickups. Carriers count their delivery
commitment from the ship date they are given, so that date must be a day a
pickup really happens.

Three bugs, compounding:

1. **UPS used the server's clock.** `app/api/shipping/ups/route.ts`,
   `app/api/shipping/intl/ups/route.ts` and `yyyymmdd()` in
   `lib/shippingIntl.ts` built the stamp from `getFullYear/getMonth/getDate`.
   On the UTC host that rolled to tomorrow after 7 pm Central. The UPS rate
   routes also sent `pickupTime` as the **UTC** hour.
2. **On a Friday evening that produced SATURDAY** — a day nothing is collected
   here. UPS then quoted transit from a pickup that never happens.
3. **Even the correct local date was wrong after closing.** A parcel labelled
   at 7 pm Friday does not move until **Monday**. `localDateStamp()` alone
   would have said Friday.

`nextPickupDateStamp()` in `lib/localDate.ts` is now the single answer: start
from the store-local date, advance a day if the 6 pm cutoff has passed, then
skip Saturday and Sunday. `PICKUP_CUTOFF_HOUR` (18) and `PICKUP_TIME_COMPACT`
('1800') are the tunables — pickup time is now a constant 1800 rather than the
current clock, because collection is at closing regardless of when the label
was printed.

Verified (identical under host TZ of UTC, America/Chicago and Asia/Tokyo):

| labelled at (store time) | ships |
|---|---|
| Thu 17:59 | same day |
| Thu 18:00 (cutoff) | Fri |
| **Fri 19:00** | **Mon** (old UPS code said Sat) |
| Sat 12:00 | Mon |
| Sun 20:00 | Mon |
| Sat 31 Oct | Mon 2 Nov (across the DST fallback) |

**FedEx was changed too, on purpose.** Its four paths already used
`localDateStamp()`, so only bug 3 applied — but the compare screen shows UPS
and FedEx side by side. Leaving FedEx on "today" after closing would have had
the two carriers promising different delivery days for the same parcel, and
staff picking the wrong one. Consistency here is a correctness requirement, not
tidiness.

The Saturday-delivery feature is unaffected: `isSaturdayDate` tests the
carrier's **arrival** date, not the pickup date. Ask before the Friday cutoff
and Saturday delivery is offered as usual; ask after it, and the parcel ships
Monday and Saturday correctly disappears.

### Verification status — read before trusting FedEx

- **UPS: verified live** against the sandbox. Thu 07:59 CT → ships same day,
  Next Day Air arrives Fri, the Saturday variant arrives Sat. 7 services, 200.
- **FedEx: NOT verified live.** The FedEx sandbox was returning
  `SERVICE.UNAVAILABLE.ERROR` (503) throughout. Confirmed pre-existing by
  stashing the change and re-testing: the unmodified code 503s identically, so
  this is FedEx's infrastructure, not the payload. The FedEx paths typecheck
  and build, and the change is a one-line swap of an already-working helper for
  another — but **re-run a FedEx rate once their sandbox is back.**
- Intl UPS/FedEx rate paths were not exercised live (they need a full customs
  payload); same one-line swap, typechecked only.

### Left alone deliberately

- `app/api/shipping/usps/label/route.ts` still uses `localDateStamp()`. USPS
  labels carry a mailing date and postdating rules differ; changing it needs
  its own check.
- `app/api/shipping/dhl/route.ts` hardcodes "tomorrow" and does not skip
  weekends. Its own oddity, DHL is not in daily use.
- `app/api/shipping/fedex/pickup/route.ts` compares against `localDateStamp()`
  to decide SAME_DAY vs FUTURE_DAY — that must stay the real current date.
- Holidays. `nextPickupDateStamp` skips weekends only. Every carrier path calls
  it, so it is the one place to add a holiday table if that ever matters.

## Removed: `/api/register/sales`

Deleted 2026-09-10. It was a register-only sales feed superseded by
`/api/reports/sales`, and nothing referenced it — verified with ripgrep across
the whole tree; the only surviving hit was this document. Do not confuse it with
`/api/register/sale` (singular), which is the live WRITE route that records a
till sale and is called from `RegisterCheckout.tsx` and `CombinedCheckout.tsx`.

It was worth removing rather than leaving: it had no concept of a voided
shipment, so anyone who found it would have gotten revenue numbers that quietly
disagreed with the Sales tab. Recoverable from history at d604af7 if ever
needed.

---

## Partner Shipping API — collections, indexes, and enabling (added 2026-09-10)

A separate, credentialed server-to-server API (`/api/partner/*`) that lets the
sister site mainstreet-shops.com buy labels. Fully isolated from the counter —
its own routes, its own auth, and its own collections. Contract for the other
team: `PARTNER_API.md`. Design/security notes: `security_notes.md`.

### Collections (all new; the counter's `shipments`/`sales` are untouched)

- **`partners`** — issued credentials. `secretHash`/`secretSalt` are scrypt; the
  plaintext secret is shown once and never stored.
- **`partnerQuotes`** — single-use retail quotes (dest + package + mode + price),
  TTL'd like the counter's `quotes`.
- **`partnerShipments`** — the partner revenue/label record (retail + carrier
  cost for the shop; partners only ever read a retail-only projection).
- **`partnerApiEvents`** — append-only audit of every partner request.

### Indexes (create by hand against Atlas, same as §4 above)

```js
use slpack
db.partners.createIndex(         { keyId: 1 },      { unique: true, name: 'keyId_unique' })
db.partners.createIndex(         { partnerId: 1 },  { unique: true, name: 'partnerId_unique' })
db.partnerQuotes.createIndex(    { quoteId: 1 },    { unique: true, name: 'quoteId_unique' })
db.partnerQuotes.createIndex(    { expiresAt: 1 },  { expireAfterSeconds: 0, name: 'ttl_expiresAt' })
db.partnerShipments.createIndex( { partnerId: 1, createdAt: -1 }, { name: 'partner_recent' })
db.partnerShipments.createIndex( { partnerId: 1, quoteId: 1 },    { name: 'partner_quote' })
db.partnerShipments.createIndex( { partnerId: 1, paymentIntentId: 1 }, { name: 'partner_pi' })
db.partnerShipments.createIndex( { status: 1, createdAt: -1 },   { name: 'status_recent' })
db.partnerApiEvents.createIndex( { at: 1 }, { expireAfterSeconds: 7776000, name: 'ttl_at_90d' })
```

The `partnerQuotes` TTL uses `expireAfterSeconds: 0` because each doc carries its
own `expiresAt`; the `partnerApiEvents` TTL keeps 90 days. The
`partner_quote` / `partner_pi` indexes back the idempotent-replay and
one-payment-one-shipment lookups on the create path.

### Enabling (fail-closed, like SESSION_SECRET / PAYMENT_BINDING_ENABLED)

1. Set **`PARTNER_API_SECRET`** to any non-empty value (master switch). While it
   is unset, every `/api/partner/*` route returns 404 — the feature does not
   exist, so deploying the code changes nothing.
2. Optional: `PARTNER_PICKUP_NOTIFY_EMAIL` (where pickup & needs-review notices
   go; defaults to `SITE.email`). `NEXT_PUBLIC_BASE_URL` must be the site's own
   origin (already set) — the partner routes call the carrier rate/label routes
   over internal HTTP, exactly as `shipping/submit` does.
3. Create the indexes above.
4. Admin → **Partners** → issue a credential; copy the one-time secret and give
   the `keyId` + secret to the partner (they send them as `X-Partner-Id` /
   `X-Partner-Secret`). Deactivate or rotate from the same screen.
