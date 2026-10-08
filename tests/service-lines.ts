/** Inline line editor: validation, price book, packages, cost, debounced autosave + undo. No database. Run: npx tsx tests/service-lines.ts */
import { parseQty, isRowSavable, lineCostCents, partsCostFromLines, filterCatalog, expandCatalogEntry, quickAddEntries, shouldOfferPriceBook, LineSaver, type CatalogEntry, type EditorLine, type SaveOutcome, cleanDetails, parseIncludes, includesLine, packageIncludes } from "../src/lib/service-lines";

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) { failures++; console.error(`  ✗ ${name}\n      expected ${e}\n      actual   ${a}`); }
  else console.log(`  ✓ ${name}`);
}

const entry = (o: Partial<CatalogEntry> & { id: string; name: string }): CatalogEntry => ({
  kind: "service", unitPriceCents: 100_000, taxable: true, estimatedMinutes: 60, active: true, isQuickAdd: false, packageId: null, ...o,
});
const catalog: CatalogEntry[] = [
  entry({ id: "t", name: "Standard tuning", unitPriceCents: 250_000, isQuickAdd: true, estimatedMinutes: 90 }),
  entry({ id: "p", name: "Pitch raise", unitPriceCents: 150_000 }),
  entry({ id: "s", name: "Hammer felt set", kind: "part", unitPriceCents: 800_000 }),
  entry({ id: "pk", name: "Full service package", kind: "package", unitPriceCents: 0, isQuickAdd: true }), // legacy: members, no list
  entry({ id: "bp", name: "Basic piano service package", kind: "package", unitPriceCents: 300_000, description: "Standard tuning\nAction cleaning\n  - Pedal adjustment\nstandard tuning" }),
  entry({ id: "m1", name: "Tuning (package)", unitPriceCents: 250_000, packageId: "pk" }),
  entry({ id: "m2", name: "Action regulation", unitPriceCents: 400_000, packageId: "pk" }),
  entry({ id: "old", name: "Retired item", active: false }),
];

console.log("draft validation");
check("qty whole numbers only", [parseQty("2"), parseQty(" 3 "), parseQty("0"), parseQty("1.5"), parseQty("abc"), parseQty("")], [2, 3, null, null, null, null]);
check("blank description is not savable", isRowSavable({ description: "  ", qty: "1", price: "100" }), false);
check("description + qty is savable (price may be 0)", isRowSavable({ description: "Courtesy check", qty: "1", price: "" }), true);
check("bad qty is not savable", isRowSavable({ description: "Tuning", qty: "0", price: "100" }), false);

console.log("\nper-line cost");
check("explicit cost wins", lineCostCents({ kind: "service", qty: 2, unitPriceCents: 100_000, costCents: 30_000 }), 60_000);
check("part with no cost costs 0 (selling price is not its cost)", lineCostCents({ kind: "part", qty: 2, unitPriceCents: 50_000 }), 0);
check("service with no cost has no cost", lineCostCents({ kind: "service", qty: 1, unitPriceCents: 250_000 }), 0);
check("part with explicit cost uses it, not the price", lineCostCents({ kind: "part", qty: 1, unitPriceCents: 800_000, costCents: 500_000 }), 500_000);
check("sum over lines", partsCostFromLines([
  { kind: "part", qty: 1, unitPriceCents: 800_000, costCents: 500_000 },
  { kind: "service", qty: 1, unitPriceCents: 250_000 },
  { kind: "part", qty: 2, unitPriceCents: 10_000 },
]), 500_000);

console.log("\nprice-book type-ahead");
check("matches by words, any order", filterCatalog(catalog, "tun std").map((c) => c.id), []);
check("matches by substring", filterCatalog(catalog, "tuning").map((c) => c.id), ["m1", "t"]);
check("prefix matches first, then the rest by name", filterCatalog(catalog, "p").map((c) => c.id), ["p", "bp", "pk", "m1"]);
check("every active entry is listed (inactive ones are not); members are ordinary items now", filterCatalog(catalog, "", 20).map((c) => c.id).sort(), ["bp", "m1", "m2", "p", "pk", "s", "t"]);
check("case-insensitive", filterCatalog(catalog, "HAMMER").map((c) => c.id), ["s"]);

console.log("\npackages and quick add");
check("single item expands to itself with price + kind", expandCatalogEntry(catalog[0]!, catalog).map((l) => [l.description, l.unitPriceCents, l.kind, l.catalogItemId]), [["Standard tuning", 250_000, "service", "t"]]);
check("a package is ONE line at the package price, with its includes list as details", expandCatalogEntry(catalog[4]!, catalog).map((l) => [l.description, l.unitPriceCents, l.kind, l.details]), [["Basic piano service package", 300_000, "service", "Includes: Standard tuning · Action cleaning · Pedal adjustment"]]);
check("an old-style package (members, no list) still prints its members as the includes", expandCatalogEntry(catalog[3]!, catalog).map((l) => [l.unitPriceCents, l.details]), [[0, "Includes: Tuning (package) · Action regulation"]]);
check("a package with nothing to list adds just its name and price", expandCatalogEntry(entry({ id: "x", name: "Empty pkg", kind: "package", unitPriceCents: 1 }), []).map((l) => [l.kind, l.details]), [["service", null]]);
check("a plain item brings its description along as details", expandCatalogEntry(entry({ id: "d", name: "Pedal repair", description: "  Brass pedal rod and felt  " }), []).map((l) => l.details), ["Brass pedal rod and felt"]);
check("quick-add chips: flagged and active", quickAddEntries(catalog).map((c) => c.id), ["t", "pk"]);

console.log("\ndetails + includes");
check("includes: one per line, bullets and dots tolerated, blanks and duplicates dropped", parseIncludes("Tuning\n- Cleaning\n• Regulation\n\nTUNING; Voicing · Pedals"), ["Tuning", "Cleaning", "Regulation", "Voicing", "Pedals"]);
check("includes: empty / null", [parseIncludes(""), parseIncludes(null)], [[], []]);
check("includes line", [includesLine(["A", "B"]), includesLine([])], ["Includes: A · B", null]);
check("package list wins over legacy members", packageIncludes(catalog[4]!, catalog), ["Standard tuning", "Action cleaning", "Pedal adjustment"]);
check("details are trimmed, capped and never empty strings", [cleanDetails("  hi  "), cleanDetails("   "), cleanDetails(undefined), cleanDetails("x".repeat(900))?.length], ["hi", null, null, 500]);

console.log("\nsave to price book prompt");
check("free text not in book -> offer", shouldOfferPriceBook({ description: "Pedal repair", catalogItemId: null }, catalog), true);
check("picked from book -> no offer", shouldOfferPriceBook({ description: "Standard tuning", catalogItemId: "t" }, catalog), false);
check("typed name already in book -> no offer", shouldOfferPriceBook({ description: "  standard   TUNING ", catalogItemId: null }, catalog), false);

/* ---- autosave + undo with a fake clock ---- */
function harness(opts: { failUpdate?: boolean; slowFirst?: boolean } = {}) {
  let now = 0;
  const jobs: { at: number; fn: () => void; id: number }[] = [];
  let nextId = 1;
  const log: string[] = [];
  const statuses: string[] = [];
  const server: Record<string, Record<string, unknown>> = {};
  let updates = 0;
  const saver = new LineSaver<Record<string, unknown>>({
    update: async (id, patch) => {
      updates++;
      const n = updates;
      if (opts.slowFirst && n === 1) await new Promise((r) => setTimeout(r, 15));
      log.push(`update ${id} ${JSON.stringify(patch)}`);
      if (opts.failUpdate) return { ok: false, error: "network" };
      server[id] = { ...(server[id] ?? {}), ...patch };
      return { ok: true };
    },
    remove: async (id) => { log.push(`remove ${id}`); delete server[id]; return { ok: true }; },
    restore: async (snap, position) => { log.push(`restore ${snap.description}@${position}`); server[`new-${snap.id}`] = { ...snap }; return { ok: true, id: `new-${snap.id}` }; },
    onStatus: (s, e) => statuses.push(e ? `${s}:${e}` : s),
    schedule: (fn, ms) => { const j = { at: now + ms, fn, id: nextId++ }; jobs.push(j); return j.id; },
    cancel: (h) => { const i = jobs.findIndex((j) => j.id === h); if (i >= 0) jobs.splice(i, 1); },
  });
  const advance = async (ms: number) => {
    now += ms;
    for (const j of jobs.filter((j) => j.at <= now).sort((a, b) => a.at - b.at)) { jobs.splice(jobs.indexOf(j), 1); j.fn(); }
    await new Promise((r) => setTimeout(r, 40));
  };
  return { saver, advance, log, statuses, server };
}
const snap = (id: string): EditorLine => ({ id, kind: "service", description: "Standard tuning", qty: 1, unitPriceCents: 250_000, taxable: true, costCents: 0, catalogItemId: null, minutes: null });

console.log("\nautosave");
async function main() {
{
  const h = harness();
  h.saver.queue("a", { qty: 2 });
  await h.advance(300);
  h.saver.queue("a", { unitPrice: 2600 });
  await h.advance(300);
  check("nothing sent while still typing (debounced)", h.log, []);
  await h.advance(400);
  check("edits to one line coalesce into one request", h.log, ['update a {"qty":2,"unitPrice":2600}']);
  check("status goes saving -> saved", [h.statuses[0], h.statuses.at(-1)], ["saving", "saved"]);
}
{
  const h = harness();
  h.saver.queue("a", { qty: 3 });
  await h.saver.flush("a");
  check("flush (blur / Enter) sends immediately", h.log, ['update a {"qty":3}']);
  check("flush cancels the pending timer (no double save)", (await h.advance(2000), h.log.length), 1);
}
{
  const h = harness();
  h.saver.queue("a", { qty: 1 });
  h.saver.queue("b", { qty: 5 });
  await h.saver.flushAll();
  check("flushAll saves every dirty line", h.log.sort(), ['update a {"qty":1}', 'update b {"qty":5}']);
  check("nothing pending afterwards", h.saver.hasPending(), false);
}
{
  const h = harness({ failUpdate: true });
  h.saver.queue("a", { qty: 2 });
  await h.saver.flush("a");
  check("a failed save surfaces an error status", h.statuses.at(-1), "error:network");
  check("the unsaved edit is kept for retry", h.saver.hasPending(), true);
}
{
  const h = harness({ slowFirst: true });
  h.saver.queue("a", { qty: 2 });
  const first = h.saver.flush("a");
  h.saver.queue("a", { qty: 3 });
  const second = h.saver.flush("a");
  await Promise.all([first, second]);
  check("saves for the same line never overlap or reorder (last edit wins)", [h.log[0], h.log[1], h.server.a], ['update a {"qty":2}', 'update a {"qty":3}', { qty: 3 }]);
}

{
  const h = harness();
  h.saver.queue("a", { qty: 2 });
  const boom = new LineSaver<Record<string, unknown>>({
    update: async () => { throw new Error("network"); }, remove: async () => ({ ok: true }), restore: async () => ({ ok: true }),
    onStatus: (s, e) => h.statuses.push(e ? `${s}:${e}` : s), schedule: (fn, ms) => setTimeout(fn, ms), cancel: (x) => clearTimeout(x as ReturnType<typeof setTimeout>),
  });
  boom.queue("z", { qty: 5 });
  await boom.flush("z");
  check("a Server Action that throws is a failed save, never a silent \"Saved\"", h.statuses.at(-1)?.startsWith("error:"), true);
  check("…and the edit is kept for Retry", boom.hasPending(), true);
  await boom.flush("z");
  check("the line is not stuck: a later flush still sends", h.statuses.at(-1)?.startsWith("error:"), true);
}

console.log("\nremove + undo (5s window)");
{
  const h = harness();
  h.saver.queue("a", { qty: 9 });
  await h.saver.remove(snap("a"), 3);
  check("removing a line drops its pending edit and deletes it", h.log, ["remove a"]);
  check("undo is offered", h.saver.canUndo("a"), true);
  await h.advance(3000);
  const res = await h.saver.undo("a");
  check("undo inside 5s restores the line at its old position", [res.ok, h.log.at(-1)], [true, "restore Standard tuning@3"]);
  check("undo can't be used twice", h.saver.canUndo("a"), false);
}
{
  const h = harness();
  await h.saver.remove(snap("a"), 1);
  await h.advance(5100);
  check("undo expires after 5s", h.saver.canUndo("a"), false);
  const res: SaveOutcome = await h.saver.undo("a");
  check("late undo is refused", res.ok, false);
}

}
main().then(() => {
  if (failures) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
  console.log("\nall line editor checks passed");
});
