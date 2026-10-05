/** Expense kinds and the Service / Piano sales / Overhead split. No database. Run: npx tsx tests/service-finance-split.ts */
import {
  defaultKindForCategory, effectiveKind, costOfGoodsCents, financeSplit, needsKindReview, isExpenseKind, type SaleLine,
} from "../src/lib/service-finance-split";

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) { failures++; console.error(`  ✗ ${name}\n      expected ${e}\n      actual   ${a}`); }
  else console.log(`  ✓ ${name}`);
}

console.log("default kind by category");
check("fuel / meals / transport are job costs", ["fuel", "meals", "transport"].map(defaultKindForCategory), ["job", "job", "job"]);
check("marketing / rent are overhead", ["marketing", "rent"].map(defaultKindForCategory), ["overhead", "overhead"]);
check("parts / materials / subcontractor are job costs", ["parts", "materials", "subcontractor"].map(defaultKindForCategory), ["job", "job", "job"]);
check("unknown category falls back to overhead", defaultKindForCategory("zzz"), "overhead");
check("saved kind wins over the category default", effectiveKind({ category: "fuel", kind: "stock" }), "stock");
check("no saved kind -> category default", effectiveKind({ category: "fuel", kind: null }), "job");
check("review queue = expenses with no kind", [needsKindReview({ kind: null }), needsKindReview({}), needsKindReview({ kind: "job" })], [true, true, false]);
check("kind validation", [isExpenseKind("stock"), isExpenseKind("pianos"), isExpenseKind(null)], [true, false, false]);

console.log("\ncost of goods");
const sale = (o: Partial<SaleLine> = {}): SaleLine => ({ pianoId: "p1", salePriceCents: 12_000_000, buyCostCents: 7_000_000, prepCostCents: 800_000, stockExpensesCents: 7_000_000, ...o });
check("buy cost + prep, not double counted with the stock expense it was prefilled from", costOfGoodsCents(sale()), 7_800_000);
check("never below the stock expenses on record", costOfGoodsCents(sale({ buyCostCents: 6_000_000, stockExpensesCents: 7_000_000 })), 7_800_000);
check("stock expense can't have been recorded -> buy cost alone", costOfGoodsCents(sale({ stockExpensesCents: 0 })), 7_800_000);

console.log("\nfinance split");
const none = { periodExpenses: [], sales: [], allStockExpenses: [], pianosWithSale: new Set<string>() };
check("service profit = collected − job costs", financeSplit({ ...none, serviceCollectedCents: 1_000_000, periodExpenses: [
  { amountCents: 100_000, category: "fuel" }, { amountCents: 50_000, category: "meals", kind: "job" },
] }).service, { collectedCents: 1_000_000, jobCostCents: 150_000, profitCents: 850_000 });
check("overhead is its own line and not in service profit", (() => {
  const r = financeSplit({ ...none, serviceCollectedCents: 1_000_000, periodExpenses: [{ amountCents: 300_000, category: "rent" }, { amountCents: 100_000, category: "marketing" }] });
  return [r.service.profitCents, r.overhead.cents, r.netCents];
})(), [1_000_000, 400_000, 600_000]);
check("stock expenses do NOT hit profit before the piano is sold", (() => {
  const r = financeSplit({
    ...none, serviceCollectedCents: 500_000,
    periodExpenses: [{ amountCents: 7_000_000, category: "other", kind: "stock", pianoId: "p1" }],
    allStockExpenses: [{ pianoId: "p1", amountCents: 7_000_000 }],
  });
  return [r.service.profitCents, r.overhead.cents, r.sales.profitCents, r.stockOnHandCents, r.netCents];
})(), [500_000, 0, 0, 7_000_000, 500_000]);
check("once sold, stock becomes cost of goods in Piano sales profit (and leaves stock on hand)", (() => {
  const r = financeSplit({
    ...none, serviceCollectedCents: 500_000,
    periodExpenses: [{ amountCents: 7_000_000, category: "other", kind: "stock", pianoId: "p1" }],
    sales: [sale()], allStockExpenses: [{ pianoId: "p1", amountCents: 7_000_000 }], pianosWithSale: new Set(["p1"]),
  });
  return [r.sales.revenueCents, r.sales.costOfGoodsCents, r.sales.profitCents, r.stockOnHandCents, r.service.profitCents, r.netCents];
})(), [12_000_000, 7_800_000, 4_200_000, 0, 500_000, 4_700_000]);
check("a piano sold in an earlier period is neither on hand nor in this period's profit", (() => {
  const r = financeSplit({ ...none, serviceCollectedCents: 0, allStockExpenses: [{ pianoId: "old", amountCents: 3_000_000 }], pianosWithSale: new Set(["old"]) });
  return [r.sales.profitCents, r.stockOnHandCents];
})(), [0, 0]);
check("stock with no piano chosen stays on hand (flagged, never silently counted)", financeSplit({ ...none, serviceCollectedCents: 0, allStockExpenses: [{ pianoId: null, amountCents: 900_000 }] }).stockOnHandCents, 900_000);
check("a sale at a loss gives negative sales profit", financeSplit({ ...none, serviceCollectedCents: 0, sales: [sale({ salePriceCents: 6_000_000 })] }).sales.profitCents, -1_800_000);
check("service, sales and overhead stay separate in the total", (() => {
  const r = financeSplit({
    ...none, serviceCollectedCents: 2_000_000, sales: [sale()],
    periodExpenses: [{ amountCents: 200_000, category: "fuel" }, { amountCents: 500_000, category: "rent" }],
  });
  return [r.service.profitCents, r.sales.profitCents, r.overhead.cents, r.netCents];
})(), [1_800_000, 4_200_000, 500_000, 5_500_000]);

if (failures) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
console.log("\nall finance split checks passed");
