"use client";

import { useEffect, useId, useImperativeHandle, useRef, useState, type Ref } from "react";
import { Plus, X, Undo2 } from "lucide-react";
import { ITEM_KINDS, lineTotalCents } from "@/lib/service";
import { parsePesoInput } from "@/lib/service-flow";
import {
  LineSaver, expandCatalogEntry, filterCatalog, isRowSavable, parseQty, quickAddEntries, shouldOfferPriceBook,
  type CatalogEntry, type EditorLine, type NewLine, type SaveOutcome, type SaverStatus,
} from "@/lib/service-lines";
import { Money } from "@/components/service-ui";
import { peso } from "@/lib/format";

/**
 * Inline line editor for quotes (job detail) and invoices: existing lines are always editable and autosave,
 * and an empty row sits at the bottom so adding a line is just typing. Tab: description → qty → price → type.
 */

export type LineAdapter = {
  addMany(lines: NewLine[], position?: number): Promise<{ ok: true; ids: string[]; positions: number[] } | { ok: false; error: string }>;
  update(id: string, patch: Record<string, unknown>): Promise<SaveOutcome>;
  remove(id: string): Promise<SaveOutcome>;
  /** Saves a free-typed line to the price book; returns the new entry. */
  saveToPriceBook?(line: NewLine): Promise<{ ok: true; entry: CatalogEntry } | { ok: false; error: string }>;
};

/** Pesos on the wire (the server converts once to centavos). */
export const toServerLine = (l: NewLine & { position?: number }) => ({
  kind: l.kind, description: l.description, qty: l.qty, unitPrice: l.unitPriceCents / 100, taxable: l.taxable,
  minutes: l.minutes, cost: l.costCents / 100, catalogItemId: l.catalogItemId, position: l.position,
});

const MUTED = { color: "var(--color-svc-text-faint)" } as const;
const DIM = { color: "var(--color-svc-text-dim)" } as const;
const FIELD = "input-svc !py-1.5 !px-2 text-[13px]";

/** Column templates are written out in full so Tailwind can see them. Stacked below the breakpoint. */
const GRID = {
  plain: "grid gap-2 grid-cols-2 min-[960px]:grid-cols-[minmax(0,1fr)_64px_116px_142px_92px_44px] min-[960px]:items-center",
  noType: "grid gap-2 grid-cols-2 min-[960px]:grid-cols-[minmax(0,1fr)_64px_116px_92px_44px] min-[960px]:items-center",
  cost: "grid gap-2 grid-cols-2 min-[1100px]:grid-cols-[minmax(0,1fr)_64px_116px_142px_104px_92px_44px] min-[1100px]:items-center",
  costNoType: "grid gap-2 grid-cols-2 min-[1100px]:grid-cols-[minmax(0,1fr)_64px_116px_104px_92px_44px] min-[1100px]:items-center",
} as const;

function gridFor(showType: boolean, showCost: boolean) {
  if (showCost) return showType ? GRID.cost : GRID.costNoType;
  return showType ? GRID.plain : GRID.noType;
}

/** Visible label on phones only; on wide screens the column header row does that job. */
function Cell({ label, wide, children, show }: { label: string; wide?: boolean; children: React.ReactNode; show: boolean }) {
  if (!show) return null;
  return (
    <div className={wide ? "col-span-2 min-[960px]:col-span-1" : ""}>
      <span className="block min-[960px]:hidden text-[11px] mb-0.5" style={MUTED}>{label}</span>
      {children}
    </div>
  );
}

const textOf = (cents: number) => (cents ? String(cents / 100) : "");

export default function LineEditor({
  initialLines,
  catalog: initialCatalog,
  adapter,
  onChange,
  showType = true,
  vatEnabled = false,
  allowCost = false,
  noun = "line",
}: {
  initialLines: EditorLine[];
  catalog: CatalogEntry[];
  /** Must be stable for the editor's lifetime (build it with useMemo keyed on the job / invoice id). */
  adapter: LineAdapter;
  /** Every change (typing included), so the parent's totals stay live. */
  onChange?: (lines: EditorLine[]) => void;
  showType?: boolean;
  vatEnabled?: boolean;
  allowCost?: boolean;
  noun?: string;
}) {
  const [rows, setRows] = useState<EditorLine[]>(initialLines);
  const [catalog, setCatalog] = useState<CatalogEntry[]>(initialCatalog);
  const [status, setStatus] = useState<{ s: SaverStatus; error?: string }>({ s: "idle" });
  const [toasts, setToasts] = useState<{ id: string; index: number; label: string }[]>([]);
  const [offer, setOffer] = useState<NewLine | null>(null);
  const [offerMsg, setOfferMsg] = useState<string | null>(null);
  const [showCost, setShowCost] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const dismissed = useRef(new Set<string>());
  const toastSnapshots = useRef(new Map<string, EditorLine>());
  const blankRef = useRef<{ focus: () => void } | null>(null);
  const rowsRef = useRef(rows);
  const listId = useId();

  useEffect(() => { rowsRef.current = rows; onChange?.(rows); }, [rows, onChange]);

  const [saver] = useState(() => new LineSaver<Record<string, unknown>>({
    update: (id, patch) => adapter.update(id, patch),
    remove: (id) => adapter.remove(id),
    restore: async (snap, position) => {
      const res = await adapter.addMany([{ ...snap }], position);
      return res.ok ? { ok: true, id: res.ids[0] } : res;
    },
    onStatus: (s, error) => setStatus({ s, error }),
    schedule: (fn, ms) => setTimeout(fn, ms),
    cancel: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  }));

  // Never lose an edit because the page was left or the tab was closed.
  useEffect(() => {
    const flush = () => { void saver.flushAll(); };
    window.addEventListener("pagehide", flush);
    return () => { window.removeEventListener("pagehide", flush); flush(); };
  }, [saver]);

  const edit = (id: string, partial: Partial<EditorLine>, patch: Record<string, unknown>) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...partial } : r)));
    saver.queue(id, patch);
  };

  /** Adds lines (one typed row, a package, or a chip) and appends them with the ids the server returned. */
  const addLines = async (lines: NewLine[]): Promise<boolean> => {
    setAddError(null);
    setStatus({ s: "saving" });
    const res = await adapter.addMany(lines);
    if (!res.ok) { setStatus({ s: "error", error: res.error }); setAddError(res.error); return false; }
    setRows((prev) => [...prev, ...lines.map((l, i) => ({ ...l, id: res.ids[i]!, position: res.positions[i] }))]);
    setStatus({ s: "saved" });
    const first = lines[0];
    if (lines.length === 1 && first && shouldOfferPriceBook(first, catalog) && adapter.saveToPriceBook && !dismissed.current.has(first.description.trim().toLowerCase())) {
      setOffer(first); setOfferMsg(null);
    }
    return true;
  };

  const removeRow = async (row: EditorLine) => {
    const index = rowsRef.current.findIndex((r) => r.id === row.id);
    setRows((prev) => prev.filter((r) => r.id !== row.id));
    const res = await saver.remove(row, row.position ?? 0);
    if (!res.ok) {
      setRows((prev) => { const next = [...prev]; next.splice(Math.min(index, next.length), 0, row); return next; });
      return;
    }
    setToasts((t) => [...t, { id: row.id, index, label: row.description }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== row.id)), 5_000);
  };

  const undo = async (toast: { id: string; index: number }) => {
    const snapshot = toastSnapshots.current.get(toast.id);
    setToasts((t) => t.filter((x) => x.id !== toast.id));
    const res = await saver.undo(toast.id);
    if (res.ok && snapshot && res.id) {
      setRows((prev) => { const next = [...prev]; next.splice(Math.min(toast.index, next.length), 0, { ...snapshot, id: res.id! }); return next; });
    }
  };

  const costs = allowCost;
  const grid = gridFor(showType, costs && showCost);
  const statusText = status.s === "saving" ? "Saving…" : status.s === "saved" ? "Saved ✓" : status.s === "error" ? `Couldn't save${status.error ? ` — ${status.error}` : ""}` : "";
  const chips = quickAddEntries(catalog);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3 px-5 min-h-6">
        <span role="status" aria-live="polite" className="text-[12px]" style={status.s === "error" ? { color: "var(--color-svc-danger)" } : MUTED}>
          {statusText}
          {status.s === "error" ? (
            <button type="button" onClick={() => { void saver.retry(); }} className="ml-2 underline min-h-8">Retry</button>
          ) : null}
        </span>
        {costs ? (
          <button
            type="button" aria-pressed={showCost} onClick={() => setShowCost((v) => !v)}
            className="text-[12px] hover:underline min-h-8" style={{ color: "var(--color-svc-accent)" }}
          >
            {showCost ? "Hide costs" : "Show costs"}
          </button>
        ) : null}
      </div>

      <div className="px-5">
        <div className={`hidden ${showCost && costs ? "min-[1100px]:grid" : "min-[960px]:grid"} ${grid.replace(/^grid /, "")} text-[11px] uppercase tracking-[0.08em] pb-1.5`} style={MUTED} aria-hidden="true">
          <span>Description</span><span>Qty</span><span>Unit price</span>
          {showType ? <span>Type</span> : null}
          {showCost && costs ? <span>Cost / unit</span> : null}
          <span className="text-right">Amount</span><span />
        </div>

        <div className="space-y-3 min-[960px]:space-y-0">
          {rows.map((row, i) => (
            <LineRow
              key={row.id} row={row} n={i + 1} grid={grid} showType={showType} showCost={showCost && costs} vatEnabled={vatEnabled}
              onEdit={(partial, patch) => edit(row.id, partial, patch)}
              onBlur={() => { void saver.flush(row.id); }}
              onEnter={() => { void saver.flush(row.id); blankRef.current?.focus(); }}
              onRemove={() => { toastSnapshots.current.set(row.id, row); void removeRow(row); }}
            />
          ))}
          <BlankRow
            handleRef={blankRef} grid={grid} showType={showType} showCost={showCost && costs} vatEnabled={vatEnabled}
            catalog={catalog} listId={listId} noun={noun} first={rows.length === 0}
            onAdd={addLines}
          />
        </div>
      </div>

      {addError ? <p role="alert" className="px-5 text-[12.5px]" style={{ color: "var(--color-svc-danger)" }}>{addError}</p> : null}

      {offer ? (
        <div className="mx-5 rounded-lg px-3 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px]" style={{ background: "var(--color-svc-surface-2)", border: "1px solid var(--color-svc-border)", color: "var(--color-svc-text)" }}>
          <span>Save “{offer.description}” ({peso(offer.unitPriceCents)}) to the price book?</span>
          <button
            type="button" className="underline min-h-8" style={{ color: "var(--color-svc-accent)" }}
            onClick={async () => {
              const res = await adapter.saveToPriceBook?.(offer);
              if (res?.ok) { setCatalog((c) => [...c, res.entry]); setOfferMsg("Saved to price book ✓"); setOffer(null); }
              else setOfferMsg(res && !res.ok ? res.error : "Couldn't save to the price book.");
            }}
          >
            Save to price book
          </button>
          <button
            type="button" className="min-h-8" style={DIM}
            onClick={() => { dismissed.current.add(offer.description.trim().toLowerCase()); setOffer(null); }}
          >
            No thanks
          </button>
        </div>
      ) : offerMsg ? (
        <p role="status" className="px-5 text-[12.5px]" style={MUTED}>{offerMsg}</p>
      ) : null}

      {chips.length > 0 ? (
        <div className="px-5 pt-1" role="group" aria-label="Quick add from the price book">
          <p className="text-[11px] uppercase tracking-[0.08em] mb-1.5" style={MUTED}>Quick add</p>
          <div className="flex flex-wrap gap-2">
            {chips.map((c) => (
              <button
                key={c.id} type="button" className="chip-svc inline-flex items-center gap-1.5 px-3 min-h-9 rounded-full text-[12.5px]"
                onClick={() => { void addLines(expandCatalogEntry(c, catalog)); }}
              >
                <Plus size={12} aria-hidden="true" />
                {c.name}
                {c.kind !== "package" && c.unitPriceCents > 0 ? <span style={DIM}>{peso(c.unitPriceCents)}</span> : null}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div aria-live="polite" className="px-5 space-y-1.5">
        {toasts.map((t) => (
          <div key={t.id} className="flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-[12.5px]" style={{ background: "var(--color-svc-surface-2)", border: "1px solid var(--color-svc-border-strong)", color: "var(--color-svc-text)" }}>
            <span className="truncate">Removed “{t.label}”</span>
            <button type="button" onClick={() => { void undo(t); }} className="inline-flex items-center gap-1.5 min-h-9 px-2 font-medium" style={{ color: "var(--color-svc-accent)" }}>
              <Undo2 size={13} aria-hidden="true" /> Undo
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- existing row */

function LineRow({
  row, n, grid, showType, showCost, vatEnabled, onEdit, onBlur, onEnter, onRemove,
}: {
  row: EditorLine; n: number; grid: string; showType: boolean; showCost: boolean; vatEnabled: boolean;
  onEdit: (partial: Partial<EditorLine>, patch: Record<string, unknown>) => void;
  onBlur: () => void; onEnter: () => void; onRemove: () => void;
}) {
  const [desc, setDesc] = useState(row.description);
  const [qty, setQty] = useState(String(row.qty));
  const [price, setPrice] = useState(textOf(row.unitPriceCents));
  const [cost, setCost] = useState(textOf(row.costCents));
  const qtyOk = parseQty(qty) !== null;
  const priceOk = price.trim() === "" || parsePesoInput(price) !== null;
  const costOk = cost.trim() === "" || parsePesoInput(cost) !== null;
  const q = parseQty(qty) ?? row.qty;
  const amount = lineTotalCents({ qty: q, unitPriceCents: row.unitPriceCents });
  const keys = (e: React.KeyboardEvent) => { if (e.key === "Enter") { e.preventDefault(); onEnter(); } };

  return (
    <div className={`${grid} py-2 min-[960px]:py-1.5 group`} style={{ borderTop: "1px solid var(--color-svc-border)" }} role="group" aria-label={`Line ${n}: ${row.description}`}>
      <Cell show label="Description" wide>
        <input
          aria-label={`Description for line ${n}`} value={desc} aria-invalid={desc.trim() === "" || undefined} className={FIELD} maxLength={300}
          onChange={(e) => { setDesc(e.target.value); if (e.target.value.trim()) onEdit({ description: e.target.value.trim() }, { description: e.target.value.trim() }); }}
          onBlur={onBlur} onKeyDown={keys}
        />
      </Cell>
      <Cell show label="Qty">
        <input
          aria-label={`Quantity for line ${n}`} inputMode="numeric" value={qty} aria-invalid={!qtyOk || undefined} className={`${FIELD} svc-num`}
          onChange={(e) => { setQty(e.target.value); const v = parseQty(e.target.value); if (v) onEdit({ qty: v }, { qty: v }); }}
          onBlur={onBlur} onKeyDown={keys}
        />
      </Cell>
      <Cell show label="Unit price">
        <span className="relative block">
          <span aria-hidden="true" className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[12px]" style={DIM}>₱</span>
          <input
            aria-label={`Unit price for line ${n}`} inputMode="decimal" autoComplete="off" value={price} aria-invalid={!priceOk || undefined}
            className={`${FIELD} svc-num !pl-6`}
            onChange={(e) => {
              setPrice(e.target.value);
              const v = e.target.value.trim() === "" ? 0 : parsePesoInput(e.target.value);
              if (v !== null) onEdit({ unitPriceCents: Math.round(v * 100) }, { unitPrice: v });
            }}
            onBlur={onBlur} onKeyDown={keys}
          />
        </span>
      </Cell>
      <Cell show={showType} label="Type" wide={!showCost}>
        <div className="flex items-center gap-2">
          <select
            aria-label={`Type for line ${n}`} value={row.kind} className={`${FIELD} !w-auto flex-1`}
            onChange={(e) => onEdit({ kind: e.target.value }, { kind: e.target.value })} onBlur={onBlur}
          >
            {ITEM_KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
          </select>
          {vatEnabled ? (
            <label className="inline-flex items-center gap-1.5 text-[11.5px] min-h-8 cursor-pointer" style={DIM}>
              <input type="checkbox" checked={row.taxable} onChange={(e) => onEdit({ taxable: e.target.checked }, { taxable: e.target.checked })} onBlur={onBlur} aria-label={`VAT applies to line ${n}`} />
              VAT
            </label>
          ) : null}
        </div>
      </Cell>
      <Cell show={showCost} label="Cost / unit">
        <span className="relative block">
          <span aria-hidden="true" className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[12px]" style={DIM}>₱</span>
          <input
            aria-label={`Cost per unit for line ${n}`} inputMode="decimal" autoComplete="off" value={cost} placeholder="optional" aria-invalid={!costOk || undefined}
            className={`${FIELD} svc-num !pl-6`}
            onChange={(e) => {
              setCost(e.target.value);
              const v = e.target.value.trim() === "" ? 0 : parsePesoInput(e.target.value);
              if (v !== null) onEdit({ costCents: Math.round(v * 100) }, { cost: v });
            }}
            onBlur={onBlur} onKeyDown={keys}
          />
        </span>
      </Cell>
      <div className="flex items-center justify-between gap-2 col-span-2 min-[960px]:contents">
        <span className="min-[960px]:text-right svc-num text-[13px]"><span className="min-[960px]:hidden text-[11px] mr-2" style={MUTED}>Amount</span><Money cents={amount} /></span>
        <button
          type="button" onClick={onRemove} aria-label={`Remove line ${n}: ${row.description}`}
          className="inline-flex items-center justify-center min-w-11 min-h-11 rounded-lg hover:bg-white/[0.06]" style={MUTED}
        >
          <X size={15} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- blank row */

function BlankRow({
  handleRef, grid, showType, showCost, vatEnabled, catalog, listId, noun, first, onAdd,
}: {
  handleRef: Ref<{ focus: () => void }>; grid: string; showType: boolean; showCost: boolean; vatEnabled: boolean;
  catalog: CatalogEntry[]; listId: string; noun: string; first: boolean;
  onAdd: (lines: NewLine[]) => Promise<boolean>;
}) {
  const [desc, setDesc] = useState("");
  const [qty, setQty] = useState("1");
  const [price, setPrice] = useState("");
  const [cost, setCost] = useState("");
  const [kind, setKind] = useState("service");
  const [taxable, setTaxable] = useState(true);
  const [minutes, setMinutes] = useState<number | null>(null);
  const [catalogItemId, setCatalogItemId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const descRef = useRef<HTMLInputElement>(null);
  const qtyRef = useRef<HTMLInputElement>(null);
  const busy = useRef(false);

  useImperativeHandle(handleRef, () => ({ focus: () => descRef.current?.focus() }), []);

  const results = open ? filterCatalog(catalog, desc) : [];
  const priceCents = Math.round((parsePesoInput(price) ?? 0) * 100);
  const amount = lineTotalCents({ qty: parseQty(qty) ?? 1, unitPriceCents: priceCents });

  const reset = () => {
    setDesc(""); setQty("1"); setPrice(""); setCost(""); setKind("service"); setTaxable(true);
    setMinutes(null); setCatalogItemId(null); setOpen(false); setActive(-1);
  };

  const commit = async (refocus: boolean) => {
    if (busy.current || !isRowSavable({ description: desc, qty, price })) return;
    if (price.trim() !== "" && parsePesoInput(price) === null) return;
    busy.current = true;
    const line: NewLine = {
      kind, description: desc.trim(), qty: parseQty(qty) ?? 1, unitPriceCents: priceCents, taxable,
      costCents: Math.round((parsePesoInput(cost) ?? 0) * 100), catalogItemId, minutes,
    };
    const ok = await onAdd([line]);
    busy.current = false;
    if (ok) { reset(); if (refocus) descRef.current?.focus(); }
  };

  const choose = async (entry: CatalogEntry) => {
    const lines = expandCatalogEntry(entry, catalog);
    setOpen(false); setActive(-1);
    if (lines.length > 1 || entry.kind === "package") {
      // A package adds all of its lines at once and leaves the blank row ready for the next one.
      busy.current = true;
      const ok = await onAdd(lines);
      busy.current = false;
      if (ok) { reset(); descRef.current?.focus(); }
      return;
    }
    const l = lines[0]!;
    setDesc(l.description); setPrice(textOf(l.unitPriceCents)); setKind(l.kind); setTaxable(l.taxable);
    setMinutes(l.minutes); setCatalogItemId(l.catalogItemId); setQty("1");
    qtyRef.current?.focus(); qtyRef.current?.select();
  };

  const onDescKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setActive((a) => Math.min(results.length - 1, a + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === "Enter") {
      e.preventDefault();
      const picked = results[active];
      if (open && picked) void choose(picked);
      else void commit(true);
    } else if (e.key === "Escape") {
      if (open && results.length > 0) { e.preventDefault(); setOpen(false); setActive(-1); }
      else if (desc || price || cost || qty !== "1") { e.preventDefault(); reset(); }
    } else if (e.key === "Tab") setOpen(false);
  };
  const onFieldKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") { e.preventDefault(); void commit(true); }
    else if (e.key === "Escape") { e.preventDefault(); reset(); descRef.current?.focus(); }
  };

  return (
    <div
      className={`${grid} py-2 min-[960px]:py-1.5`} style={{ borderTop: "1px dashed var(--color-svc-border-strong)" }}
      role="group" aria-label={`New ${noun}`}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) { setOpen(false); void commit(false); } }}
    >
      <Cell show label="Description" wide>
        <div className="relative">
          <input
            ref={descRef} role="combobox" aria-label={`New ${noun} description`} aria-expanded={open && results.length > 0}
            aria-controls={listId} aria-autocomplete="list" aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
            autoComplete="off" value={desc} maxLength={300} className={FIELD}
            placeholder={first ? "Type a service or part — the price book will suggest" : "Add another line…"}
            onChange={(e) => { setDesc(e.target.value); setCatalogItemId(null); setOpen(true); setActive(-1); }}
            onFocus={() => setOpen(true)} onKeyDown={onDescKey}
          />
          {open && results.length > 0 ? (
            <ul
              id={listId} role="listbox" aria-label="Price book suggestions"
              className="absolute z-30 left-0 right-0 mt-1 rounded-lg overflow-auto max-h-64 py-1 shadow-xl"
              style={{ background: "var(--color-svc-surface-2)", border: "1px solid var(--color-svc-border-strong)" }}
            >
              {results.map((c, i) => (
                <li
                  key={c.id} id={`${listId}-${i}`} role="option" aria-selected={i === active}
                  onMouseDown={(e) => { e.preventDefault(); void choose(c); }}
                  className="px-3 py-2 min-h-11 flex items-center justify-between gap-3 cursor-pointer text-[13px]"
                  style={{ background: i === active ? "var(--color-svc-accent-soft)" : undefined, color: "var(--color-svc-text)" }}
                >
                  <span className="truncate">{c.name}</span>
                  <span className="shrink-0 text-[12px]" style={MUTED}>
                    {c.kind === "package" ? "Package" : peso(c.unitPriceCents)}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </Cell>
      <Cell show label="Qty">
        <input
          ref={qtyRef} aria-label={`New ${noun} quantity`} inputMode="numeric" value={qty} className={`${FIELD} svc-num`}
          aria-invalid={parseQty(qty) === null || undefined} onChange={(e) => setQty(e.target.value)} onKeyDown={onFieldKey}
        />
      </Cell>
      <Cell show label="Unit price">
        <span className="relative block">
          <span aria-hidden="true" className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[12px]" style={DIM}>₱</span>
          <input
            aria-label={`New ${noun} unit price`} inputMode="decimal" autoComplete="off" value={price} placeholder="0"
            aria-invalid={(price.trim() !== "" && parsePesoInput(price) === null) || undefined}
            className={`${FIELD} svc-num !pl-6`} onChange={(e) => setPrice(e.target.value)} onKeyDown={onFieldKey}
          />
        </span>
      </Cell>
      <Cell show={showType} label="Type" wide={!showCost}>
        <div className="flex items-center gap-2">
          <select aria-label={`New ${noun} type`} value={kind} className={`${FIELD} !w-auto flex-1`} onChange={(e) => setKind(e.target.value)} onKeyDown={onFieldKey}>
            {ITEM_KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
          </select>
          {vatEnabled ? (
            <label className="inline-flex items-center gap-1.5 text-[11.5px] min-h-8 cursor-pointer" style={DIM}>
              <input type="checkbox" checked={taxable} onChange={(e) => setTaxable(e.target.checked)} aria-label={`VAT applies to new ${noun}`} />
              VAT
            </label>
          ) : null}
        </div>
      </Cell>
      <Cell show={showCost} label="Cost / unit">
        <span className="relative block">
          <span aria-hidden="true" className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[12px]" style={DIM}>₱</span>
          <input
            aria-label={`New ${noun} cost per unit`} inputMode="decimal" autoComplete="off" value={cost} placeholder="optional"
            className={`${FIELD} svc-num !pl-6`} onChange={(e) => setCost(e.target.value)} onKeyDown={onFieldKey}
          />
        </span>
      </Cell>
      <div className="flex items-center justify-between gap-2 col-span-2 min-[960px]:contents">
        <span className="min-[960px]:text-right svc-num text-[13px]" style={desc.trim() ? undefined : MUTED}>
          <span className="min-[960px]:hidden text-[11px] mr-2" style={MUTED}>Amount</span>{desc.trim() ? <Money cents={amount} /> : "—"}
        </span>
        <button
          type="button" aria-label={`Add ${noun}`} onClick={() => { void commit(true); }}
          disabled={!isRowSavable({ description: desc, qty, price })}
          className="inline-flex items-center justify-center min-w-11 min-h-11 rounded-lg hover:bg-white/[0.06] disabled:opacity-40"
          style={{ color: "var(--color-svc-accent)" }}
        >
          <Plus size={16} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
