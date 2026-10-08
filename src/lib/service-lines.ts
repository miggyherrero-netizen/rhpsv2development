/**
 * Pure logic behind the inline quote / invoice line editor: draft validation, price-book matching,
 * package expansion, per-line cost, and the debounced autosave + undo queue. No React, no DB — tested directly.
 */

export type LineKind = "service" | "part" | "fee" | "discount";

/** A line as the editor holds it. Prices are centavos; `id` is the server id (new rows have none yet). */
export type EditorLine = {
  id: string;
  kind: string;
  description: string;
  qty: number;
  unitPriceCents: number;
  taxable: boolean;
  costCents: number;
  catalogItemId: string | null;
  minutes: number | null;
  /** Small print under the item name (printed on the quote and invoice). */
  details?: string | null;
  /** Server sort position (kept so Undo can put a removed line back where it was). */
  position?: number;
};

export type CatalogEntry = {
  id: string;
  name: string;
  kind: string;
  unitPriceCents: number;
  taxable: boolean;
  estimatedMinutes: number;
  active: boolean;
  isQuickAdd: boolean;
  packageId: string | null;
  /** Details printed under the name. For a package: what is included, one item per line. */
  description?: string | null;
};

/** What a new line looks like before it is saved (no id yet). */
export type NewLine = Omit<EditorLine, "id" | "position">;

/* ---------------------------------------------------------------- parsing */

/** Whole number >= 1, else null. */
export function parseQty(input: string | number): number | null {
  const n = typeof input === "number" ? input : Number(String(input).trim());
  return Number.isInteger(n) && n >= 1 && n <= 9_999 ? n : null;
}

/** A blank row is saved only once it has a description (price may be 0 — e.g. a courtesy line). */
export function isRowSavable(draft: { description: string; qty: string; price: string }): boolean {
  return draft.description.trim().length > 0 && parseQty(draft.qty) !== null;
}

/* ----------------------------------------------------------------- cost */

/**
 * Cost of one line for margin. Only an explicit per-unit cost counts (qty * cost). A line with no cost entered
 * costs 0 - including a "part" line: its selling price is NOT its cost (the purchase is recorded as a linked
 * Materials/Parts expense, see `jobCostBasis`).
 */
export function lineCostCents(l: { kind: string; qty: number; unitPriceCents: number; costCents?: number | null }): number {
  const cost = l.costCents ?? 0;
  return cost > 0 ? Math.round(l.qty * cost) : 0;
}

export const partsCostFromLines = (lines: { kind: string; qty: number; unitPriceCents: number; costCents?: number | null }[]): number =>
  lines.reduce((sum, l) => sum + lineCostCents(l), 0);

/* ------------------------------------------------------------ details + packages */

export const DETAILS_MAX = 500;

/** Details text: trimmed, capped, blank -> null. */
export function cleanDetails(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim().slice(0, DETAILS_MAX) : "";
  return s || null;
}

/** "What is included": one item per line (a "·" or ";" also splits), trimmed, no blanks, no duplicates. */
export function parseIncludes(text: string | null | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of (text ?? "").split(/\r?\n|[·;]/)) {
    const item = raw.replace(/^\s*[-•*]\s*/, "").trim();
    const key = item.toLowerCase();
    if (!item || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
    if (out.length >= 30) break;
  }
  return out;
}

/** The line printed under a package's name. */
export const includesLine = (items: string[]): string | null => (items.length ? `Includes: ${items.join(" · ")}` : null);

/** Active members of a legacy package (price-book rows pointing at it), in price-book order. */
export const packageMembers = (catalog: CatalogEntry[], packageId: string): CatalogEntry[] =>
  catalog.filter((c) => c.active && c.packageId === packageId);

/** What a package includes: its own list, or — for packages set up the old way — the names of its member rows. */
export function packageIncludes(entry: CatalogEntry, catalog: CatalogEntry[]): string[] {
  const own = parseIncludes(entry.description);
  return own.length ? own : packageMembers(catalog, entry.id).map((m) => m.name);
}

/* ------------------------------------------------------------ price book */

/** Type-ahead: active entries whose name contains every typed word, prefix matches first. */
export function filterCatalog(catalog: CatalogEntry[], query: string, limit = 8): CatalogEntry[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const pool = catalog.filter((c) => c.active);
  if (!words.length) return pool.slice(0, limit);
  const scored: { c: CatalogEntry; score: number }[] = [];
  for (const c of pool) {
    const name = c.name.toLowerCase();
    if (!words.every((w) => name.includes(w))) continue;
    scored.push({ c, score: name.startsWith(words[0]!) ? 0 : 1 });
  }
  return scored.sort((a, b) => a.score - b.score || a.c.name.localeCompare(b.c.name)).slice(0, limit).map((s) => s.c);
}

const toNewLine = (c: CatalogEntry, catalog: CatalogEntry[]): NewLine => ({
  kind: c.kind === "package" ? "service" : c.kind,
  description: c.name,
  qty: 1,
  unitPriceCents: c.unitPriceCents,
  taxable: c.taxable,
  costCents: 0,
  catalogItemId: c.id,
  minutes: c.estimatedMinutes || null,
  details: c.kind === "package" ? includesLine(packageIncludes(c, catalog)) : cleanDetails(c.description),
});

/**
 * The line one price-book pick adds. Always ONE line: a package is a single price with its "Includes: …" list as the
 * details under the name (the list carries no prices of its own).
 */
export const expandCatalogEntry = (entry: CatalogEntry, catalog: CatalogEntry[]): NewLine[] => [toNewLine(entry, catalog)];

/** The entries shown as quick-add chips. */
export const quickAddEntries = (catalog: CatalogEntry[]): CatalogEntry[] => catalog.filter((c) => c.active && c.isQuickAdd);

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/** After saving a free-typed line: offer "Save to price book?" unless the name is already there. */
export function shouldOfferPriceBook(line: { description: string; catalogItemId: string | null }, catalog: CatalogEntry[]): boolean {
  if (line.catalogItemId) return false;
  const name = norm(line.description);
  if (!name) return false;
  return !catalog.some((c) => norm(c.name) === name);
}

/* ------------------------------------------------------- autosave + undo */

export type SaveOutcome = { ok: true; id?: string } | { ok: false; error: string };
export type SaverStatus = "idle" | "saving" | "saved" | "error";

export type LineSaverDeps<P> = {
  update(id: string, patch: P): Promise<SaveOutcome>;
  remove(id: string): Promise<SaveOutcome>;
  /** Re-creates a removed line (Undo). `position` keeps it where it was. */
  restore(snapshot: EditorLine, position: number): Promise<SaveOutcome>;
  onStatus(status: SaverStatus, error?: string): void;
  schedule(fn: () => void, ms: number): unknown;
  cancel(handle: unknown): void;
  debounceMs?: number;
  undoMs?: number;
};

/**
 * Debounced per-line autosave. Edits to the same line coalesce into one request; requests for a line never overlap
 * (so a slow save can't overwrite a newer one); removing a line drops its pending edit and opens a 5s Undo window.
 */
export class LineSaver<P extends Record<string, unknown>> {
  private pending = new Map<string, P>();
  private timers = new Map<string, unknown>();
  private chain = new Map<string, Promise<void>>();
  private inFlight = 0;
  private failed: string | null = null;
  private undoable = new Map<string, { snapshot: EditorLine; position: number; timer: unknown }>();
  private readonly debounceMs: number;
  private readonly undoMs: number;

  constructor(private readonly deps: LineSaverDeps<P>) {
    this.debounceMs = deps.debounceMs ?? 600;
    this.undoMs = deps.undoMs ?? 5_000;
  }

  /** Queue an edit; the request goes out `debounceMs` after the last edit to that line. */
  queue(id: string, patch: P): void {
    this.pending.set(id, { ...(this.pending.get(id) ?? ({} as P)), ...patch });
    const t = this.timers.get(id);
    if (t !== undefined) this.deps.cancel(t);
    this.timers.set(id, this.deps.schedule(() => { void this.flush(id); }, this.debounceMs));
    this.deps.onStatus("saving");
  }

  /** Send a line's pending edit now (blur, Enter, leaving the page). */
  flush(id: string): Promise<void> {
    const t = this.timers.get(id);
    if (t !== undefined) { this.deps.cancel(t); this.timers.delete(id); }
    const patch = this.pending.get(id);
    if (!patch) return this.chain.get(id) ?? Promise.resolve();
    this.pending.delete(id);
    this.inFlight++;
    this.deps.onStatus("saving");
    const prev = this.chain.get(id) ?? Promise.resolve();
    const next = prev.catch(() => undefined).then(async () => {
      const res = await this.safely(() => this.deps.update(id, patch));
      if (!res.ok) {
        this.failed = res.error;
        // Keep the unsaved edit (without overriding anything newer) so "Retry" can send it again.
        this.pending.set(id, { ...patch, ...(this.pending.get(id) ?? ({} as P)) });
      }
    }).finally(() => {
      this.inFlight--;
      this.settle();
    });
    this.chain.set(id, next);
    return next;
  }

  flushAll(): Promise<void> {
    return Promise.all([...new Set([...this.pending.keys(), ...this.chain.keys()])].map((id) => this.flush(id))).then(() => undefined);
  }

  /** Send everything that failed or is still waiting (the "Retry" button). */
  retry(): Promise<void> {
    return this.flushAll();
  }

  hasPending(): boolean {
    return this.pending.size > 0 || this.inFlight > 0;
  }

  /** Remove a line (server delete happens now) and keep a snapshot for Undo. */
  async remove(snapshot: EditorLine, position: number): Promise<SaveOutcome> {
    const id = snapshot.id;
    const t = this.timers.get(id);
    if (t !== undefined) { this.deps.cancel(t); this.timers.delete(id); }
    this.pending.delete(id);
    await (this.chain.get(id) ?? Promise.resolve()).catch(() => undefined);
    this.inFlight++;
    this.deps.onStatus("saving");
    let res: SaveOutcome;
    try { res = await this.safely(() => this.deps.remove(id)); } finally { this.inFlight--; }
    if (!res.ok) { this.failed = res.error; this.settle(); return res; }
    const timer = this.deps.schedule(() => { this.undoable.delete(id); }, this.undoMs);
    this.undoable.set(id, { snapshot, position, timer });
    this.settle();
    return res;
  }

  canUndo(id: string): boolean {
    return this.undoable.has(id);
  }

  /** Undo a removal inside the window: the line comes back with its fields, at its old position. */
  async undo(id: string): Promise<SaveOutcome> {
    const entry = this.undoable.get(id);
    if (!entry) return { ok: false, error: "Too late to undo." };
    this.deps.cancel(entry.timer);
    this.undoable.delete(id);
    this.inFlight++;
    this.deps.onStatus("saving");
    let res: SaveOutcome;
    try { res = await this.safely(() => this.deps.restore(entry.snapshot, entry.position)); } finally { this.inFlight--; }
    if (!res.ok) this.failed = res.error;
    this.settle();
    return res;
  }

  /** A Server Action that throws (network drop, stale deploy) counts as a failed save, never as a silent success. */
  private async safely(fn: () => Promise<SaveOutcome>): Promise<SaveOutcome> {
    try { return await fn(); } catch { return { ok: false, error: "Couldn't reach the server — check your connection." }; }
  }

  private settle(): void {
    if (this.inFlight > 0) return;
    if (this.failed) { const e = this.failed; this.failed = null; this.deps.onStatus("error", e); return; }
    if (this.timers.size > 0) return;
    this.deps.onStatus("saved");
  }
}
