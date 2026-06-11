import client from '@/lib/mongodb';
import { ObjectId } from 'mongodb';

/**
 * Contacts model for the shipping desk: senders have many recipients
 * (one-to-many). A sender is the paying customer; each sender accumulates the
 * recipients they've shipped to. Both are upserted when a shipment is created.
 */

const SENDERS = 'senders';
const RECIPIENTS = 'recipients';

/** Minimized ID-verification result stored on a sender (never DOB/full ID number/images). */
export interface IdCheck {
  status: 'verified';
  method: 'stripe_identity' | 'manual';
  verificationSessionId?: string; // stripe path
  verifiedBy?: string;            // manual path (cashier)
  verifiedName?: string;
  address?: { line1: string; city: string; state: string; zip: string; country: string };
  over21?: boolean;
  idNumberLast4?: string;
  documentType?: string;
  issuingState?: string;
  documentExpiration?: string;    // 'YYYY-MM'
  verifiedAt: string;             // ISO
}

interface SenderDoc {
  _id?: ObjectId;
  name: string;
  phone: string;
  email: string;
  lastUsed: string;
  useCount: number;
  idCheck?: IdCheck;
}

interface RecipientDoc {
  _id?: ObjectId;
  senderId: ObjectId;
  name: string;
  phone: string;
  email: string;
  street: string;
  street2?: string;
  city: string;
  state: string;
  zip: string;
  country: string;
  lastUsed: string;
  useCount: number;
}

/** Shape returned to the client for typeahead. */
export interface ContactView {
  id: string;
  name: string;
  phone: string;
  email: string;
  street?: string;
  street2?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
  useCount: number;
  idCheck?: IdCheck;
}

function senders() {
  return client.db().collection<SenderDoc>(SENDERS);
}
function recipients() {
  return client.db().collection<RecipientDoc>(RECIPIENTS);
}

function termRegex(term: string): RegExp {
  return new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
}

function viewSender(s: SenderDoc): ContactView {
  return {
    id: String(s._id),
    name: s.name,
    phone: s.phone,
    email: s.email,
    useCount: s.useCount ?? 0,
    idCheck: s.idCheck,
  };
}
function viewRecipient(r: RecipientDoc): ContactView {
  return {
    id: String(r._id),
    name: r.name,
    phone: r.phone,
    email: r.email,
    street: r.street,
    street2: r.street2,
    city: r.city,
    state: r.state,
    zip: r.zip,
    country: r.country,
    useCount: r.useCount ?? 0,
  };
}

export async function searchSenders(q: string): Promise<ContactView[]> {
  await client.connect();
  const term = q.trim();
  const filter = term
    ? { $or: [{ name: termRegex(term) }, { phone: termRegex(term) }, { email: termRegex(term) }] }
    : {};
  const rows = await senders().find(filter).sort({ lastUsed: -1 }).limit(8).toArray();
  return rows.map(viewSender);
}

export async function searchRecipients(opts: { senderId?: string; q?: string }): Promise<ContactView[]> {
  await client.connect();
  const filter: Record<string, unknown> = {};
  if (opts.senderId && ObjectId.isValid(opts.senderId)) {
    filter.senderId = new ObjectId(opts.senderId);
  }
  const term = (opts.q ?? '').trim();
  if (term) {
    filter.$or = [{ name: termRegex(term) }, { phone: termRegex(term) }, { email: termRegex(term) }];
  }
  // With a sender selected we return the whole address book for that sender
  // (client filters as you type); a bare query is a global lookup.
  const limit = opts.senderId ? 100 : 8;
  const rows = await recipients().find(filter).sort({ lastUsed: -1 }).limit(limit).toArray();
  return rows.map(viewRecipient);
}

interface ContactInput {
  sender: { name?: string; phone?: string; email?: string };
  recipient: {
    name?: string; phone?: string; email?: string;
    street?: string; street2?: string; city?: string; state?: string; zip?: string; country?: string;
  };
}

/**
 * Upserts the sender, then the recipient under that sender. Match priority is
 * phone → email → name so re-shipping the same person updates one record
 * instead of creating duplicates. No-ops gracefully when names are blank.
 */
export async function upsertContacts(input: ContactInput): Promise<{ senderId: string | null; recipientId: string | null }> {
  await client.connect();
  const now = new Date().toISOString();

  const s = input.sender;
  const sName = (s.name ?? '').trim();
  if (!sName) return { senderId: null, recipientId: null };

  const sFilter = s.phone ? { phone: s.phone } : s.email ? { email: s.email } : { name: sName };
  await senders().updateOne(
    sFilter,
    {
      $set: { name: sName, phone: s.phone ?? '', email: s.email ?? '', lastUsed: now },
      $inc: { useCount: 1 },
    },
    { upsert: true }
  );
  const sDoc = await senders().findOne(sFilter);
  const senderId = sDoc?._id ?? null;
  if (!senderId) return { senderId: null, recipientId: null };

  const r = input.recipient;
  const rName = (r.name ?? '').trim();
  if (!rName) return { senderId: String(senderId), recipientId: null };

  const rMatch = r.phone ? { phone: r.phone } : r.email ? { email: r.email } : { name: rName };
  const rFilter = { senderId, ...rMatch };
  await recipients().updateOne(
    rFilter,
    {
      $set: {
        senderId,
        name: rName,
        phone: r.phone ?? '',
        email: r.email ?? '',
        street: r.street ?? '',
        street2: r.street2 ?? '',
        city: r.city ?? '',
        state: r.state ?? '',
        zip: r.zip ?? '',
        country: r.country ?? 'US',
        lastUsed: now,
      },
      $inc: { useCount: 1 },
    },
    { upsert: true }
  );
  const rDoc = await recipients().findOne(rFilter);

  return { senderId: String(senderId), recipientId: rDoc?._id ? String(rDoc._id) : null };
}

/**
 * Records an ID-verification result on a sender, creating the sender if this is
 * the first time we've seen them (verification can happen before any shipment).
 * Matches by phone → email → name, like upsertContacts.
 */
export async function attachIdCheckToSender(input: {
  name?: string;
  phone?: string;
  email?: string;
  idCheck: IdCheck;
}): Promise<{ senderId: string | null }> {
  await client.connect();
  const now = new Date().toISOString();
  const name = (input.name ?? input.idCheck.verifiedName ?? '').trim();
  if (!name && !input.phone && !input.email) return { senderId: null };

  const filter = input.phone
    ? { phone: input.phone }
    : input.email
      ? { email: input.email }
      : { name };

  // Only write fields we actually have, so we never blank out an existing
  // sender's name/phone/email when attaching a verification.
  const set: Record<string, unknown> = { lastUsed: now, idCheck: input.idCheck };
  if (name) set.name = name;
  if (input.phone) set.phone = input.phone;
  if (input.email) set.email = input.email;
  const setOnInsert: Record<string, unknown> = { useCount: 0 };
  if (!name) setOnInsert.name = '';
  if (!input.phone) setOnInsert.phone = '';
  if (!input.email) setOnInsert.email = '';

  await senders().updateOne(filter, { $set: set, $setOnInsert: setOnInsert }, { upsert: true });
  const doc = await senders().findOne(filter);
  return { senderId: doc?._id ? String(doc._id) : null };
}
