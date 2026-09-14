# Sinch Fax — integration notes (2026-09-14)

Admin fax service: send a fax + browse a durable archive of outgoing + incoming
faxes, with an email alert on every inbound. Isolated/additive — no change to
shipping/register/reports. Feature is inert until the SINCH_* env vars are set.

## API (verified from the OpenAPI spec `fax.yaml`)

- **Base:** `https://fax.api.sinch.com/v3/projects/{SINCH_PROJECT_ID}`
- **Auth:** HTTP **Basic** `SINCH_KEY_ID:SINCH_KEY_SECRET` (what we use). OAuth2
  bearer (`https://auth.sinch.com/oauth2/token`) is a later hardening option.
- **Send:** `POST /faxes` — **multipart/form-data** with a `file` part plus form
  fields `to`, `from`, `headerText?`, `callbackUrl?`, `callbackUrlContentType`.
  ⚠️ A JSON `contentBase64` body is REJECTED (`400 "must submit at least one file
  or content URL"`) — verified against the live API. `contentUrl:[…]` (HTTPS URLs
  Sinch fetches) is the JSON alternative.
- **List:** `GET /faxes?direction=INBOUND|OUTBOUND&status=&createTime=&page=&pageSize=`.
- **Get one:** `GET /faxes/{id}`. **Download:** `GET /faxes/{id}/file.pdf`.
- **Fax object:** `id` (ULID), `direction`, `from`, `to`, `status`
  (PENDING/IN_PROGRESS/COMPLETED/FAILED), `numberOfPages`, `createTime`,
  `completedTime`, `errorType`, `errorMessage`, `price{amount,currencyCode}`, `hasFile`.
- **Webhook events** (one URL, keyed by `event`): `INCOMING_FAX` and `FAX_COMPLETED`,
  each `{ event, eventTime, fax:{…} }`. Inbound callback is set on the Fax **service**
  (dashboard); outbound uses the per-send `callbackUrl`. Notification IPs
  **34.232.249.173 / 44.226.9.173**; up to 16 retries w/ backoff. Media retained 13 months.

## Verified request/response reference (copy-paste; live-tested 2026-09-14)

`FAXBASE = https://fax.api.sinch.com/v3/projects/$SINCH_PROJECT_ID`
`AUTH = Basic base64(SINCH_KEY_ID:SINCH_KEY_SECRET)`  (header `Authorization: $AUTH`)

**Send (multipart — the ONLY shape that works; JSON contentBase64 is rejected):**
```
POST $FAXBASE/faxes            # Authorization only; DO NOT set Content-Type (FormData sets the boundary)
form fields: to=+1..., from=+1..., headerText=..., callbackUrl=..., callbackUrlContentType=application/json
file part:   file=@document.pdf  (application/pdf; also DOC/DOCX/TIF/JPG/TXT/PNG accepted)
-> 200 { "id":"01M2GW...", "direction":"OUTBOUND", "status":"IN_PROGRESS", "from":"+1...", "to":"+1..." }
```
Node: `const fd=new FormData(); fd.set('to',to); fd.set('from',from); fd.set('file', new Blob([new Uint8Array(buf)],{type:'application/pdf'}),'fax.pdf'); fetch(url,{method:'POST',headers:{Authorization:AUTH},body:fd})`

**Get one (poll for final status):**
```
GET $FAXBASE/faxes/{id}
-> 200 { id, direction, status:"COMPLETED", from, to, numberOfPages:1,
         createTime, completedTime, price:{amount:"0.045",currencyCode:"USD"}, hasFile:true }
```
Status flow: `PENDING → IN_PROGRESS → COMPLETED | FAILED` (a 1-page domestic fax completed in ~5 s at $0.045).

**Download the rendered pages:** `GET $FAXBASE/faxes/{id}/file.pdf` → 200 `application/pdf` (~23 KB/page).

**List:** `GET $FAXBASE/faxes?direction=INBOUND|OUTBOUND&status=&page=0&pageSize=50`
→ `{ faxes:[…], page, pageSize, totalItems, totalPages }` (Sinch holds BOTH directions).

**Delete stored content early:** `DELETE $FAXBASE/faxes/{id}/file` (else auto-purged at 13 months).

**Webhook payloads** (POST to your callback; `event` distinguishes them):
```
{ "event":"INCOMING_FAX",  "eventTime":"…", "fax":{ id, direction:"INBOUND",  from, to, numberOfPages, status } }
{ "event":"FAX_COMPLETED", "eventTime":"…", "fax":{ id, direction:"OUTBOUND", status, … } }
```
JSON when `callbackUrlContentType=application/json` (else multipart with the PDF attached). We treat it as a
trigger and re-fetch `GET /faxes/{id}` — so the exact envelope doesn't need trusting.

## Diagnostic endpoints (numbers + services)

- **Numbers owned by the project:** `GET https://numbers.api.sinch.com/v1/projects/$PROJECT/activeNumbers`
  → `{ activeNumbers:[{ phoneNumber, capability:["SMS","VOICE"], regionCode, money:{amount,currencyCode}, … }], totalSize }`.
  ⚠️ `capability` does **not** list FAX even when Fax is enabled — it is NOT a reliable fax check.
- **Fax services:** `GET $FAXBASE/services` → `{ services:[{ id, name, incomingWebhookUrl }] }`.
  A new account's default is empty until you configure a service; ours is "Default Service" with
  `incomingWebhookUrl = https://www.slpacknship.com/api/webhooks/fax?token=…`.
- **Available numbers to rent:** `GET https://numbers.api.sinch.com/v1/projects/$PROJECT/availableNumbers?regionCode=US&type=LOCAL`
  (a `capabilities=FAX` filter is **invalid → 400**; fax is enabled on the number's Voice config, not a rentable capability).

## Supported document formats

PDF, DOC, DOCX, TIF, JPG, TXT, PNG, plus HTML and a fetchable URL (`contentUrl`). We send PDF only.

## Error catalog (seen live)

| HTTP | message | cause / fix |
|---|---|---|
| 422 | "the number you set as from does not belong to you" | `from` number lacks Fax / isn't on a Fax service → enable Fax on the number's Voice config + assign to the service |
| 400 | "You must submit at least one file or content URL" | sent JSON `contentBase64` → must be multipart `file` (or `contentUrl`) |
| 422 | "phone number (to) is required" | missing `to` |
| 422 | "The destination country or number type … is not permitted" | invalid/blocked destination (e.g. 555 test numbers) |

## slpack implementation

- **`lib/sinchFax.ts`** — Basic-auth client: `sinchConfigured()`, `faxFromNumber()`,
  `sendFax()`, `getFax()`, `getFaxPdf()`, `listFaxes()`. Throws `SinchNotConfigured`
  until creds set. Server-only (never import into a client component).
- **`lib/faxLog.ts`** — Mongo archive `slpack.faxes`. `upsertFax()` (idempotent on
  `sinchId`, returns `{inserted}` so the webhook emails once), `listFaxes()`,
  `getFaxBlobUrl()`, `markFaxRead()`, `countUnreadInbound()`. **`blobUrl` is
  server-only** — excluded from `FAX_LIST_PROJECTION`, never sent to the browser.
- **`app/api/admin/fax/route.ts`** — GET list (`?direction=`, `{entries,unread}`) +
  POST send (multipart `to`+`file`+`headerText`; ≤4 MB PDF; forwards the file to
  Sinch as multipart; archives to Blob; `callbackUrl` =
  `${NEXT_PUBLIC_BASE_URL}/api/webhooks/fax?token=…`).
- **`app/api/admin/fax/[id]/file/route.ts`** — streams the PDF (Blob, else Sinch).
- **`app/api/admin/fax/[id]/route.ts`** — PATCH mark inbound read.
- **`app/api/webhooks/fax/route.ts`** — PUBLIC, `?token=`-guarded; re-fetches the fax
  from Sinch by id (payload is a trigger only), archives inbound PDF + emails
  `SITE.email`, updates outbound status. Always 200.
- **`app/admin/fax/page.tsx`** + AdminNav "Fax" — Inbox/Sent tabs, send form, View PDF.
- **`proxy.ts`** — `/api/webhooks/fax` added to `PUBLIC_PATHS`.

## Env (set in Vercel + `.env.local`)

| Var | Purpose |
|---|---|
| `SINCH_PROJECT_ID` | Sinch project (from Build dashboard) |
| `SINCH_KEY_ID` / `SINCH_KEY_SECRET` | Access key pair (Basic auth) |
| `SINCH_FAX_NUMBER` | The shop's fax-enabled number, used as `from` |
| `SINCH_FAX_WEBHOOK_TOKEN` | Unguessable secret in the webhook URL (fail-closed) |
| (reused) `BLOB_READ_WRITE_TOKEN`, `RESEND_API_KEY`, `NEXT_PUBLIC_BASE_URL` | archive / email / callback base |

## Owner setup steps

1. Create the Sinch account + a **fax-enabled number**. ⚠️ **New Sinch accounts have
   a ~1-day activation hold — live send/receive can't be tested until it clears.**
2. Set the env vars above (Vercel Production + `.env.local`).
3. In the Sinch dashboard, set the Fax **service** inbound callback to
   `https://www.slpacknship.com/api/webhooks/fax?token=<SINCH_FAX_WEBHOOK_TOKEN>`,
   content type **JSON**.
4. Create Atlas indexes (see reporting_notes.md):
   `db.faxes.createIndex({ sinchId:1 },{ unique:true })`,
   `db.faxes.createIndex({ direction:1, createdAt:-1 })`.

## VERIFIED LIVE (2026-09-14)

- **Auth** (Basic key id/secret) works for read + write. List shape confirmed
  `{ faxes:[…], page, pageSize, totalItems, totalPages }`.
- **Send** works via **multipart** (fixed in `lib/sinchFax.sendFax`): a real
  1-page self-fax went `IN_PROGRESS → COMPLETED`, 1 page, **$0.045 USD**.
- **`getFaxPdf`** works: `GET /faxes/{id}/file.pdf` → 200, valid `%PDF` (~23 KB
  rendered).
- **Number setup gotcha (this cost hours):** the `from` must be a number with
  **Fax** enabled AND assigned to a Fax **service**. In the Sinch dashboard:
  Numbers → the number → **Voice Configuration → enable Fax**, then Fax → Services →
  assign it. The Numbers API `capability` array may still read `[SMS, VOICE]` even
  after Fax is enabled — don't trust it; the authoritative check is a send. Until
  Fax is enabled, sends 422 with "the number you set as from does not belong to you".
- **Fax service** "Default Service" exists with `incomingWebhookUrl` pointing at
  our prod webhook. **Inbound still needs the fax feature DEPLOYED to prod** (the
  webhook route must exist at www.slpacknship.com) before an incoming fax is
  captured — until then Sinch's callback 404s.

## Still to verify (needs prod deploy)

- Inbound: fax the number → Sinch `INCOMING_FAX` → our prod webhook → archive +
  email → **Inbox** (unread) → PDF → opening marks read.
- The full admin route round-trip (UI send → Blob archive → Mongo mirror).
