# Reporting — the two bugs that emptied the Reports page (fixed 2026-09-09)

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

## Still outstanding — the same clock bug, on UPS

`lib/localDate.ts` was written to fix server-local date math on carrier
requests, but three UPS paths were missed in that sweep and are still wrong:

- `app/api/shipping/ups/route.ts` (~line 65)
- `app/api/shipping/intl/ups/route.ts` (~line 60)
- `yyyymmdd()` in `lib/shippingIntl.ts` (~line 91)

All build the carrier date stamp from server-local getters, so **every UPS rate
requested after 7 pm CT sends tomorrow's pickup date** and gets transit
commitments for the wrong day. The two rate routes also send `pickupTime` as a
UTC hour. This is the FedEx Saturday bug (see `saturday_delivery_notes.md`)
reproduced on UPS. The fix is mechanical but it changes carrier quoting, so it
needs its own commit and its own sandbox before/after.

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
