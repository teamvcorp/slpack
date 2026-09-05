"use client";

import { useState, useRef, useEffect } from 'react';
import IdentityVerifyModal from './IdentityVerifyModal';
import {
  missingParcelFields,
  describeMissing,
  withPackagingDims,
  type ParcelField,
} from '@/lib/parcelEntry';
import {
  SIGNATURE_LABELS,
  SIGNATURE_OPTIONS,
  type SignatureOption,
} from '@/lib/signatureOption';
import type { ShipmentInput } from '../types/shipping';
import type { IdCheck } from '@/lib/contacts';

/** A verification is current if verified and the document hasn't expired (by month). */
function idCheckValid(c?: IdCheck): boolean {
  if (!c || c.status !== 'verified') return false;
  if (!c.documentExpiration) return true;
  const now = new Date();
  const cur = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  return c.documentExpiration >= cur;
}
function formatExp(s?: string): string {
  if (!s) return '';
  const [y, mo] = s.split('-');
  return `${mo}/${y.slice(2)}`;
}

interface Props {
  onSubmit: (data: ShipmentInput) => void;
  loading: boolean;
  /** Notifies the page when the destination address becomes validated
   *  (by a carrier) or is manually approved by staff — drives the checkout
   *  guardrail. Resets to false whenever an address field is edited. */
  onAddressStatus?: (validated: boolean) => void;
  /** Fires on every form change so the page's shipment stays in sync with the
   *  live inputs — otherwise fields edited AFTER "Compare" (e.g. recipient
   *  name/phone) never reach the cart/label. */
  onChange?: (data: ShipmentInput) => void;
  /** Restored draft (see lib/shippingDraft.ts) — a shipment recovered after
   *  staff switched tabs, or dimensions handed over by the box calculator.
   *  Read once at mount; the page remounts via `key` to apply a new one. */
  initial?: ShipmentInput | null;
}

interface AddressResult {
  valid: boolean;
  status: string;
  addressType?: 'residential' | 'commercial' | 'unknown';
  suggested: { streetLine: string; city: string; state: string; zip: string; country: string } | null;
  messages: string[];
}

/** A sender or recipient contact returned for typeahead. */
interface ContactView {
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

const DEFAULTS: ShipmentInput = {
  originZip: '50588',
  originCountry: 'US',
  destStreet: '',
  destStreet2: '',
  destZip: '',
  destCity: '',
  destState: '',
  destCountry: 'US',
  destAttention: '',
  residential: true,
  // Deliberately ZERO, not a plausible package. A prefilled weight/size is never
  // flagged by `required`, so staff were quoting the previous customer's numbers
  // and we ate the difference on the carrier invoice. See lib/parcelEntry.ts.
  weightLbs: 0,
  lengthIn: 0,
  widthIn: 0,
  heightIn: 0,
  packaging: 'YOUR_PACKAGING',
  signature: 'none',
  declaredValueUSD: 0,
  customerName: '',
  customerPhone: '',
  customerEmail: '',
  senderName: '',
  senderPhone: '',
  senderEmail: '',
};

const COUNTRIES = [
  { code: 'US', label: 'United States' },
  { code: 'CA', label: 'Canada' },
  { code: 'MX', label: 'Mexico' },
  { code: 'GB', label: 'United Kingdom' },
  { code: 'DE', label: 'Germany' },
  { code: 'FR', label: 'France' },
  { code: 'AU', label: 'Australia' },
  { code: 'JP', label: 'Japan' },
  { code: 'CN', label: 'China' },
  { code: 'IN', label: 'India' },
];

export default function ShipmentForm({ onSubmit, loading, onAddressStatus, onChange, initial }: Props) {
  const [form, setForm] = useState<ShipmentInput>(() =>
    initial ? { ...DEFAULTS, ...initial } : DEFAULTS
  );
  const [validating, setValidating] = useState(false);
  const [zipLookup, setZipLookup] = useState(false);
  const [addrResult, setAddrResult] = useState<AddressResult | null>(null);
  const [addrError, setAddrError] = useState<string | null>(null);
  // Staff manually approved the address as-is (used when carriers can't confirm).
  const [addrApproved, setAddrApproved] = useState(false);

  // ── Package weight / dimensions ──────────────────────────────────────────
  // Raw text for the four numeric parcel fields, held ALONGSIDE the numeric form
  // state rather than derived from it. Rendering `form.weightLbs` directly would
  // round-trip every keystroke through parseFloat, so a half-typed "0." collapses
  // to 0 and the box blanks itself — making 0.5 lb impossible to enter.
  // Seeded from any restored draft, or the boxes would render EMPTY while the
  // form state holds real numbers — the raw text is the rendered value.
  const [parcelText, setParcelText] = useState<Record<ParcelField, string>>(() => {
    const seed = (n: number | undefined) => (Number(n) > 0 ? String(n) : '');
    return {
      weightLbs: seed(initial?.weightLbs),
      lengthIn: seed(initial?.lengthIn),
      widthIn: seed(initial?.widthIn),
      heightIn: seed(initial?.heightIn),
    };
  });
  // Fields flagged by the last blocked submit, so the eye lands on them.
  const [parcelMissing, setParcelMissing] = useState<ParcelField[]>([]);

  function setParcel(key: ParcelField, text: string) {
    setParcelText((prev) => ({ ...prev, [key]: text }));
    const n = parseFloat(text);
    set(key, Number.isFinite(n) && n > 0 ? n : 0);
    setParcelMissing((prev) => prev.filter((f) => f !== key));
  }

  // ── Sender typeahead + ID verification ───────────────────────────────────
  const [senderId, setSenderId] = useState<string | null>(null);
  const [senderIdCheck, setSenderIdCheck] = useState<IdCheck | undefined>(undefined);
  const [showVerify, setShowVerify] = useState(false);
  const [senderSug, setSenderSug] = useState<ContactView[]>([]);
  const [senderOpen, setSenderOpen] = useState(false);
  const [senderActive, setSenderActive] = useState(0);
  const senderBoxRef = useRef<HTMLDivElement>(null);
  const senderPhoneRef = useRef<HTMLInputElement>(null);
  const senderTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Recipient typeahead (scoped to the selected sender) ───────────────────
  const [recipList, setRecipList] = useState<ContactView[]>([]); // this sender's recipients
  const [recipSug, setRecipSug] = useState<ContactView[]>([]);
  const [recipOpen, setRecipOpen] = useState(false);
  const [recipActive, setRecipActive] = useState(0);
  const recipBoxRef = useRef<HTMLDivElement>(null);
  const recipPhoneRef = useRef<HTMLInputElement>(null);
  const recipTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (senderBoxRef.current && !senderBoxRef.current.contains(e.target as Node)) setSenderOpen(false);
      if (recipBoxRef.current && !recipBoxRef.current.contains(e.target as Node)) setRecipOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Keep the parent's shipment snapshot in sync with the live form, so fields
  // edited after "Compare" (recipient name/phone, etc.) still reach the label.
  useEffect(() => {
    // withPackagingDims here too, not just at submit: the page's snapshot feeds
    // the cart and the label, and its rate signature must match the one Compare
    // used or the stale-rate guard fires on a shipment nothing actually changed.
    onChange?.(withPackagingDims(form));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form]);

  // ── Sender search + apply ─────────────────────────────────────────────────
  async function searchSenders(q: string) {
    if (q.trim().length < 2) { setSenderSug([]); setSenderOpen(false); return; }
    try {
      const res = await fetch(`/api/contacts/senders?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      const list: ContactView[] = data.results ?? [];
      setSenderSug(list);
      setSenderActive(0);
      setSenderOpen(list.length > 0);
    } catch { setSenderSug([]); }
  }

  function handleSenderNameChange(value: string) {
    set('senderName', value);
    setSenderId(null); // editing the name de-selects any chosen sender
    setSenderIdCheck(undefined);
    if (senderTimer.current) clearTimeout(senderTimer.current);
    senderTimer.current = setTimeout(() => searchSenders(value), 200);
  }

  async function applySender(c: ContactView) {
    setForm((prev) => ({ ...prev, senderName: c.name, senderPhone: c.phone, senderEmail: c.email }));
    setSenderId(c.id);
    setSenderIdCheck(c.idCheck);
    setSenderSug([]);
    setSenderOpen(false);
    // Load this sender's recipients so the recipient field is ready.
    try {
      const res = await fetch(`/api/contacts/recipients?senderId=${encodeURIComponent(c.id)}`);
      const data = await res.json();
      setRecipList(data.results ?? []);
    } catch { setRecipList([]); }
  }

  // ── Recipient search (sender-scoped, else global) + apply ─────────────────
  function filterRecipients(q: string): ContactView[] {
    const term = q.trim().toLowerCase();
    const base = !term
      ? recipList
      : recipList.filter(
          (r) =>
            r.name.toLowerCase().includes(term) ||
            r.phone.includes(term) ||
            (r.email ?? '').toLowerCase().includes(term)
        );
    return base.slice(0, 8);
  }

  async function searchRecipientsGlobal(q: string) {
    if (q.trim().length < 2) { setRecipSug([]); setRecipOpen(false); return; }
    try {
      const res = await fetch(`/api/contacts/recipients?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      const list: ContactView[] = data.results ?? [];
      setRecipSug(list);
      setRecipActive(0);
      setRecipOpen(list.length > 0);
    } catch { setRecipSug([]); }
  }

  function handleRecipientNameChange(value: string) {
    set('customerName', value);
    if (senderId) {
      const list = filterRecipients(value);
      setRecipSug(list);
      setRecipActive(0);
      setRecipOpen(list.length > 0);
    } else {
      if (recipTimer.current) clearTimeout(recipTimer.current);
      recipTimer.current = setTimeout(() => searchRecipientsGlobal(value), 200);
    }
  }

  function applyRecipient(c: ContactView) {
    setForm((prev) => ({
      ...prev,
      customerName: c.name,
      customerPhone: c.phone,
      customerEmail: c.email,
      destStreet: c.street || prev.destStreet,
      destStreet2: c.street2 ?? prev.destStreet2,
      destCity: c.city || prev.destCity,
      destState: c.state || prev.destState,
      destZip: c.zip || prev.destZip,
      destCountry: c.country || prev.destCountry,
    }));
    setRecipSug([]);
    setRecipOpen(false);
    setAddrResult(null);
  }

  /** Shared keyboard nav for a typeahead: ↑/↓ move, Tab/Enter accept, Esc close. */
  function typeaheadKeyDown(
    e: React.KeyboardEvent,
    open: boolean,
    sug: ContactView[],
    active: number,
    setActive: (n: number) => void,
    apply: (c: ContactView) => void,
    nextRef: React.RefObject<HTMLInputElement | null>,
    close: () => void
  ) {
    if (!open || sug.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((active + 1) % sug.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((active - 1 + sug.length) % sug.length);
    } else if (e.key === 'Tab' && !e.shiftKey) {
      // Accept the best/active match and advance to the phone field.
      e.preventDefault();
      apply(sug[active]);
      nextRef.current?.focus();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      apply(sug[active]);
    } else if (e.key === 'Escape') {
      close();
    }
  }

  function set<K extends keyof ShipmentInput>(key: K, value: ShipmentInput[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    if (['destStreet', 'destZip', 'destCity', 'destState', 'destCountry'].includes(key as string)) {
      setAddrResult(null);
      setAddrError(null);
      // Editing the address invalidates any prior validation/approval.
      setAddrApproved(false);
      onAddressStatus?.(false);
    }
  }

  /** Staff override: mark the entered address as verified so checkout can proceed
   *  even when carrier validation is unavailable (e.g. UPS product not enabled). */
  function approveAddressAsEntered() {
    setAddrApproved(true);
    onAddressStatus?.(true);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    // Belt and braces alongside the inputs' `required`: a zero can still reach
    // here if the browser's native validation is bypassed, and quoting a package
    // we haven't measured is exactly the mistake this screen is meant to prevent.
    const missing = missingParcelFields(form);
    if (missing.length > 0) {
      setParcelMissing(missing);
      return;
    }
    setParcelMissing([]);
    onSubmit(withPackagingDims(form));
  }

  // Auto-populate city/state when ZIP is entered (UPS only — FedEx sandbox never returns suggested data)
  async function lookupZip(zip: string, country: string) {
    if (!zip || zip.length < 5) return;
    if (country !== 'US') return;
    setZipLookup(true);
    try {
      const res = await fetch('/api/shipping/ups/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ zip, country }),
      });
      const data = await res.json();
      const suggested = data?.suggested;
      if (suggested?.city || suggested?.state) {
        setForm((prev) => ({
          ...prev,
          destCity: suggested.city || prev.destCity,
          destState: suggested.state || prev.destState,
        }));
      }
    } catch {
      // silent — ZIP lookup is best-effort
    } finally {
      setZipLookup(false);
    }
  }

  async function handleValidateAddress() {
    if (!form.destZip) return;
    setValidating(true);
    setAddrResult(null);
    setAddrError(null);
    try {
      const body = JSON.stringify({
        streetLine: form.destStreet,
        city: form.destCity,
        state: form.destState,
        zip: form.destZip,
        country: form.destCountry,
      });

      const [fedexRes, upsRes] = await Promise.allSettled([
        fetch('/api/shipping/fedex/validate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
        }).then((r) => r.json()),
        fetch('/api/shipping/ups/validate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
        }).then((r) => r.json()),
      ]);

      const fedex = fedexRes.status === 'fulfilled' && !fedexRes.value?.error ? fedexRes.value : null;
      const ups = upsRes.status === 'fulfilled' && !upsRes.value?.error ? upsRes.value : null;

      const primary = (ups?.valid ? ups : null) ?? (fedex?.valid ? fedex : null) ?? ups ?? fedex;

      if (!primary) {
        setAddrError('Address validation unavailable from all carriers');
        return;
      }

      const allMessages: string[] = [
        ...(fedex?.messages ?? []),
        ...(ups?.messages ?? []),
      ].filter((m: string) => !m.includes('only available for') && !m.includes('SKIPPED'));

      // Auto-detect residential vs business (residential delivery carries a surcharge).
      // If either carrier flags residential, prefer that — safer than under-quoting.
      const types = [fedex?.addressType, ups?.addressType].filter(
        (t): t is 'residential' | 'commercial' => t === 'residential' || t === 'commercial'
      );
      const detected = types.includes('residential')
        ? 'residential'
        : types.includes('commercial')
          ? 'commercial'
          : 'unknown';
      if (detected === 'commercial') {
        set('residential', false);
        allMessages.push('Detected a business address — commercial rates applied.');
      } else if (detected === 'residential') {
        set('residential', true);
        allMessages.push('Detected a residential address — residential rates applied.');
      }

      const uniqueMessages = [...new Set(allMessages)];

      setAddrResult({ ...primary, messages: uniqueMessages });
      // A clean carrier validation counts as validated; otherwise staff can
      // apply the suggestion or approve as-entered to proceed.
      setAddrApproved(false);
      onAddressStatus?.(Boolean(primary.valid));
    } catch (err) {
      setAddrError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setValidating(false);
    }
  }

  function applysuggested() {
    if (!addrResult?.suggested) return;
    const s = addrResult.suggested;
    setForm((prev) => ({
      ...prev,
      destStreet: s.streetLine || prev.destStreet,
      destCity: s.city || prev.destCity,
      destState: s.state || prev.destState,
      destZip: s.zip || prev.destZip,
      destCountry: s.country || prev.destCountry,
    }));
    setAddrResult(null);
    // Applying the carrier's corrected address counts as validated.
    setAddrApproved(true);
    onAddressStatus?.(true);
  }

  const input =
    'w-full rounded-lg border border-navy/20 bg-white px-3 py-2 text-sm text-navy placeholder-navy/30 focus:border-blue focus:outline-none focus:ring-1 focus:ring-blue';
  const lbl = 'mb-1 block text-[11px] font-semibold uppercase tracking-wide text-navy/50';

  /** Parcel inputs turn red once a blocked submit has flagged them as empty. */
  function parcelInput(key: ParcelField): string {
    return parcelMissing.includes(key)
      ? `${input} border-red ring-1 ring-red`
      : input;
  }

  /** Renders a typeahead suggestion dropdown. */
  function suggestionList(
    sug: ContactView[],
    active: number,
    onPick: (c: ContactView) => void,
    emptyLabel?: string
  ) {
    return (
      <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-navy/10 bg-white shadow-lg">
        {sug.length === 0 ? (
          <p className="px-3 py-2 text-[11px] text-navy/40">{emptyLabel}</p>
        ) : (
          sug.map((entry, i) => (
            <button
              key={entry.id}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); onPick(entry); }}
              className={`flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-cream ${
                i === active ? 'bg-cream' : ''
              }`}
            >
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue/10 text-xs font-bold text-blue">
                {entry.name.charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0">
                <p className="truncate font-semibold text-navy">{entry.name}</p>
                <p className="truncate text-[11px] text-navy/50">
                  {[entry.city, entry.state, entry.zip].filter(Boolean).join(', ')}
                  {entry.phone ? ` · ${entry.phone}` : ''}
                  {entry.useCount > 1 ? ` · ${entry.useCount}×` : ''}
                </p>
              </div>
            </button>
          ))
        )}
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-xl border border-navy/10 bg-white p-5 shadow-sm"
    >
      <h2 className="mb-4 text-sm font-bold uppercase tracking-wider text-navy">
        Package &amp; Shipment Details
      </h2>

      {/* ── Row 1: Destination street + apt/suite ── */}
      <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-[1fr_220px]">
        <div>
          <label className={lbl}>Dest Street Address</label>
          <input
            className={input}
            value={form.destStreet}
            onChange={(e) => set('destStreet', e.target.value)}
            maxLength={100}
            placeholder="123 Main St"
          />
        </div>
        <div>
          <label className={lbl}>Apt / Suite (optional)</label>
          <input
            className={input}
            value={form.destStreet2 ?? ''}
            onChange={(e) => set('destStreet2', e.target.value)}
            maxLength={100}
            placeholder="Apt 4B"
          />
        </div>
      </div>

      {/* Attention line — printed on the label address (e.g. ATTN: dept/person) */}
      <div className="mb-3">
        <label className={lbl}>Attention (optional)</label>
        <input
          className={input}
          value={form.destAttention ?? ''}
          onChange={(e) => set('destAttention', e.target.value)}
          maxLength={35}
          placeholder="ATTN: Receiving Dept."
        />
      </div>

      {/* ── Row 2: ZIP / City / State / Country / Validate ── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <div>
          <label className={lbl}>Origin ZIP</label>
          <input
            className={`${input} cursor-not-allowed opacity-60`}
            value="50588"
            readOnly
          />
        </div>

        <div>
          <label className={lbl}>Dest ZIP</label>
          <div className="relative">
            <input
              className={input}
              value={form.destZip}
              onChange={(e) => set('destZip', e.target.value)}
              onBlur={(e) => lookupZip(e.target.value, form.destCountry)}
              maxLength={10}
              placeholder="90210"
              required
            />
            {zipLookup && (
              <span className="absolute right-2 top-2.5">
                <svg className="h-3.5 w-3.5 animate-spin text-blue" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
              </span>
            )}
          </div>
        </div>

        <div>
          <label className={lbl}>Dest City</label>
          <input
            className={input}
            value={form.destCity}
            onChange={(e) => set('destCity', e.target.value)}
            maxLength={60}
            placeholder="Beverly Hills"
          />
        </div>

        <div>
          <label className={lbl}>Dest State</label>
          <input
            className={input}
            value={form.destState}
            onChange={(e) => set('destState', e.target.value.toUpperCase())}
            maxLength={3}
            placeholder="CA"
          />
        </div>

        <div>
          <label className={lbl}>Country</label>
          <select
            className={input}
            value={form.destCountry}
            onChange={(e) => set('destCountry', e.target.value)}
          >
            {COUNTRIES.map((c) => (
              <option key={c.code} value={c.code}>{c.label}</option>
            ))}
          </select>
        </div>

        {/* Validate address button in the 6th column */}
        <div className="flex flex-col justify-end">
          <label className={lbl}>Address Check</label>
          <button
            type="button"
            onClick={handleValidateAddress}
            disabled={validating || !form.destZip}
            className="flex items-center justify-center gap-1.5 rounded-lg border border-navy/20 px-3 py-2 text-sm font-medium text-navy/70 transition-colors hover:bg-cream disabled:opacity-40"
          >
            {validating ? (
              <>
                <svg className="h-3.5 w-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
                Checking…
              </>
            ) : (
              <>✔ Validate</>
            )}
          </button>
        </div>
      </div>

      {/* ── Residential vs business — affects UPS/FedEx delivery surcharge ── */}
      <div className="mt-3 flex items-center gap-2">
        <span className={lbl + ' mb-0'}>Delivery type</span>
        <button
          type="button"
          onClick={() => set('residential', true)}
          className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-all ${
            form.residential
              ? 'border-green-600 bg-green-600 text-white shadow-sm'
              : 'border-navy/20 bg-white text-navy/60 hover:border-navy/40'
          }`}
        >
          🏠 Residential
        </button>
        <button
          type="button"
          onClick={() => set('residential', false)}
          className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-all ${
            !form.residential
              ? 'border-navy bg-navy text-white shadow-sm'
              : 'border-navy/20 bg-white text-navy/60 hover:border-navy/40'
          }`}
        >
          🏢 Business
        </button>
        <span className="text-[11px] text-navy/40">Residential adds a carrier surcharge</span>
      </div>

      {/* Address validation result banner */}
      {addrError && (
        <div className="mt-2 rounded-lg bg-red/10 px-3 py-2 text-xs text-red">
          Address validation unavailable: {addrError}
        </div>
      )}
      {addrResult && (
        <div
          className={`mt-2 rounded-lg px-4 py-3 text-xs ${
            addrResult.valid
              ? 'border border-green-200 bg-green-50'
              : 'border border-yellow-200 bg-yellow-50'
          }`}
        >
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className={`font-semibold ${addrResult.valid ? 'text-green-700' : 'text-yellow-700'}`}>
                {addrResult.valid ? '✔ Address validated' : '⚠ Address could not be fully validated'}
              </p>
              {addrResult.messages.map((m, i) => (
                <p key={i} className="mt-0.5 text-yellow-700">{m}</p>
              ))}
              {addrResult.suggested && (
                <p className="mt-1 text-navy/60">
                  Suggested:{' '}
                  <span className="font-medium text-navy">
                    {[addrResult.suggested.city, addrResult.suggested.state, addrResult.suggested.zip]
                      .filter(Boolean)
                      .join(', ')}
                  </span>
                </p>
              )}
            </div>
            {addrResult.suggested && (
              <button
                type="button"
                onClick={applysuggested}
                className="shrink-0 rounded-lg border border-navy/20 bg-white px-2 py-1 text-[11px] font-semibold text-navy/70 hover:bg-cream"
              >
                Apply
              </button>
            )}
          </div>
        </div>
      )}

      {/* Manual override: when carriers can't confirm, staff can approve as-entered
          so a label can still be made. Skipped once already validated/approved. */}
      {!addrApproved && (addrError || (addrResult && !addrResult.valid)) && (
        <div className="mt-2 flex items-center justify-between gap-3 rounded-lg border border-navy/15 bg-cream px-3 py-2">
          <span className="text-[11px] text-navy/60">
            Carrier couldn&apos;t confirm this address. Double-check it, then approve to continue.
          </span>
          <button
            type="button"
            onClick={approveAddressAsEntered}
            className="shrink-0 rounded-lg border border-navy/30 bg-white px-2.5 py-1 text-[11px] font-semibold text-navy/80 hover:bg-white"
          >
            ✓ Approve address as entered
          </button>
        </div>
      )}
      {addrApproved && (
        <div className="mt-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-[11px] font-semibold text-green-700">
          ✓ Address approved by staff — verified manually
        </div>
      )}

      {/* ── Package dimensions ── */}
      <div className="mt-3 grid grid-cols-3 gap-3 sm:grid-cols-6">
        <div>
          <label className={lbl}>Packaging</label>
          <select
            className={input}
            value={form.packaging ?? 'YOUR_PACKAGING'}
            onChange={(e) => set('packaging', e.target.value as ShipmentInput['packaging'])}
          >
            <option value="YOUR_PACKAGING">Own box</option>
            <option value="FEDEX_ENVELOPE">FedEx Envelope</option>
          </select>
        </div>
        <div>
          <label className={lbl}>
            Weight (lbs) <span className="text-red">*</span>
          </label>
          <input
            className={parcelInput('weightLbs')}
            type="number"
            min="0.1"
            step="0.1"
            value={parcelText.weightLbs}
            onChange={(e) => setParcel('weightLbs', e.target.value)}
            placeholder="0.0"
            required
          />
        </div>
        {/* FedEx-branded packaging has known dimensions — hide the inputs
            (values are retained in state for switching back to Own box). */}
        {form.packaging !== 'FEDEX_ENVELOPE' && (
          <>
            <div>
              <label className={lbl}>
                Length (in) <span className="text-red">*</span>
              </label>
              <input
                className={parcelInput('lengthIn')}
                type="number"
                min="1"
                step="0.5"
                value={parcelText.lengthIn}
                onChange={(e) => setParcel('lengthIn', e.target.value)}
                placeholder="0"
                required
              />
            </div>
            <div>
              <label className={lbl}>
                Width (in) <span className="text-red">*</span>
              </label>
              <input
                className={parcelInput('widthIn')}
                type="number"
                min="1"
                step="0.5"
                value={parcelText.widthIn}
                onChange={(e) => setParcel('widthIn', e.target.value)}
                placeholder="0"
                required
              />
            </div>
            <div>
              <label className={lbl}>
                Height (in) <span className="text-red">*</span>
              </label>
              <input
                className={parcelInput('heightIn')}
                type="number"
                min="1"
                step="0.5"
                value={parcelText.heightIn}
                onChange={(e) => setParcel('heightIn', e.target.value)}
                placeholder="0"
                required
              />
            </div>
          </>
        )}
        <div>
          <label className={lbl}>Signature</label>
          <select
            className={input}
            value={form.signature ?? 'none'}
            onChange={(e) => set('signature', e.target.value as SignatureOption)}
          >
            {SIGNATURE_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>{SIGNATURE_LABELS[opt]}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={lbl}>Value ($)</label>
          <input
            className={input}
            type="number"
            min="0"
            step="0.01"
            value={form.declaredValueUSD}
            onChange={(e) => set('declaredValueUSD', parseFloat(e.target.value) || 0)}
          />
        </div>
      </div>
      {(form.signature ?? 'none') !== 'none' && (
        <p className="mt-2 rounded-lg border border-navy/15 bg-cream px-3 py-2 text-[11px] text-navy/70">
          <strong>{SIGNATURE_LABELS[form.signature ?? 'none']}</strong> — UPS and FedEx charge a fee
          for this, and it is <strong>already included</strong> in the prices shown below. USPS and
          DHL quotes are unaffected. Re-compare after changing this.
        </p>
      )}
      {/* Blocked submit — the carrier bills on the real parcel, so quoting an
          unmeasured one is money out the door. */}
      {parcelMissing.length > 0 && (
        <p className="mt-2 rounded-lg border border-red/30 bg-red/5 px-3 py-2 text-xs font-semibold text-red">
          Weigh and measure the package first — enter the {describeMissing(parcelMissing)}.
          Rates quoted on the wrong size or weight cost the shop the difference.
        </p>
      )}

      {form.packaging === 'FEDEX_ENVELOPE' && (
        <p className="mt-2 rounded-lg border border-[#FF6600]/30 bg-[#FF6600]/5 px-3 py-2 text-[11px] text-navy/70">
          <strong>FedEx Envelope</strong> — FedEx Express services only; the envelope rate
          applies up to 8 oz (heavier is billed at Pak rates). Declared value is capped at
          $100. Other carriers still quote as a parcel.
        </p>
      )}

      {/* ── Sender info (paying customer) ── */}
      <div className="mt-5 mb-2 flex items-center justify-between gap-3">
        <h2 className="text-sm font-bold uppercase tracking-wider text-navy">
          Sender (paying customer)
        </h2>
        {idCheckValid(senderIdCheck) ? (
          <span
            className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2.5 py-1 text-[11px] font-semibold text-green-700"
            title={`Verified ${senderIdCheck?.method === 'manual' ? 'at counter' : 'via Stripe Identity'} ${new Date(senderIdCheck!.verifiedAt).toLocaleDateString()}`}
          >
            ✓ ID verified{senderIdCheck?.documentExpiration ? ` · exp ${formatExp(senderIdCheck.documentExpiration)}` : ''}
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setShowVerify(true)}
            disabled={!form.senderName?.trim()}
            title={form.senderName?.trim() ? undefined : 'Enter the sender name first'}
            className="rounded-lg border border-blue/40 bg-blue/5 px-3 py-1.5 text-xs font-semibold text-blue transition-colors hover:bg-blue/10 disabled:cursor-not-allowed disabled:opacity-40"
          >
            🪪 Verify ID
          </button>
        )}
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="relative" ref={senderBoxRef}>
          <label className={lbl}>
            Sender Name
            <span className="ml-1 font-normal normal-case text-navy/30">— Tab to accept match</span>
          </label>
          <input
            className={input}
            value={form.senderName ?? ''}
            onChange={(e) => handleSenderNameChange(e.target.value)}
            onFocus={() => { if (senderSug.length > 0) setSenderOpen(true); }}
            onKeyDown={(e) =>
              typeaheadKeyDown(e, senderOpen, senderSug, senderActive, setSenderActive, applySender, senderPhoneRef, () => setSenderOpen(false))
            }
            maxLength={100}
            placeholder="John Doe"
            autoComplete="off"
          />
          {senderId && (
            <span className="absolute right-2 top-7 text-[10px] font-semibold text-green-600">✓ saved</span>
          )}
          {senderOpen && suggestionList(senderSug, senderActive, applySender)}
        </div>
        <div>
          <label className={lbl}>Sender Phone</label>
          <input
            ref={senderPhoneRef}
            className={input}
            type="tel"
            value={form.senderPhone ?? ''}
            onChange={(e) => set('senderPhone', e.target.value)}
            maxLength={20}
            placeholder="(712) 555-0199"
          />
        </div>
        <div>
          <label className={lbl}>Sender Email</label>
          <input
            className={input}
            type="email"
            value={form.senderEmail ?? ''}
            onChange={(e) => set('senderEmail', e.target.value)}
            maxLength={200}
            placeholder="john@example.com"
          />
          <p className="mt-1 text-[10px] text-navy/40">Used for the credit-card receipt.</p>
        </div>
      </div>

      {/* ── Recipient info (ship-to) ── */}
      <h2 className="mt-5 mb-2 text-sm font-bold uppercase tracking-wider text-navy">
        Recipient (ship-to)
        {senderId && recipList.length > 0 && (
          <span className="ml-2 font-normal normal-case text-navy/40">
            {recipList.length} saved for this sender
          </span>
        )}
      </h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="relative" ref={recipBoxRef}>
          <label className={lbl}>
            Recipient Name
            <span className="ml-1 font-normal normal-case text-navy/30">— Tab to accept match</span>
          </label>
          <input
            className={input}
            value={form.customerName}
            onChange={(e) => handleRecipientNameChange(e.target.value)}
            onFocus={() => {
              if (senderId) {
                const list = filterRecipients(form.customerName);
                setRecipSug(list);
                setRecipOpen(list.length > 0);
              } else if (recipSug.length > 0) {
                setRecipOpen(true);
              }
            }}
            onKeyDown={(e) =>
              typeaheadKeyDown(e, recipOpen, recipSug, recipActive, setRecipActive, applyRecipient, recipPhoneRef, () => setRecipOpen(false))
            }
            maxLength={100}
            placeholder="Jane Smith"
            autoComplete="off"
            required
          />
          {recipOpen && suggestionList(
            recipSug,
            recipActive,
            applyRecipient,
            senderId ? 'No saved recipients match — will be added as new.' : undefined
          )}
        </div>
        <div>
          <label className={lbl}>Recipient Phone</label>
          <input
            ref={recipPhoneRef}
            className={input}
            type="tel"
            value={form.customerPhone}
            onChange={(e) => set('customerPhone', e.target.value)}
            maxLength={20}
            placeholder="(712) 555-0100"
            required
          />
        </div>
        <div>
          <label className={lbl}>Recipient Email</label>
          <input
            className={input}
            type="email"
            value={form.customerEmail}
            onChange={(e) => set('customerEmail', e.target.value)}
            maxLength={200}
            placeholder="jane@example.com"
          />
          <p className="mt-1 text-[10px] text-navy/40">Tracking notification will be sent here.</p>
        </div>
      </div>

      <div className="mt-4 flex items-center gap-4">
        <button
          type="submit"
          disabled={loading}
          className="rounded-lg bg-blue px-7 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-navy active:scale-95 disabled:opacity-50"
        >
          {loading ? (
            <span className="flex items-center gap-2">
              <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
              Fetching Rates…
            </span>
          ) : (
            'Compare All Carriers'
          )}
        </button>
        <p className="text-xs text-navy/40">
          Queries FedEx, UPS, USPS, and DHL simultaneously
        </p>
      </div>

      {showVerify && (
        <IdentityVerifyModal
          sender={{
            name: form.senderName ?? '',
            phone: form.senderPhone ?? '',
            email: form.senderEmail ?? '',
          }}
          onClose={() => setShowVerify(false)}
          onVerified={(idCheck) => {
            setSenderIdCheck(idCheck);
            setShowVerify(false);
            if (idCheck.verifiedName && !(form.senderName ?? '').trim()) {
              setForm((prev) => ({ ...prev, senderName: idCheck.verifiedName as string }));
            }
          }}
        />
      )}
    </form>
  );
}
