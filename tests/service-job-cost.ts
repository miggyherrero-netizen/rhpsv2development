/** Job cost rules R1+R2+F - pure. Run: npx tsx tests/service-job-cost.ts */
import { jobCostBasis } from "../src/lib/service-job-cost";
import { partLinesCostFromLines, otherLinesCostFromLines } from "../src/lib/service-lines";
import { jobMargin } from "../src/lib/service";

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) { failures++; console.error(`  ✗ ${name}\n      expected ${e}\n      actual   ${a}`); }
  else console.log(`  ✓ ${name}`);
}

const P = (pesos: number) => pesos * 100;
type Ex = { amountCents: number; kind?: string | null; category?: string | null };
const ex = (pesos: number, category: string, kind: string | null | undefined = "job"): Ex => ({ amountCents: P(pesos), kind, category });

/** Profit through the same path the job page and Finance use: lines -> jobCostBasis -> jobMargin (ex-VAT, one paid invoice). */
function profit(o: { revenue: number; labor?: number; lines?: { kind: string; qty: number; unitPriceCents: number; costCents?: number }[]; expenses?: Ex[] }) {
  const basis = jobCostBasis({ partLinesCostCents: partLinesCostFromLines(o.lines ?? []), otherLinesCostCents: otherLinesCostFromLines(o.lines ?? []), expenses: o.expenses ?? [] });
  return jobMargin({ laborCostCents: P(o.labor ?? 0), partsCostCents: basis.partsCostCents, expenseCents: basis.expenseCents, invoicedCents: P(o.revenue), taxCents: 0 }).profitCents / 100;
}
const part = (sold: number, cost?: number) => ({ kind: "part", qty: 1, unitPriceCents: P(sold), costCents: cost ? P(cost) : 0 });

console.log("scenarios (pesos)");
check("A labor 250 + fuel 300 + meals 200 on a 3,000 service = 2,250", profit({ revenue: 3000, labor: 250, lines: [{ kind: "service", qty: 1, unitPriceCents: P(3000) }], expenses: [ex(300, "fuel"), ex(200, "meals")] }), 2250);
check("B part sold 2,000 no cost + materials 1,500 = 500", profit({ revenue: 2000, lines: [part(2000)], expenses: [ex(1500, "materials")] }), 500);
check("C part sold 2,000 cost 1,500 + same purchase as materials 1,500 = 500", profit({ revenue: 2000, lines: [part(2000, 1500)], expenses: [ex(1500, "materials")] }), 500);
check("D explicit cost 1,500, no expense = 500", profit({ revenue: 2000, lines: [part(2000, 1500)] }), 500);
check("E part sold 2,000 no cost, no expense = 2,000", profit({ revenue: 2000, lines: [part(2000)] }), 2000);
check("F rent 5,000 (overhead) linked to a 3,000 job = 3,000", profit({ revenue: 3000, lines: [{ kind: "service", qty: 1, unitPriceCents: P(3000) }], expenses: [ex(5000, "rent", "overhead")] }), 3000);
check("G subcontractor 4,000 on a 6,000 service line = 2,000", profit({ revenue: 6000, lines: [{ kind: "service", qty: 1, unitPriceCents: P(6000) }], expenses: [ex(4000, "subcontractor")] }), 2000);

console.log("\njobCostBasis");
check("legacy null/undefined kind counts as before", jobCostBasis({ otherLinesCostCents: 0, partLinesCostCents: 0, expenses: [ex(100, "fuel", null), ex(50, "meals", undefined)] }), { partsCostCents: 0, expenseCents: P(150), partsFromExpenses: false });
check("overhead and stock are excluded", jobCostBasis({ otherLinesCostCents: 0, partLinesCostCents: 0, expenses: [ex(100, "rent", "overhead"), ex(200, "materials", "stock"), ex(30, "fuel")] }), { partsCostCents: 0, expenseCents: P(30), partsFromExpenses: false });
check("materials expense overrides an explicit part cost", jobCostBasis({ otherLinesCostCents: 0, partLinesCostCents: P(1500), expenses: [ex(1200, "materials")] }), { partsCostCents: 0, expenseCents: P(1200), partsFromExpenses: true });
check("parts category also overrides", jobCostBasis({ otherLinesCostCents: 0, partLinesCostCents: P(900), expenses: [ex(10, "parts")] }).partsFromExpenses, true);
check("legacy null-kind materials expense overrides too", jobCostBasis({ otherLinesCostCents: 0, partLinesCostCents: P(900), expenses: [ex(10, "materials", null)] }).partsCostCents, 0);
check("a zero-amount materials row does not override the part cost", jobCostBasis({ otherLinesCostCents: 0, partLinesCostCents: P(900), expenses: [ex(0, "materials")] }).partsCostCents, P(900));
check("materials expense that is overhead/stock does NOT override the part cost", jobCostBasis({ otherLinesCostCents: 0, partLinesCostCents: P(900), expenses: [ex(10, "materials", "stock")] }), { partsCostCents: P(900), expenseCents: 0, partsFromExpenses: false });
check("no materials expense keeps the part-line cost", jobCostBasis({ otherLinesCostCents: 0, partLinesCostCents: P(900), expenses: [ex(40, "fuel")] }), { partsCostCents: P(900), expenseCents: P(40), partsFromExpenses: false });
check("no expenses at all", jobCostBasis({ otherLinesCostCents: 0, partLinesCostCents: P(5), expenses: [] }), { partsCostCents: P(5), expenseCents: 0, partsFromExpenses: false });

console.log("\nR2 replaces part lines only");
const fee = { kind: "fee", qty: 1, unitPriceCents: P(3000), costCents: P(1500) };
const partL = { kind: "part", qty: 1, unitPriceCents: P(900), costCents: P(500) };
const lines2 = [partL, fee];
const basisOf = (expenses: Ex[]) => jobCostBasis({ partLinesCostCents: partLinesCostFromLines(lines2), otherLinesCostCents: otherLinesCostFromLines(lines2), expenses });
check("part 500 + fee 1500 + materials expense 800 -> parts cost 1500, expense 800", basisOf([ex(800, "materials")]), { partsCostCents: P(1500), expenseCents: P(800), partsFromExpenses: true });
check("same lines, no expense -> 2000", basisOf([]).partsCostCents, P(2000));
check("part line with no cost -> 0", partLinesCostFromLines([{ kind: "part", qty: 2, unitPriceCents: P(900) }]), 0);

if (failures) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
console.log("\nall job cost checks passed");
