/** Dashboard helpers (month series, change, attention queue, crew, pipeline). No database. Run: npx tsx tests/service-dashboard.ts */
import { attentionQueue, barPct, buildMonthSeries, crewStatus, deltaOf, lastMonths, marginPct, pipelineCounts } from "../src/lib/service-dashboard";
import { financeRollup } from "../src/lib/service-reports";

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) { failures++; console.error(`  ✗ ${name}\n      expected ${e}\n      actual   ${a}`); }
  else console.log(`  ✓ ${name}`);
}

// Wed 2026-10-07 14:00 Manila
const now = new Date("2026-10-07T06:00:00Z");

console.log("months");
const slots = lastMonths(now, 6);
check("six months, oldest first, ending this month", slots.map((s) => s.key), ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"]);
check("month starts at Manila midnight", slots[5]!.from.toISOString(), "2026-09-30T16:00:00.000Z");
check("month ends at next month's Manila midnight", slots[5]!.to.toISOString(), "2026-10-31T16:00:00.000Z");
check("labels", slots[0]!.label, "May 26");
check("crosses the year", lastMonths(new Date("2026-02-10T00:00:00Z"), 4).map((s) => s.key), ["2025-11", "2025-12", "2026-01", "2026-02"]);

console.log("\nseries matches the Finance rollup");
const inv = (issueDate: string, total: number, paid: number, extra: Record<string, unknown> = {}) =>
  ({ issueDate, totalCents: total, amountPaidCents: paid, dueDate: null, sentAt: new Date(issueDate), voidedAt: null, status: "sent", ...extra });
const invoices = [
  inv("2026-10-02T02:00:00Z", 500_000, 200_000),
  inv("2026-09-30T16:30:00Z", 300_000, 0),           // 00:30 Oct 1 Manila -> October
  inv("2026-09-30T15:30:00Z", 100_000, 100_000),     // 23:30 Sep 30 Manila -> September
  inv("2026-09-10T02:00:00Z", 900_000, 0, { sentAt: null, status: "draft" }), // draft: not counted
  inv("2026-08-10T02:00:00Z", 700_000, 0, { voidedAt: new Date("2026-08-11") }), // void: not counted
];
const payments = [{ receivedAt: "2026-10-03T02:00:00Z", amountCents: 200_000 }, { receivedAt: "2026-09-30T15:59:00Z", amountCents: 100_000 }];
const expenses = [{ spentAt: "2026-10-04T02:00:00Z", amountCents: 50_000, category: "parts" }, { spentAt: "2026-04-30T02:00:00Z", amountCents: 99_999, category: "parts" }];
const series = buildMonthSeries({ invoices, payments, expenses }, now, 6);
const oct = series[5]!, sep = series[4]!;
check("October invoiced", oct.invoicedCents, 800_000);
check("September invoiced (drafts and voids excluded)", sep.invoicedCents, 100_000);
check("collected per month", [sep.collectedCents, oct.collectedCents], [100_000, 200_000]);
check("expense outside the window is ignored", series.reduce((n, m) => n + m.expenseCents, 0), 50_000);
const rollup = financeRollup({ invoices, payments, expenses }, "month", now);
check("this month equals Finance 'This month'", [oct.invoicedCents, oct.collectedCents, oct.expenseCents], [rollup.invoicedCents, rollup.collectedCents, rollup.expenseCents]);

console.log("\nchange");
check("up", deltaOf(1_200, 1_000), { direction: "up", pct: 20, text: "Up 20% on last month" });
check("down", deltaOf(750, 1_000), { direction: "down", pct: 25, text: "Down 25% on last month" });
check("flat", deltaOf(1_000, 1_000).direction, "flat");
check("nothing before: no percentage", deltaOf(500, 0), { direction: "none", pct: null, text: "Nothing to compare with last month" });
check("margin", marginPct(250, 1_000), 25);
check("negative margin", marginPct(-100, 1_000), -10);
check("no income: no margin", marginPct(-100, 0), null);

console.log("\nattention queue");
const base = {
  overdueInvoices: { count: 0 }, drafts: { count: 0 }, closeOut: 0, remindersDue: 0, recallsDue: 0, staleQuotes: 0,
  waitlistFollowUps: 0, unreviewedExpenses: null, health: null,
};
check("empty when nothing is due", attentionQueue(base), []);
const q = attentionQueue({
  ...base, overdueInvoices: { count: 2, amountCents: 450_000 }, drafts: { count: 1, amountCents: 10_000 }, remindersDue: 3,
  recallsDue: 4, staleQuotes: 1, unreviewedExpenses: 5, health: { errors: 1, warnings: 2 },
});
check("danger first, then warnings, then reviews", q.map((i) => i.key), ["overdue", "health_errors", "reminders", "drafts", "quotes", "recalls", "expenses", "health_warnings"]);
check("overdue carries its amount", q[0]!.amountCents, 450_000);
check("no finance: no money, no finance items", attentionQueue({ ...base, drafts: { count: 2 }, remindersDue: 1 }).map((i) => [i.key, i.amountCents]), [["reminders", undefined], ["drafts", undefined]]);

console.log("\ncrew");
const t = [{ id: "a", name: "Ana", color: "#38bdf8" }, { id: "b", name: "Ben", color: null }, { id: "c", name: "Cy", color: null }];
const job = (id: string, tech: string | null, status: string, h: number) => ({ id, title: id, status, scheduledStart: new Date(Date.UTC(2026, 9, 7, h)), technicianId: tech, customerName: "X", area: "Makati" });
const crew = crewStatus([job("1", "a", "completed", 1), job("2", "a", "in_progress", 3), job("3", "b", "scheduled", 5), job("4", "b", "scheduled", 2), job("5", null, "scheduled", 4), job("6", "a", "cancelled", 6)], t);
check("on site wins; done counted; cancelled ignored", [crew[0]!.name, crew[0]!.state, crew[0]!.done, crew[0]!.total, crew[0]!.jobId], ["Ana", "on_site", 1, 2, "2"]);
check("next visit is the earliest not-started one", crew.find((c) => c.name === "Ben")!.jobId, "4");
check("unassigned visits get their own row", crew.some((c) => c.technicianId === null && c.total === 1), true);
check("technicians with no visits sort last", crew[crew.length - 1]!.state, "idle");
check("all done", crewStatus([job("1", "a", "paid", 1)], t)[0]!.state, "done");
check("no unassigned row when none", crewStatus([job("1", "a", "paid", 1)], t).some((c) => c.technicianId === null), false);

console.log("\npipeline and bars");
check("fixed order with zeros", pipelineCounts([{ status: "quoted", count: 2 }, { status: "in_progress", count: 1 }]).map((r) => r.count), [0, 2, 0, 0, 1, 0]);
check("bar percent", [barPct(50, 100), barPct(0, 100), barPct(1, 1000), barPct(5, 0)], [50, 0, 3, 0]);

if (failures) { console.error(`\n${failures} failed`); process.exit(1); }
console.log("\nAll dashboard checks passed");
