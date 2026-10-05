/** Piano sale jobs, profit per piano, recalls. No database. Run: npx tsx tests/service-sale.ts */
import { saleBalanceCents, salePianoProfit, suggestedBuyCostCents, saleReadyToComplete, countsAsTuning, recallDueDate, pianoRequired } from "../src/lib/service-sale";

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) { failures++; console.error(`  ✗ ${name}\n      expected ${e}\n      actual   ${a}`); }
  else console.log(`  ✓ ${name}`);
}

console.log("sale balance");
check("balance = price − deposit while open", saleBalanceCents({ salePriceCents: 12_000_000, depositCents: 2_000_000 }, false), 10_000_000);
check("a completed sale is settled (balance taken at delivery)", saleBalanceCents({ salePriceCents: 12_000_000, depositCents: 2_000_000 }, true), 0);
check("deposit above the price never gives a negative balance", saleBalanceCents({ salePriceCents: 1_000_000, depositCents: 1_500_000 }, false), 0);

console.log("\nprofit per piano");
const f = { salePriceCents: 12_000_000, depositCents: 2_000_000, buyCostCents: 7_000_000, prepCostCents: 800_000, stockExpensesCents: 7_000_000 };
check("price − (buy + prep)", salePianoProfit(f), { revenueCents: 12_000_000, costOfGoodsCents: 7_800_000, profitCents: 4_200_000, marginPct: 35 });
check("stock expenses larger than the typed buy cost are never ignored", salePianoProfit({ ...f, buyCostCents: 0, stockExpensesCents: 7_500_000 }).costOfGoodsCents, 8_300_000);
check("selling at a loss shows a negative profit", salePianoProfit({ ...f, salePriceCents: 6_000_000 }).profitCents, -1_800_000);
check("no price -> 0% margin, no divide by zero", salePianoProfit({ ...f, salePriceCents: 0 }).marginPct, 0);
check("buy cost prefills from the stock expenses", suggestedBuyCostCents(7_000_000), 7_000_000);
check("completing needs a piano and a price", [saleReadyToComplete({ salePianoId: null, salePriceCents: 1 }), saleReadyToComplete({ salePianoId: "p", salePriceCents: 0 }), saleReadyToComplete({ salePianoId: "p", salePriceCents: 1 })], ["Choose the piano being sold first.", "Enter the sale price first.", null]);

console.log("\nrecalls");
check("only tuning-type visits count as a tuning", ["tuning", "maintenance", "repair", "assessment", "voicing"].map(countsAsTuning), [true, true, false, false, false]);
check("last tuning + 6 months", recallDueDate(new Date("2026-03-10T00:00:00Z"), 6)?.toISOString().slice(0, 10), "2026-09-10");
check("12-month interval", recallDueDate(new Date("2026-03-10T00:00:00Z"), 12)?.toISOString().slice(0, 10), "2027-03-10");
check("Jan 31 + 1 month lands on the last day of February", recallDueDate(new Date("2026-01-31T00:00:00Z"), 1)?.toISOString().slice(0, 10), "2026-02-28");
check("leap year February", recallDueDate(new Date("2027-12-31T00:00:00Z"), 2)?.toISOString().slice(0, 10), "2028-02-29");
check("never tuned -> no due date", recallDueDate(null, 6), null);
check("a bad interval falls back to 6 months", recallDueDate(new Date("2026-01-15T00:00:00Z"), 0)?.toISOString().slice(0, 10), "2026-07-15");

console.log("\nnew job needs a piano");
check("service job needs one", pianoRequired({ jobType: "service", customerIsBatch: false }), true);
check("trip / batch placeholder customers are exempt", pianoRequired({ jobType: "service", customerIsBatch: true }), false);
check("a sale names its own piano", pianoRequired({ jobType: "sale", customerIsBatch: false }), false);

if (failures) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
console.log("\nall sale checks passed");
