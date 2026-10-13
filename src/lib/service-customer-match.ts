/**
 * Customer name matching for the type-to-search customer field (New job / New invoice / Add to waitlist).
 * Pure helpers: no database, no React. The server re-uses `normalizeName` for its own duplicate check, so the
 * browser and the server always agree on what "the same name" means.
 */

export type NameRow = { id: string; name: string };

/** The longest customer name the server keeps (see `createCustomer`). */
export const CUSTOMER_NAME_MAX = 160;

const MARKS = /\p{M}/gu;

/** Case-, space-, accent- and punctuation-insensitive form: "  María  O'Brien-Santos " -> "maria obrien santos". */
export function normalizeName(input: string | null | undefined): string {
  return (input ?? "")
    .normalize("NFD").replace(MARKS, "")
    .toLowerCase()
    .replace(/['’`]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** Normalised names per customer list, kept per array so a keystroke does not renormalise everyone (lists are immutable in React). */
const normCache = new WeakMap<readonly object[], string[]>();
function normsOf(list: readonly NameRow[]): string[] {
  let n = normCache.get(list);
  if (!n) { n = list.map((c) => normalizeName(c.name)); normCache.set(list, n); }
  return n;
}

const tokensOf = (input: string): string[] => { const n = normalizeName(input); return n ? n.split(" ") : []; };

/**
 * Saved customers that match what was typed, best first. Every typed word has to start a word of the name or appear
 * inside it. Order: the exact name, then names that start with the text, then names whose words start with each typed
 * word, then the rest; ties keep the incoming order (the list arrives sorted by name). Names only.
 */
export function filterCustomers<T extends NameRow>(customers: readonly T[], query: string, limit = 8): T[] {
  const q = normalizeName(query);
  if (!q) return [];
  const qTokens = q.split(" ");
  const scored: { c: T; rank: number; i: number }[] = [];
  const norms = normsOf(customers);
  customers.forEach((c, i) => {
    const n = norms[i]!;
    if (!n) return;
    const nTokens = n.split(" ");
    let rank: number;
    if (n === q) rank = 0;
    else if (n.startsWith(q)) rank = 1;
    else if (qTokens.every((t) => nTokens.some((w) => w.startsWith(t)))) rank = 2;
    else if (qTokens.every((t) => n.includes(t))) rank = 3;
    else return;
    scored.push({ c, rank, i });
  });
  scored.sort((a, b) => a.rank - b.rank || a.i - b.i);
  return scored.slice(0, Math.max(0, limit)).map((s) => s.c);
}

/** Character ranges of `name` to highlight for `query` (indexes into the ORIGINAL name, accents and case ignored). */
export function matchRanges(name: string, query: string): [number, number][] {
  const qTokens = tokensOf(query);
  if (!qTokens.length) return [];
  // Fold the name one character at a time so every folded character maps back to its original index.
  let folded = "";
  const back: number[] = [];
  [...name].reduce((idx, ch) => {
    const f = ch.normalize("NFD").replace(MARKS, "").toLowerCase();
    for (let k = 0; k < f.length; k++) back.push(idx);
    folded += f;
    return idx + ch.length;
  }, 0);
  const out: [number, number][] = [];
  for (const t of new Set(qTokens)) {
    // Prefer the start of a word; fall back to anywhere inside.
    let at = -1;
    for (let from = 0; ;) {
      const hit = folded.indexOf(t, from);
      if (hit < 0) break;
      if (hit === 0 || !/[\p{L}\p{N}]/u.test(folded[hit - 1]!)) { at = hit; break; }
      from = hit + 1;
    }
    if (at < 0) at = folded.indexOf(t);
    if (at < 0) continue;
    const start = back[at]!;
    const lastFolded = back[at + t.length - 1]!;
    out.push([start, lastFolded + (name.codePointAt(lastFolded)! > 0xffff ? 2 : 1)]);
  }
  out.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const r of out) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([r[0], r[1]]);
  }
  return merged;
}

/** Edit distance counting a swap of two neighbouring letters as one edit. */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  const d: number[][] = Array.from({ length: m + 1 }, (_, i) => [i, ...Array<number>(n).fill(0)]);
  for (let j = 0; j <= n; j++) d[0]![j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i]![j] = Math.min(d[i]![j]!, d[i - 2]![j - 2]! + 1);
    }
  }
  return d[m]![n]!;
}

/** A typo-sized difference in ONE word, only for longer words ("Santos"/"Santoz" yes, "Maria"/"Mario" no: different people). */
const SIMILAR_MIN_LEN = 6;
const similarWord = (a: string, b: string) => a === b || (Math.min(a.length, b.length) >= SIMILAR_MIN_LEN && editDistance(a, b) <= 1);

export type DuplicateMatch<T extends NameRow = NameRow> =
  | { kind: "exact"; customer: T }
  | { kind: "near"; customer: T }
  | { kind: "none" };

/**
 * Is this typed name already a saved customer? "exact" = same name ignoring case, spaces, accents and punctuation.
 * "near" = the same words in a different order ("Santos Maria"), or one word with a one-letter typo in a long word.
 * Deliberately narrow so the owner is not nagged: different first names, extra middle names, etc. do not warn.
 */
export function findDuplicate<T extends NameRow>(name: string, customers: readonly T[]): DuplicateMatch<T> {
  const q = normalizeName(name);
  if (!q) return { kind: "none" };
  const qTokens = q.split(" ");
  const qSorted = [...qTokens].sort().join(" ");
  let near: T | null = null;
  const norms = normsOf(customers);
  for (const [i, c] of customers.entries()) {
    const n = norms[i]!;
    if (!n) continue;
    if (n === q) return { kind: "exact", customer: c };
    if (near) continue;
    const nTokens = n.split(" ");
    if (nTokens.length === qTokens.length && qTokens.length > 1 && [...nTokens].sort().join(" ") === qSorted) { near = c; continue; }
    if (nTokens.length === qTokens.length) {
      const differing = nTokens.filter((t, i) => t !== qTokens[i]);
      if (differing.length === 1) {
        const i = nTokens.findIndex((t, k) => t !== qTokens[k]);
        if (similarWord(nTokens[i]!, qTokens[i]!)) near = c;
      }
    }
  }
  return near ? { kind: "near", customer: near } : { kind: "none" };
}

/** A name that may be saved as a new customer: not empty, within the server's length, and with at least one letter. */
export function canCreateNew(name: unknown): boolean {
  if (typeof name !== "string") return false;
  const t = name.trim().replace(/\s+/g, " ");
  return t.length > 0 && t.length <= CUSTOMER_NAME_MAX && /\p{L}/u.test(t);
}

/* ------------------------------------------------------------------ the field's value */

/**
 * What the customer field holds. `new` has no id yet: the customer is only written when the form is saved.
 * `allowDuplicate` is set by "Create as new anyway".
 */
export type CustomerChoice =
  | { kind: "existing"; id: string }
  | { kind: "new"; name: string; phone?: string; allowDuplicate?: boolean }
  | { kind: "none" };

export type ChoiceState =
  | "empty"           // nothing chosen or typed
  | "invalid"         // typed text that can't be a name (no letters, too long)
  | "needs-decision"  // the name matches a saved customer; the owner must pick "Use existing" or "Create as new anyway"
  | "ready";

export function choiceState(choice: CustomerChoice, customers: readonly NameRow[]): ChoiceState {
  if (choice.kind === "none") return "empty";
  if (choice.kind === "existing") return "ready";
  if (!choice.name.trim()) return "empty";
  if (!canCreateNew(choice.name)) return "invalid";
  if (choice.allowDuplicate !== true && findDuplicate(choice.name, customers).kind !== "none") return "needs-decision";
  return "ready";
}
