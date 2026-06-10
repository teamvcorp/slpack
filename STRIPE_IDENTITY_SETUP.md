# Stripe Identity Verification — Setup Guide (for an AI coding agent)

> **Goal:** Add "verify a user's government ID + selfie via Stripe Identity" to a project.
> Stripe collects and stores the sensitive ID/SSN **client-side**; your server only ever
> receives and stores the *result* (`verified` flag, timestamp) and the **last 4 digits**
> of the ID number. The full ID/SSN never touches your backend.
>
> This guide is written so an AI agent can replicate the flow. The reference
> implementation is **Next.js (App Router) + MongoDB + Auth.js (next-auth)**. If the
> target project uses a different stack, keep the **flow + Stripe calls** identical and
> swap the three adaptation points called out in **§7**.

---

## 1. How it works (the flow)

```
User clicks "Verify my identity"
        │
        ▼
POST /api/identity/start ───────────► Stripe: create VerificationSession
        │                              (type: "document", metadata.userId, return_url)
        │ store session.id on user
        ▼
Redirect browser to session.url  (Stripe-hosted ID + selfie capture)
        │
        ▼
User finishes → Stripe redirects to return_url (?identity=done)
        │
        ├──► (A) Browser calls GET /api/identity/status → retrieve session,
        │         if verified persist {identityVerified, last4}
        │
        └──► (B) Stripe sends webhook identity.verification_session.verified
                  → POST /api/identity/webhook persists the same (covers users
                    who close the tab before the redirect)
```

Two confirmation paths (status check **and** webhook) make it robust: the webhook is the
source of truth; the return-url status check gives instant UI feedback.

---

## 2. Prerequisites

- A Stripe account with **Identity** enabled (Dashboard → **Identity** → activate; live
  mode requires Stripe approval, but **test mode works immediately**).
- The `stripe` Node SDK: `npm install stripe`
- A signed-in user (your existing auth) and a user record you can write fields to.

---

## 3. Environment variables

```bash
# .env.local (or your secrets manager)
STRIPE_SECRET_KEY=sk_test_...                 # Stripe secret key (test or live)
STRIPE_IDENTITY_WEBHOOK_SECRET=whsec_...      # signing secret for the Identity webhook (see §6)
NEXTAUTH_URL=http://localhost:3000            # public base URL — used to build return_url
```

> Keep the Identity webhook secret **separate** from your payments webhook secret. They are
> different endpoints with different signing secrets. (The reference code falls back to
> `STRIPE_WEBHOOK_SECRET` if the Identity-specific one is unset, but you should set a
> dedicated one.)

---

## 4. Shared Stripe client

Create a lazily-initialized client so importing it never throws at build time (the key is
only needed at request time).

```ts
// lib/stripe.ts
import Stripe from 'stripe'

let instance: Stripe | null = null

function getStripe(): Stripe {
  if (instance) return instance
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) throw new Error('Please add STRIPE_SECRET_KEY to your environment')
  instance = new Stripe(key, { apiVersion: '2026-03-25.dahlia', typescript: true })
  return instance
}

// Proxy lets you call `stripe.identity.verificationSessions.create(...)` while
// deferring construction until first use.
export const stripe = new Proxy({} as Stripe, {
  get(_t, prop, recv) {
    const client = getStripe()
    const value = Reflect.get(client, prop, recv)
    return typeof value === 'function' ? value.bind(client) : value
  },
})
```

> `apiVersion` is pinned to what this project uses. It's safe to omit `apiVersion` to use
> your SDK's default, or bump it to the latest your SDK supports.

---

## 5. The three API routes

### 5a. Start a verification session — `POST /api/identity/start`

```ts
// app/api/identity/start/route.ts
import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'          // ⟵ adaptation point (§7.1)
import { stripe } from '@/lib/stripe'
import { getDb } from '@/lib/mongodb'      // ⟵ adaptation point (§7.2)
import { ObjectId } from 'mongodb'

function baseUrl(): string {
  return (process.env.NEXTAUTH_URL || 'http://localhost:3000').replace(/\/$/, '')
}

export async function POST() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const vs = await stripe.identity.verificationSessions.create({
      type: 'document',
      metadata: { userId: session.user.id },             // ⟵ critical: links webhook → user
      options: { document: { require_matching_selfie: true } },
      return_url: `${baseUrl()}/dashboard?identity=done`, // ⟵ where the user lands afterwards
    })

    const db = await getDb()
    await db.collection('users').updateOne(
      { _id: new ObjectId(session.user.id) },
      { $set: { stripeIdentitySessionId: vs.id, updatedAt: new Date() } },
    )

    return NextResponse.json({ url: vs.url }) // client redirects the browser to this
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Stripe error'
    console.error('Identity start error:', message)
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
```

### 5b. Status check on return — `GET /api/identity/status`

Called by the client when the user returns from Stripe (`?identity=done`). Gives instant
UI feedback and persists the result if the webhook hasn't landed yet.

```ts
// app/api/identity/status/route.ts
import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { stripe } from '@/lib/stripe'
import { getDb } from '@/lib/mongodb'
import { ObjectId } from 'mongodb'

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = await getDb()
  const user = await db.collection('users').findOne(
    { _id: new ObjectId(session.user.id) },
    { projection: { stripeIdentitySessionId: 1, identityVerified: 1 } },
  )

  if (user?.identityVerified) {
    return NextResponse.json({ status: 'verified', identityVerified: true })
  }
  if (!user?.stripeIdentitySessionId) {
    return NextResponse.json({ status: 'none', identityVerified: false })
  }

  try {
    const vs = await stripe.identity.verificationSessions.retrieve(
      user.stripeIdentitySessionId,
      { expand: ['verified_outputs'] },
    )

    if (vs.status === 'verified') {
      const outputs = vs.verified_outputs as { id_number?: string | null } | null
      const idNumber = outputs?.id_number ?? null
      const last4 = idNumber ? idNumber.replace(/\D/g, '').slice(-4) : undefined

      await db.collection('users').updateOne(
        { _id: new ObjectId(session.user.id) },
        {
          $set: {
            identityVerified: true,
            identityVerifiedAt: new Date(),
            ...(last4 ? { idNumberLast4: last4 } : {}),
            updatedAt: new Date(),
          },
        },
      )
      return NextResponse.json({ status: 'verified', identityVerified: true })
    }

    return NextResponse.json({ status: vs.status, identityVerified: false })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Stripe error'
    console.error('Identity status error:', message)
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
```

### 5c. Webhook (source of truth) — `POST /api/identity/webhook`

Handles the case where the user closes the tab before redirecting back. **Must read the
raw request body** to verify the signature.

```ts
// app/api/identity/webhook/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { stripe } from '@/lib/stripe'
import { getDb } from '@/lib/mongodb'
import { ObjectId } from 'mongodb'
import type Stripe from 'stripe'

export async function POST(req: NextRequest) {
  const sig = req.headers.get('stripe-signature')
  const secret =
    process.env.STRIPE_IDENTITY_WEBHOOK_SECRET || process.env.STRIPE_WEBHOOK_SECRET
  if (!sig || !secret) {
    return NextResponse.json({ error: 'Missing signature or secret' }, { status: 400 })
  }

  const raw = await req.text() // ⟵ RAW body, not req.json() (signature needs exact bytes)
  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(raw, sig, secret)
  } catch {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  if (event.type === 'identity.verification_session.verified') {
    const vs = event.data.object as Stripe.Identity.VerificationSession
    try {
      const db = await getDb()
      const userId = vs.metadata?.userId

      let last4: string | undefined
      try {
        const full = await stripe.identity.verificationSessions.retrieve(vs.id, {
          expand: ['verified_outputs'],
        })
        const outputs = full.verified_outputs as { id_number?: string | null } | null
        const idNumber = outputs?.id_number ?? null
        if (idNumber) last4 = idNumber.replace(/\D/g, '').slice(-4)
      } catch {
        /* last 4 is optional */
      }

      const filter =
        userId && ObjectId.isValid(userId)
          ? { _id: new ObjectId(userId) }
          : { stripeIdentitySessionId: vs.id }

      await db.collection('users').updateOne(filter, {
        $set: {
          identityVerified: true,
          identityVerifiedAt: new Date(),
          ...(last4 ? { idNumberLast4: last4 } : {}),
          updatedAt: new Date(),
        },
      })
    } catch (err) {
      console.error('Identity webhook processing error:', err)
      // Still return 200 so Stripe doesn't retry forever on an internal error;
      // the return-url status check is the fallback.
    }
  }

  return NextResponse.json({ received: true })
}
```

> **Next.js note:** App Router route handlers already receive the raw body via
> `req.text()`, so no extra body-parser config is needed. On other frameworks you MUST
> disable JSON body parsing for this route and pass the raw bytes to `constructEvent`
> (see §7.3). Consider subscribing to `identity.verification_session.requires_input` and
> `...processing` too if you want to surface those states.

---

## 6. Stripe Dashboard configuration

1. **Identity** → ensure it's activated (test mode is instant).
2. **Developers → Webhooks → Add endpoint**:
   - URL: `https://YOUR_DOMAIN/api/identity/webhook`
   - Events: `identity.verification_session.verified` (add `...requires_input`,
     `...processing`, `...canceled` if you handle those states).
   - Copy the **Signing secret** → set as `STRIPE_IDENTITY_WEBHOOK_SECRET`.
3. **Local testing** with the Stripe CLI:
   ```bash
   stripe listen --forward-to localhost:3000/api/identity/webhook
   # copy the printed whsec_... into STRIPE_IDENTITY_WEBHOOK_SECRET, restart the dev server
   stripe trigger identity.verification_session.verified
   ```

---

## 7. Adaptation points (if not Next.js + MongoDB + next-auth)

**7.1 Auth** — replace `auth()` / `session.user.id` with however the target project
identifies the signed-in user. The only requirement: a stable user id you can put in
`metadata.userId` and write result fields back to.

**7.2 Database** — replace `getDb()` + `users.updateOne(...)` with the project's ORM/driver.
You need to persist these fields on the user (or a related table):

| Field | Type | Written by | Meaning |
|---|---|---|---|
| `stripeIdentitySessionId` | string | start | links user → Stripe session for status lookups |
| `identityVerified` | boolean | status, webhook | the result flag to gate features on |
| `identityVerifiedAt` | datetime | status, webhook | when verification completed |
| `idNumberLast4` | string (4) | status, webhook | last 4 of ID number — display only, **never** the full value |

**7.3 Raw webhook body** — `stripe.webhooks.constructEvent(rawBody, sig, secret)` needs the
**exact raw bytes**. Express: `express.raw({ type: 'application/json' })`. Other frameworks:
disable automatic JSON parsing for the webhook route only.

---

## 8. Client trigger (reference)

Minimal client usage: a button that starts the session and redirects, plus a return handler.

```tsx
'use client'
// Start verification
async function startVerification() {
  const res = await fetch('/api/identity/start', { method: 'POST' })
  const data = await res.json()
  if (!res.ok || !data.url) throw new Error(data.error || 'Could not start verification')
  window.location.href = data.url // Stripe-hosted flow
}

// On the return page, persist the result then refresh UI:
// const params = new URLSearchParams(window.location.search)
// if (params.get('identity') === 'done') {
//   fetch('/api/identity/status').finally(reloadUserState)
// }
```

---

## 9. Security & compliance notes

- **Never** store the full SSN / ID number. Only `id_number.slice(-4)` for display. Stripe
  is the system of record for the sensitive data.
- The webhook is the **source of truth**; treat the return-url `status` call as best-effort
  UX. Gate sensitive features on the persisted `identityVerified` flag, not on the redirect.
- Always verify the webhook signature against the **raw** body; reject on failure (400).
- `metadata.userId` is the only link from a webhook back to your user — set it on `create`.
- `require_matching_selfie: true` adds liveness/selfie matching; drop it for document-only.
- Webhook handler returns `200` even on internal DB errors so Stripe doesn't retry forever;
  rely on the status check + a manual/admin re-check as fallback. (Optionally log failures
  to a queue for reconciliation.)

---

## 10. Verification checklist

- [ ] `npm install stripe`; env vars set (§3).
- [ ] `lib/stripe.ts` added (§4).
- [ ] Three routes added and reachable (§5).
- [ ] User schema has the four fields (§7.2).
- [ ] Webhook endpoint created in Stripe + signing secret wired (§6).
- [ ] `stripe listen ... && stripe trigger identity.verification_session.verified`
      flips `identityVerified` to `true` in the DB.
- [ ] End-to-end in test mode: click verify → complete Stripe test flow → land on
      `?identity=done` → status route + webhook both persist the result.
- [ ] Confirm the full ID number is **not** stored anywhere — only `idNumberLast4`.
```

