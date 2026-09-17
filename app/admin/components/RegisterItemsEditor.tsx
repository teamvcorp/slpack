"use client";

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  MAX_ITEM_PRICE_USD,
  MAX_NAME_LENGTH,
  RECEIPT_SAFE_NAME_LENGTH,
  UNCATEGORIZED_LABEL,
  type RegisterCategory,
} from '@/lib/registerCatalog';

/**
 * Register item editor — add, edit, remove, group and reorder the things the
 * register sells, without anyone having to open the Stripe Dashboard.
 *
 * Items live in Stripe (identity + price); the grouping/order lives in our
 * settings collection. Those are saved by two different buttons on purpose:
 * an item edit is one Stripe write, while a reorder is a single document write
 * covering the whole grid, so batching them would make a half-failure ambiguous.
 *
 * Follows the shape of PackingPricingCard: fetch with no-store, string form
 * state, inline ok/err banner, disabled-while-saving.
 */

interface AdminItem {
  id: string;
  name: string;
  description: string | null;
  priceId: string | null;
  unitAmountUSD: number | null;
  active: boolean;
}

type Msg = { kind: 'ok' | 'err'; text: string } | null;

const money = (n: number) => `$${n.toFixed(2)}`;
/** Non-ASCII survives the screen but often garbles on the thermal printer. */
const hasNonAscii = (s: string) => /[^\x20-\x7E]/.test(s);

export default function RegisterItemsEditor() {
  const [items, setItems] = useState<AdminItem[]>([]);
  const [categories, setCategories] = useState<RegisterCategory[]>([]);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [accountId, setAccountId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<Msg>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [savingLayout, setSavingLayout] = useState(false);
  const [layoutDirty, setLayoutDirty] = useState(false);

  // New-item form
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newPrice, setNewPrice] = useState('');
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      const [itemsRes, catRes] = await Promise.all([
        fetch('/api/admin/register/items', { cache: 'no-store' }),
        fetch('/api/admin/register/catalog', { cache: 'no-store' }),
      ]);
      const itemsData = await itemsRes.json().catch(() => ({}));
      if (!itemsRes.ok) throw new Error(itemsData.error ?? `Server error ${itemsRes.status}`);
      setItems(itemsData.items ?? []);
      setAccountId(itemsData.accountId ?? '');

      if (catRes.ok) {
        const catData = await catRes.json().catch(() => ({}));
        setCategories(Array.isArray(catData.categories) ? catData.categories : []);
        setUpdatedAt(catData.updatedAt ?? null);
      }
      setLayoutDirty(false);
    } catch (err) {
      setMsg({ kind: 'err', text: err instanceof Error ? err.message : 'Failed to load items.' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  /** Ids placed in some category; everything else renders under "Other". */
  const placed = useMemo(
    () => new Set(categories.flatMap((c) => c.productIds)),
    [categories]
  );
  const uncategorized = useMemo(
    () => items.filter((i) => !placed.has(i.id)).map((i) => i.id),
    [items, placed]
  );

  // ── Item mutations (Stripe) ───────────────────────────────────────────────

  async function saveItem(id: string, patch: { name: string; description: string; priceUSD: string }) {
    setBusyId(id);
    setMsg(null);
    try {
      const res = await fetch(`/api/admin/register/items/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'x-request-id': crypto.randomUUID() },
        body: JSON.stringify({ name: patch.name, description: patch.description, priceUSD: patch.priceUSD }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `Server error ${res.status}`);
      setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...data.item } : i)));
      setMsg({ kind: 'ok', text: `Saved "${data.item?.name ?? patch.name}".` });
    } catch (err) {
      setMsg({ kind: 'err', text: err instanceof Error ? err.message : 'Failed to save.' });
    } finally {
      setBusyId(null);
    }
  }

  async function archiveItem(item: AdminItem) {
    if (
      !window.confirm(
        `Remove "${item.name}" from the register?\n\nPast sales and reports keep showing it correctly — it just stops appearing as a button.`
      )
    )
      return;
    setBusyId(item.id);
    setMsg(null);
    try {
      const res = await fetch(`/api/admin/register/items/${encodeURIComponent(item.id)}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `Server error ${res.status}`);
      setItems((prev) => prev.filter((i) => i.id !== item.id));
      setCategories((prev) => prev.map((c) => ({ ...c, productIds: c.productIds.filter((p) => p !== item.id) })));
      setMsg({ kind: 'ok', text: `Removed "${item.name}".` });
    } catch (err) {
      setMsg({ kind: 'err', text: err instanceof Error ? err.message : 'Failed to remove.' });
    } finally {
      setBusyId(null);
    }
  }

  async function createItem() {
    setCreating(true);
    setMsg(null);
    try {
      const res = await fetch('/api/admin/register/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName, description: newDesc, priceUSD: newPrice }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `Server error ${res.status}`);
      setItems((prev) => [...prev, data.item].sort((a, b) => a.name.localeCompare(b.name)));
      setNewName('');
      setNewDesc('');
      setNewPrice('');
      setMsg({ kind: 'ok', text: `Added "${data.item.name}".` });
    } catch (err) {
      setMsg({ kind: 'err', text: err instanceof Error ? err.message : 'Failed to add item.' });
    } finally {
      setCreating(false);
    }
  }

  // ── Layout edits (local until Save layout) ────────────────────────────────
  // Reordering is free until saved: every move is an array splice, and the whole
  // grid goes back as ONE document write.

  function mutate(fn: (draft: RegisterCategory[]) => RegisterCategory[]) {
    setCategories((prev) => fn(prev.map((c) => ({ ...c, productIds: [...c.productIds] }))));
    setLayoutDirty(true);
  }

  function addCategory() {
    const name = window.prompt('Category name (e.g. Packing supplies)')?.trim();
    if (!name) return;
    if (categories.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
      setMsg({ kind: 'err', text: `There is already a category named "${name}".` });
      return;
    }
    mutate((d) => [...d, { id: crypto.randomUUID(), name, productIds: [] }]);
  }

  function renameCategory(id: string) {
    const current = categories.find((c) => c.id === id);
    const name = window.prompt('Category name', current?.name ?? '')?.trim();
    if (!name) return;
    mutate((d) => d.map((c) => (c.id === id ? { ...c, name } : c)));
  }

  function deleteCategory(id: string) {
    const cat = categories.find((c) => c.id === id);
    const n = cat?.productIds.length ?? 0;
    if (n > 0 && !window.confirm(`Delete "${cat?.name}"? Its ${n} item${n === 1 ? '' : 's'} will move to ${UNCATEGORIZED_LABEL}.`))
      return;
    mutate((d) => d.filter((c) => c.id !== id));
  }

  function moveCategory(id: string, delta: number) {
    mutate((d) => {
      const i = d.findIndex((c) => c.id === id);
      const j = i + delta;
      if (i < 0 || j < 0 || j >= d.length) return d;
      [d[i], d[j]] = [d[j], d[i]];
      return d;
    });
  }

  /** Move a product into a category (or out, when categoryId is ''). */
  function assign(productId: string, categoryId: string) {
    mutate((d) => {
      const stripped = d.map((c) => ({ ...c, productIds: c.productIds.filter((p) => p !== productId) }));
      if (!categoryId) return stripped;
      return stripped.map((c) => (c.id === categoryId ? { ...c, productIds: [...c.productIds, productId] } : c));
    });
  }

  function moveItem(categoryId: string, productId: string, to: number | 'up' | 'down') {
    mutate((d) =>
      d.map((c) => {
        if (c.id !== categoryId) return c;
        const ids = [...c.productIds];
        const i = ids.indexOf(productId);
        if (i < 0) return c;
        let j: number;
        if (to === 'up') j = i - 1;
        else if (to === 'down') j = i + 1;
        else j = to;
        if (j < 0 || j >= ids.length) return c;
        ids.splice(i, 1);
        ids.splice(j, 0, productId);
        return { ...c, productIds: ids };
      })
    );
  }

  async function saveLayout() {
    setSavingLayout(true);
    setMsg(null);
    try {
      const res = await fetch('/api/admin/register/catalog', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ categories, ifUpdatedAt: updatedAt }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `Server error ${res.status}`);
      setUpdatedAt(data.updatedAt ?? null);
      setLayoutDirty(false);
      setMsg({ kind: 'ok', text: 'Layout saved. The register updates on its next load.' });
    } catch (err) {
      setMsg({ kind: 'err', text: err instanceof Error ? err.message : 'Failed to save layout.' });
    } finally {
      setSavingLayout(false);
    }
  }

  async function resetLayout() {
    if (!window.confirm('Clear all categories? Items go back to one alphabetical grid.')) return;
    setSavingLayout(true);
    try {
      const res = await fetch('/api/admin/register/catalog', { method: 'DELETE' });
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      setCategories([]);
      setUpdatedAt(null);
      setLayoutDirty(false);
      setMsg({ kind: 'ok', text: 'Grouping cleared.' });
    } catch (err) {
      setMsg({ kind: 'err', text: err instanceof Error ? err.message : 'Failed to reset.' });
    } finally {
      setSavingLayout(false);
    }
  }

  if (loading) return <p className="mt-6 text-sm text-navy/40">Loading items…</p>;

  return (
    <div className="mt-6 space-y-6">
      {msg && (
        <p
          className={`rounded-lg px-3 py-2 text-sm ${
            msg.kind === 'ok' ? 'bg-green-50 text-green-700' : 'bg-red/10 text-red'
          }`}
        >
          {msg.text}
        </p>
      )}

      {/* ── Items ─────────────────────────────────────────────────────────── */}
      <section className="rounded-2xl border border-navy/10 bg-white p-6 shadow-sm">
        <h2 className="text-base font-semibold text-navy">Items</h2>
        <p className="mt-0.5 text-xs text-navy/50">
          Name, description and price. Changing a price affects carts started after the change —
          a sale already in progress keeps the price the cashier quoted.
        </p>

        <div className="mt-4 space-y-3">
          {items.length === 0 && <p className="text-sm text-navy/40">No items yet. Add one below.</p>}
          {items.map((item) => (
            <ItemRow
              // Keyed on the server's own values: when a save returns (new price
              // id, canonicalized name) the key changes and the row remounts with
              // fresh defaults. Typing doesn't change these, so an in-progress
              // edit is never interrupted. This replaces a setState-in-effect sync.
              key={`${item.id}:${item.name}:${item.description ?? ''}:${item.unitAmountUSD ?? ''}`}
              item={item}
              busy={busyId === item.id}
              categories={categories}
              currentCategoryId={categories.find((c) => c.productIds.includes(item.id))?.id ?? ''}
              onAssign={(catId) => assign(item.id, catId)}
              onSave={(patch) => saveItem(item.id, patch)}
              onArchive={() => archiveItem(item)}
            />
          ))}
        </div>

        {/* New item */}
        <div className="mt-6 rounded-xl border border-navy/10 bg-cream p-4">
          <h3 className="text-sm font-semibold text-navy">Add an item</h3>
          <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_120px_auto]">
            <input
              aria-label="New item name"
              placeholder="Name"
              maxLength={MAX_NAME_LENGTH}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="rounded-lg border border-navy/20 bg-white px-3 py-2 text-sm text-navy focus:border-blue focus:outline-none focus:ring-1 focus:ring-blue"
            />
            <input
              aria-label="New item description"
              placeholder="Description (optional)"
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              className="rounded-lg border border-navy/20 bg-white px-3 py-2 text-sm text-navy focus:border-blue focus:outline-none focus:ring-1 focus:ring-blue"
            />
            <input
              aria-label="New item price"
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              max={MAX_ITEM_PRICE_USD}
              placeholder="0.00"
              value={newPrice}
              onChange={(e) => setNewPrice(e.target.value)}
              className="rounded-lg border border-navy/20 bg-white px-3 py-2 text-sm text-navy focus:border-blue focus:outline-none focus:ring-1 focus:ring-blue"
            />
            <button
              type="button"
              onClick={createItem}
              disabled={creating || !newName.trim() || newPrice === ''}
              className="rounded-lg bg-blue px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-navy disabled:opacity-50"
            >
              {creating ? 'Adding…' : 'Add'}
            </button>
          </div>
          <NameWarnings name={newName} />
        </div>
      </section>

      {/* ── Layout ────────────────────────────────────────────────────────── */}
      <section className="rounded-2xl border border-navy/10 bg-white p-6 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-navy">Groups &amp; order</h2>
            <p className="mt-0.5 text-xs text-navy/50">
              Arrange the buttons. Sections appear on the register in this order; items not in a
              group show under &ldquo;{UNCATEGORIZED_LABEL}&rdquo; at the end.
            </p>
          </div>
          <button
            type="button"
            onClick={addCategory}
            className="shrink-0 rounded-lg border border-navy/20 px-3 py-2 text-sm font-medium text-navy/70 transition-colors hover:border-blue/40 hover:text-blue"
          >
            + Category
          </button>
        </div>

        <div className="mt-4 space-y-4">
          {categories.map((cat, ci) => (
            <div key={cat.id} className="rounded-xl border border-navy/10 p-4">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-navy">{cat.name}</h3>
                <div className="flex items-center gap-1">
                  <ArrowBtn label={`Move ${cat.name} up`} disabled={ci === 0} onClick={() => moveCategory(cat.id, -1)}>↑</ArrowBtn>
                  <ArrowBtn label={`Move ${cat.name} down`} disabled={ci === categories.length - 1} onClick={() => moveCategory(cat.id, 1)}>↓</ArrowBtn>
                  <button type="button" onClick={() => renameCategory(cat.id)} className="px-2 text-xs font-medium text-blue hover:underline">
                    Rename
                  </button>
                  <button type="button" onClick={() => deleteCategory(cat.id)} className="px-2 text-xs font-medium text-red hover:underline">
                    Delete
                  </button>
                </div>
              </div>

              {cat.productIds.length === 0 ? (
                <p className="mt-2 text-xs text-navy/40">
                  Empty — assign items using the dropdown on each item above.
                </p>
              ) : (
                <ol className="mt-2 space-y-1">
                  {cat.productIds.map((pid, i) => (
                    <li key={pid} className="flex items-center gap-2 text-sm text-navy/80">
                      <span className="w-6 shrink-0 text-right text-xs text-navy/40">{i + 1}.</span>
                      <span className="flex-1 truncate">{byId.get(pid)?.name ?? pid}</span>
                      {/* Move-to-position: arrows alone make a long move tedious. */}
                      <input
                        aria-label={`Position of ${byId.get(pid)?.name ?? pid}`}
                        type="number"
                        min={1}
                        max={cat.productIds.length}
                        defaultValue={i + 1}
                        key={`${pid}-${i}`}
                        onBlur={(e) => {
                          const n = Number(e.target.value);
                          if (Number.isFinite(n) && n >= 1 && n <= cat.productIds.length) {
                            moveItem(cat.id, pid, n - 1);
                          }
                        }}
                        className="w-14 rounded border border-navy/20 px-2 py-1 text-xs"
                      />
                      <ArrowBtn label="Move up" disabled={i === 0} onClick={() => moveItem(cat.id, pid, 'up')}>↑</ArrowBtn>
                      <ArrowBtn label="Move down" disabled={i === cat.productIds.length - 1} onClick={() => moveItem(cat.id, pid, 'down')}>↓</ArrowBtn>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          ))}

          {uncategorized.length > 0 && (
            <div className="rounded-xl border border-dashed border-navy/20 p-4">
              <h3 className="text-sm font-semibold text-navy/60">{UNCATEGORIZED_LABEL}</h3>
              <p className="mt-1 text-xs text-navy/40">
                Shown last on the register, alphabetically. Items added straight in Stripe land here.
              </p>
              <ul className="mt-2 flex flex-wrap gap-2">
                {uncategorized.map((id) => (
                  <li key={id} className="rounded-full bg-navy/5 px-3 py-1 text-xs text-navy/70">
                    {byId.get(id)?.name ?? id}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="mt-5 flex items-center gap-3">
          <button
            type="button"
            onClick={saveLayout}
            disabled={savingLayout || !layoutDirty}
            className="rounded-lg bg-blue px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-navy disabled:opacity-50"
          >
            {savingLayout ? 'Saving…' : layoutDirty ? 'Save layout' : 'Layout saved'}
          </button>
          <button
            type="button"
            onClick={resetLayout}
            disabled={savingLayout}
            className="rounded-lg border border-navy/20 px-4 py-2.5 text-sm font-medium text-navy/70 transition-colors hover:bg-cream disabled:opacity-50"
          >
            Clear grouping
          </button>
          {layoutDirty && <span className="text-xs text-amber-700">Unsaved changes</span>}
        </div>
      </section>

      {accountId && (
        <p className="text-[11px] text-navy/40">
          Items are Stripe products tagged <span className="font-mono">{accountId}</span>. This Stripe
          account is shared with another site; only products carrying this tag appear here.
        </p>
      )}
    </div>
  );
}

function ArrowBtn({
  children,
  label,
  disabled,
  onClick,
}: {
  children: React.ReactNode;
  label: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="rounded border border-navy/15 px-2 py-1 text-xs text-navy/60 transition-colors hover:border-blue/40 hover:text-blue disabled:opacity-30"
    >
      {children}
    </button>
  );
}

/** Advisory only — these print badly but are legitimate things to sell. */
function NameWarnings({ name }: { name: string }) {
  const long = name.length > RECEIPT_SAFE_NAME_LENGTH;
  const nonAscii = hasNonAscii(name);
  if (!long && !nonAscii) return null;
  return (
    <ul className="mt-2 space-y-0.5 text-[11px] text-amber-700">
      {long && <li>Over {RECEIPT_SAFE_NAME_LENGTH} characters — may wrap onto two lines on the receipt.</li>}
      {nonAscii && <li>Accents or emoji may not print correctly on the thermal printer.</li>}
    </ul>
  );
}

function ItemRow({
  item,
  busy,
  categories,
  currentCategoryId,
  onAssign,
  onSave,
  onArchive,
}: {
  item: AdminItem;
  busy: boolean;
  categories: RegisterCategory[];
  currentCategoryId: string;
  onAssign: (categoryId: string) => void;
  onSave: (patch: { name: string; description: string; priceUSD: string }) => void;
  onArchive: () => void;
}) {
  const [name, setName] = useState(item.name);
  const [description, setDescription] = useState(item.description ?? '');
  const [priceUSD, setPriceUSD] = useState(item.unitAmountUSD == null ? '' : item.unitAmountUSD.toFixed(2));

  const dirty =
    name !== item.name ||
    description !== (item.description ?? '') ||
    priceUSD !== (item.unitAmountUSD == null ? '' : item.unitAmountUSD.toFixed(2));

  return (
    <div className="rounded-xl border border-navy/10 p-3">
      <div className="grid gap-2 sm:grid-cols-[1fr_1fr_110px_auto_auto]">
        <input
          aria-label={`Name of ${item.name}`}
          value={name}
          maxLength={MAX_NAME_LENGTH}
          onChange={(e) => setName(e.target.value)}
          className="rounded-lg border border-navy/20 px-3 py-2 text-sm text-navy focus:border-blue focus:outline-none focus:ring-1 focus:ring-blue"
        />
        <input
          aria-label={`Description of ${item.name}`}
          value={description}
          placeholder="Description (optional)"
          onChange={(e) => setDescription(e.target.value)}
          className="rounded-lg border border-navy/20 px-3 py-2 text-sm text-navy focus:border-blue focus:outline-none focus:ring-1 focus:ring-blue"
        />
        <input
          aria-label={`Price of ${item.name}`}
          type="number"
          inputMode="decimal"
          min="0"
          step="0.01"
          max={MAX_ITEM_PRICE_USD}
          value={priceUSD}
          onChange={(e) => setPriceUSD(e.target.value)}
          className="rounded-lg border border-navy/20 px-3 py-2 text-sm text-navy focus:border-blue focus:outline-none focus:ring-1 focus:ring-blue"
        />
        <button
          type="button"
          onClick={() => onSave({ name, description, priceUSD })}
          disabled={busy || !dirty}
          className="rounded-lg bg-blue px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-navy disabled:opacity-40"
        >
          {busy ? '…' : 'Save'}
        </button>
        <button
          type="button"
          onClick={onArchive}
          disabled={busy}
          className="rounded-lg border border-red/30 px-3 py-2 text-sm font-medium text-red transition-colors hover:bg-red/5 disabled:opacity-40"
        >
          Remove
        </button>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-navy/40">
        <label className="flex items-center gap-1.5">
          Group:
          <select
            value={currentCategoryId}
            onChange={(e) => onAssign(e.target.value)}
            className="rounded border border-navy/20 px-2 py-1 text-[11px] text-navy/70"
          >
            <option value="">{UNCATEGORIZED_LABEL}</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        {item.unitAmountUSD != null && <span>Current: {money(item.unitAmountUSD)}</span>}
        {item.priceId == null && (
          <span className="text-red">No usable USD price — set one above to make it sellable.</span>
        )}
      </div>
      <NameWarnings name={name} />
    </div>
  );
}
