/** Inline line editor: validation, price book, packages, cost, debounced autosave + undo. No database. Run: npx tsx tests/service-lines.ts */
import {
  parseQty, isRowSavable, lineCostCents, partsCostFromLines, filterCatalog, expandCatalogEntry, quickAddEntries,
  shouldOfferPriceBook, LineSaver, type CatalogEntry, type EditorLine, type SaveOutcome,
} from "../src/lib/service-lines";

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
  entry({ id: "pk", name: "Full service package", kind: "package", unitPriceCents: 0, isQuickAdd: true }),
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
check("part with no cost keeps legacy rule (priced amount)", lineCostCents({ kind: "part", qty: 2, unitPriceCents: 50_000 }), 100_000);
check("service with no cost has no cost", lineCostCents({ kind: "service", qty: 1, unitPriceCents: 250_000 }), 0);
check("part with explicit cost uses it, not the price", lineCostCents({ kind: "part", qty: 1, unitPriceCents: 800_000, costCents: 500_000 }), 500_000);
check("sum over lines", partsCostFromLines([
  { kind: "part", qty: 1, unitPriceCents: 800_000, costCents: 500_000 },
  { kind: "service", qty: 1, unitPriceCents: 250_000 },
  { kind: "part", qty: 2, unitPriceCents: 10_000 },
]), 520_000);

console.log("\nprice-book type-ahead");
check("matches by words, any order", filterCatalog(catalog, "tun std").map((c) => c.id), []);
check("matches by substring", filterCatalog(catalog, "tuning").map((c) => c.id), ["t"]);
check("prefix matches first", filterCatalog(catalog, "p").map((c) => c.id), ["p", "pk"]);
check("inactive and package members are not listed", filterCatalog(catalog, "").map((c) => c.id).sort(), ["p", "pk", "s", "t"]);
check("case-insensitive", filterCatalog(catalog, "HAMMER").map((c) => c.id), ["s"]);

console.log("\npackages and quick add");
check("single item expands to itself with price + kind", expandCatalogEntry(catalog[0]!, catalog).map((l) => [l.description, l.unitPriceCents, l.kind, l.catalogItemId]), [["Standard tuning", 250_000, "service", "t"]]);
check("package expands to its members", expandCatalogEntry(catalog[3]!, catalog).map((l) => l.description), ["Tuning (package)", "Action regulation"]);
check("package with no members adds itself as a service", expandCatalogEntry(entry({ id: "x", name: "Empty pkg", kind: "package", unitPriceCents: 1 }), []).map((l) => l.kind), ["service"]);
check("quick-add chips: flagged, active, not package members", quickAddEntries(catalog).map((c) => c.id), ["t", "pk"]);

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
