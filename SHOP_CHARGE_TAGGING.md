# Required: tag your Stripe charges with your shop ID

**Who this is for:** every shop processing payments through our shared Stripe platform
account. It's a small, one-time change to your checkout code.

**This does not change prices, fees, or anything a customer sees.** You are adding two
or three text labels to charges you already create. No amount, no currency, no payment
method changes.

---

## Why this is needed

Every shop on the platform charges into **one Stripe account**. When a payment arrives,
Stripe records the amount and the card — but nothing that says which shop earned it.

That means a charge with no shop tag **cannot be attributed, and therefore cannot be
paid out to you.** It sits in the platform balance as unidentified revenue. There is no
way to fix this after the fact: Stripe has no record of where the sale came from, so no
report can reconstruct it.

Once you're tagging, your charges roll up automatically into your payout. Everything
before that stays unattributed, so **the sooner this ships, the less revenue needs
sorting out by hand.**

---

## What to add

Stripe's `metadata` is a free-form bag of key/value strings on every charge. Add these:

| Key | Required | Value | Example |
|---|---|---|---|
| `shop_id` | **Yes** | The exact ID we assign you. Never change it. | `storm-lake-pack-ship` |
| `source` | **Yes** | Which part of your app took the payment | `register`, `shipping`, `terminal`, `online` |
| `surcharge_usd` | If you charge one | Processing fee the customer paid, 2 decimals | `"1.45"` |
| `connected_account` | Optional | Your `acct_…` if you know it | `acct_1ABC…` |

### Rules that will bite you if ignored

- **Values must be strings.** `surcharge_usd: 1.45` is rejected; `"1.45"` is correct.
- **`shop_id` is permanent.** It's the join key for all your historical revenue.
  Changing it orphans every earlier charge — those payments keep the old ID and silently
  drop out of your totals. That shows up as an unexplained shortfall, not an error.
  Don't derive it from a hostname, brand name, or anything you might rename. Hard-code
  the string we give you.
- Stripe allows 50 keys per object, 40 chars per key, 500 chars per value. You won't
  come close, but don't put anything large in there.
- **Never put customer personal data in metadata.** It's visible to everyone with
  Dashboard access and appears in exports.

---

## Where to add it

### Creating a PaymentIntent directly

```js
const paymentIntent = await stripe.paymentIntents.create({
  amount: 2450,
  currency: 'usd',
  metadata: {
    shop_id: 'your-assigned-id',   // ← add
    source: 'register',            // ← add
    surcharge_usd: '0.71',         // ← add if you surcharge
    // ...anything you already keep here is untouched
  },
});
```

### Using Checkout Sessions — read this one carefully

**Metadata on a Checkout Session does NOT reach the PaymentIntent.** They're separate
objects, and reporting reads the PaymentIntent. This is the single most common way this
gets implemented wrong, and it fails silently — your Session looks correctly tagged in
the Dashboard while every actual charge stays anonymous.

```js
const session = await stripe.checkout.sessions.create({
  mode: 'payment',
  line_items: [...],

  // This alone is NOT enough — it stays on the Session.
  metadata: { shop_id: 'your-assigned-id' },

  // THIS is what reporting reads:
  payment_intent_data: {
    metadata: {
      shop_id: 'your-assigned-id',
      source: 'online',
    },
  },
});
```

Keep both if you like — the Session copy is handy in the Dashboard — but
`payment_intent_data.metadata` is the one that counts.

### If you can't modify where the charge is created

Payment links, a third-party cart, an invoice — anywhere you don't control creation —
add the metadata afterward. **Metadata is writable even after a payment succeeds:**

```js
const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
await stripe.paymentIntents.update(paymentIntentId, {
  metadata: { ...pi.metadata, shop_id: 'your-assigned-id', source: 'online' },
});
```

Spread the existing metadata first — `update` replaces the whole object, so omitting the
spread wipes whatever was already there. A webhook on `payment_intent.succeeded` is a
good place for this.

---

## Verify it worked

Do this in **test mode** before deploying.

1. Run one real charge through **every** payment path in your app. A path you forget is
   invisible until someone notices a payout is short.
2. Open the charge in the Stripe Dashboard → **Payments** → click it → scroll to
   **Metadata**. Confirm `shop_id` and `source` are present and spelled exactly right.
3. Or check from code:

```js
const pi = await stripe.paymentIntents.retrieve('pi_xxx');
console.log(pi.metadata);
// → { shop_id: 'your-assigned-id', source: 'register', surcharge_usd: '0.71' }
```

4. Quick audit of recent charges to catch a path you missed:

```js
const charges = await stripe.charges.list({ limit: 100 });
const untagged = charges.data.filter((c) => !c.metadata?.shop_id);
console.log(`${untagged.length} of ${charges.data.length} untagged`);
untagged.forEach((c) => console.log(c.id, c.description));
```

Expect `0`. Anything else names the path still missing the tag.

---

## Refunds

Nothing to do. A refund links back to its original PaymentIntent, so it inherits that
charge's attribution automatically and reduces your total correctly. Don't try to tag
refunds separately.

---

## Checklist

- [ ] Received your assigned `shop_id` from the platform
- [ ] Added `shop_id` + `source` to every charge-creation site in your code
- [ ] Checkout Sessions use `payment_intent_data.metadata`, not just `metadata`
- [ ] Added `surcharge_usd` if you charge a processing fee
- [ ] Verified in test mode that every payment path produces a tagged charge
- [ ] The untagged-charge audit returns 0
- [ ] Deployed to production, and told the platform your go-live date so revenue before
      it can be reconciled by hand

Questions, or you don't have a `shop_id` yet — contact the platform operator before
deploying. A wrong `shop_id` is worse than a missing one: it credits your revenue to
another shop.
