# Sinch Fax — integration notes (2026-09-14)

Admin fax service: send a fax + browse a durable archive of outgoing + incoming
faxes, with an email alert on every inbound. Isolated/additive — no change to
shipping/register/reports. Feature is inert until the SINCH_* env vars are set.

## API (verified from the OpenAPI spec `fax.yaml`)

- **Base:** `https://fax.api.sinch.com/v3/projects/{SINCH_PROJECT_ID}`
- **Auth:** HTTP **Basic** `SINCH_KEY_ID:SINCH_KEY_SECRET` (what we use). OAuth2
  bearer (`https://auth.sinch.com/oauth2/token`) is a later hardening option.
- **Send:** `POST /faxes` — `{ to, contentBase64 | contentUrl:[…], from,
  headerText?, callbackUrl, callbackUrlContentType:'application/json' }`.
- **List:** `GET /faxes?direction=INBOUND|OUTBOUND&status=&createTime=&page=&pageSize=`.
- **Get one:** `GET /faxes/{id}`. **Download:** `GET /faxes/{id}/file.pdf`.
- **Fax object:** `id` (ULID), `direction`, `from`, `to`, `status`
  (PENDING/IN_PROGRESS/COMPLETED/FAILED), `numberOfPages`, `createTime`,
  `completedTime`, `errorType`, `errorMessage`, `price{amount,currencyCode}`, `hasFile`.
- **Webhook events** (one URL, keyed by `event`): `INCOMING_FAX` and `FAX_COMPLETED`,
  each `{ event, eventTime, fax:{…} }`. Inbound callback is set on the Fax **service**
  (dashboard); outbound uses the per-send `callbackUrl`. Notification IPs
  **34.232.249.173 / 44.226.9.173**; up to 16 retries w/ backoff. Media retained 13 months.

## slpack implementation

- **`lib/sinchFax.ts`** — Basic-auth client: `sinchConfigured()`, `faxFromNumber()`,
  `sendFax()`, `getFax()`, `getFaxPdf()`, `listFaxes()`. Throws `SinchNotConfigured`
  until creds set. Server-only (never import into a client component).
- **`lib/faxLog.ts`** — Mongo archive `slpack.faxes`. `upsertFax()` (idempotent on
  `sinchId`, returns `{inserted}` so the webhook emails once), `listFaxes()`,
  `getFaxBlobUrl()`, `markFaxRead()`, `countUnreadInbound()`. **`blobUrl` is
  server-only** — excluded from `FAX_LIST_PROJECTION`, never sent to the browser.
- **`app/api/admin/fax/route.ts`** — GET list (`?direction=`, `{entries,unread}`) +
  POST send (multipart `to`+`file`+`headerText`; ≤4 MB PDF; base64→Sinch; archive to
  Blob; `callbackUrl` = `${NEXT_PUBLIC_BASE_URL}/api/webhooks/fax?token=…`).
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

## To verify once the account is active

- Probe `lib/sinchFax` with a small Node script (like the USPS/partner probes) to
  confirm Basic auth + `sendFax` (esp. `contentBase64` shape) + `getFax`/`getFaxPdf`.
- Send to a Sinch test number → appears in **Sent**, status → COMPLETED, PDF opens.
- Trigger inbound → webhook → email → **Inbox** (unread) → PDF → opening marks read.

⚠️ **Unverified against the live API (account hold):** the exact `sendFax` body
(`contentBase64` as a bare string vs. array/object) and the webhook JSON envelope
are per the OpenAPI spec but not yet round-tripped. Probe before relying on it.
