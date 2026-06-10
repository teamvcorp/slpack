import client from '@/lib/mongodb';
import { ObjectId } from 'mongodb';

/**
 * Contacts model for the shipping desk: senders have many recipients
 * (one-to-many). A sender is the paying customer; each sender accumulates the
 * recipients they've shipped to. Both are upserted when a shipment is created.
 */

const SENDERS = 'senders';
const RECIPIENTS = 'recipients';

interface SenderDoc {
  _id?: ObjectId;
  name: string;
  phone: string;
  email: string;
  lastUsed: string;
  useCount: number;
}

interface RecipientDoc {
  _id?: ObjectId;
  senderId: ObjectId;
  name: string;
  phone: string;
  email: string;
  street: string;
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
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
  useCount: number;
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
  return { id: String(s._id), name: s.name, phone: s.phone, email: s.email, useCount: s.useCount ?? 0 };
}
function viewRecipient(r: RecipientDoc): ContactView {
  return {
    id: String(r._id),
    name: r.name,
    phone: r.phone,
    email: r.email,
    street: r.street,
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
    street?: string; city?: string; state?: string; zip?: string; country?: string;
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
