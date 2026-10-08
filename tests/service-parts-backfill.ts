/** Parts-cost drift (Finance health) + backfill plan, mocked live scenarios A and B. No database. Run: npx tsx tests/service-parts-backfill.ts */
import { auditFinance, type AuditInput } from "../src/lib/service-finance-audit";
import { partsCostFromLines } from "../src/lib/service-lines";
import { planPartsCostBackfill } from "../src/lib/service-parts-backfill";
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

/** The OLD rule (before PR #13): a part line with no explicit cost cost its selling price. Used only to reproduce the bug. */
const legacyLineCost = (l: { kind: string; qty: number; unitPriceCents: number; costCents: number }) =>
  l.costCents > 0 ? l.qty * l.costCents : l.kind === "part" ? l.qty * l.unitPriceCents : 0;
const legacyParts = (ls: Parameters<typeof legacyLineCost>[0][]) => ls.reduce((s, l) => s + legacyLineCost(l), 0);

const line = (jobId: string, kind: string, qty: number, price: number, cost = 0) => ({ jobId, kind, qty, unitPriceCents: P(price), costCents: P(cost) });
// Scenario A: WO-2026-0023 (paid). Scenario B: WO-2026-0001 (invoiced).
const linesA = [line("A", "part", 12, 1000), line("A", "service", 6, 750)];
const linesB = [line("B", "service", 1, 3500), line("B", "part", 1, 2100), line("B", "service", 1, 2000), line("B", "service", 1, 1500), line("B", "service", 1, 2500)];

console.log("reproduce the bug with the old rule");
check("A: old rule stored 12,000", legacyParts(linesA), P(12000));
check("B: old rule stored 2,100", legacyParts(linesB), P(2100));

const jobsStoredOld = [
  { id: "A", label: "WO-2026-0023", storedPartsCostCents: P(12000) },
  { id: "B", label: "WO-2026-0001", storedPartsCostCents: P(2100) },
];
const auditInput = (jobs: { id: string; label: string; stored: number }[], lines: typeof linesA): AuditInput => ({
  invoices: [], invoiceItems: [], payments: [], now: new Date("2026-10-08T00:00:00Z"), timeLogs: [], expenses: [],
  jobs: jobs.map((j) => ({ id: j.id, label: j.label, quotedCents: lines.filter((l) => l.jobId === j.id).reduce((s, l) => s + l.qty * l.unitPriceCents, 0), partsCostCents: j.stored, laborCostCents: 0 })),
  jobItems: lines.map((l) => ({ ...l, taxable: false })),
});
const all = [...linesA, ...linesB];
const driftOf = (stored: Record<string, number>) =>
  auditFinance(auditInput(Object.entries(stored).map(([id, s]) => ({ id, label: id, stored: s })), all)).findings.filter((f) => f.code === "job_parts_drift").map((f) => ({ job: f.entity.id, should: f.expectedCents, recorded: f.actualCents }));

console.log("\nFinance health: before backfill");
check("old stored values are flagged: should 0, recorded 12,000 / 2,100", driftOf({ A: P(12000), B: P(2100) }), [
  { job: "A", should: 0, recorded: P(12000) }, { job: "B", should: 0, recorded: P(2100) },
]);

console.log("\nbackfill plan");
const plan = planPartsCostBackfill(jobsStoredOld, all);
check("plan: both jobs go to 0", plan, [
  { jobId: "A", label: "WO-2026-0023", oldCents: P(12000), newCents: 0 },
  { jobId: "B", label: "WO-2026-0001", oldCents: P(2100), newCents: 0 },
]);
check("idempotent: after applying, nothing left to change", planPartsCostBackfill(jobsStoredOld.map((j) => ({ ...j, storedPartsCostCents: 0 })), all), []);
check("after backfill: no health warning", driftOf({ A: 0, B: 0 }), []);

console.log("\nshared function");
check("A parts cost = 0 (null cost is 0, selling price never a cost)", partsCostFromLines(linesA), 0);
check("B parts cost = 0", partsCostFromLines(linesB), 0);
check("part line cost 400 x qty 3 = 1,200", partsCostFromLines([line("X", "part", 3, 1000, 400)]), P(1200));
check("plan uses the same function (cost 400 x 3 -> 1,200)", planPartsCostBackfill([{ id: "X", label: "X", storedPartsCostCents: 0 }], [line("X", "part", 3, 1000, 400)]), [{ jobId: "X", label: "X", oldCents: 0, newCents: P(1200) }]);

console.log("\nScenario A margin is unchanged");
const basisA = jobCostBasis({ partLinesCostCents: partLinesCostFromLines(linesA), otherLinesCostCents: otherLinesCostFromLines(linesA), expenses: [{ amountCents: P(5000), kind: "job", category: "subcontractor" }] });
const mA = jobMargin({ laborCostCents: 0, partsCostCents: basisA.partsCostCents, expenseCents: basisA.expenseCents, invoicedCents: P(16500), taxCents: 0 });
check("A: job cost 5,000, profit 11,500, margin 70%", { cost: mA.costCents, profit: mA.profitCents, pct: mA.marginPct }, { cost: P(5000), profit: P(11500), pct: 70 });

if (failures) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
console.log("\nall parts-cost backfill checks passed");
