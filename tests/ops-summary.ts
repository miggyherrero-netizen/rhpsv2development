/** Daily Operations Summary: pure builder + static read-only / owner-only guards. No database. Run: npx tsx tests/ops-summary.ts */
import { readFileSync } from "node:fs";
import { buildOpsSummary, summaryToText, type OpsSummaryInput } from "../src/lib/ops-summary";

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) { failures++; console.error(`  ✗ ${name}\n      expected ${e}\n      actual   ${a}`); }
  else console.log(`  ✓ ${name}`);
}

// Wed 2026-10-07 14:00 Manila = 06:00Z. Manila today = [2026-10-06T16:00Z, 2026-10-07T16:00Z)
const now = new Date("2026-10-07T06:00:00Z");
const empty: OpsSummaryInput = {
  now, jobsToday: [], unfinishedJobs: [], next7Count: 0, reminders: [], recalls: [], unpaid: [],
  draftInvoices: { count: 0, totalCents: 0 }, outstandingCents: 0, overdueCents: 0, tasks: [], projects: [],
};
const job = (id: string, start: string | null, over: Partial<OpsSummaryInput["jobsToday"][number]> = {}) => ({
  id, title: `Tuning ${id}`, serviceType: "tuning", status: "scheduled", scheduledStart: start ? new Date(start) : null, customerName: `Customer ${id}`, area: "Davao", pianoLabel: "Yamaha U1", ...over,
});

console.log("empty data");
const e = buildOpsSummary(empty);
check("empty day has no priorities", e.priorities, []);
check("empty counts are zero", [e.appointments.count, e.followUps.count, e.maintenance.count, e.workshop.openTasks, e.financial.items.length], [0, 0, 0, 0, 0]);
check("empty workshop is reported as missing", e.missing.includes("No workshop projects or tasks were found."), true);
check("Manila date label", e.dateManila, "2026-10-07");
check("text export works on an empty day", summaryToText(e).includes("Nothing needs attention right now."), true);

console.log("\nappointments and Manila time");
const a = buildOpsSummary({ ...empty, jobsToday: [job("b", "2026-10-07T02:00:00Z"), job("a", "2026-10-06T23:30:00Z"), job("n", null, { pianoLabel: null })] });
check("sorted by start, unscheduled last", a.appointments.items.map((x) => x.id), ["a", "b", "n"]);
check("time shown in Manila (23:30Z = 7:30 AM)", a.appointments.items[0]!.time, "7:30 AM");
check("no start time is stated, not invented", a.appointments.items[2]!.time, "time not set");
check("missing piano is 'Piano (info needed)', never N/A", a.appointments.items[2]!.piano, "Piano (info needed)");
check("missing start time is listed as missing info", a.missing.includes("Some visits today have no start time."), true);

console.log("\nreminders (the only follow-ups that can be overdue)");
const r = buildOpsSummary({ ...empty, reminders: [
  { id: "tomorrow", customerName: "T", note: null, dueAt: new Date("2026-10-07T16:00:00Z") },
  { id: "today", customerName: "D", note: "call", dueAt: new Date("2026-10-06T16:00:00Z") },
  { id: "late", customerName: "L", note: null, dueAt: new Date("2026-10-05T16:00:00Z") },
] });
check("tomorrow 00:00 Manila is not due yet", r.followUps.items.map((x) => x.id), ["late", "today"]);
check("states", r.followUps.items.map((x) => x.state), ["overdue", "today"]);

console.log("\nrecalls are never overdue");
const rc = buildOpsSummary({ ...empty, recalls: [
  { pianoId: "p1", pianoLabel: null, customerName: "A", nextServiceDueAt: new Date("2026-09-01T00:00:00Z") },
  { pianoId: "p2", pianoLabel: "Kawai K-300", customerName: "B", nextServiceDueAt: new Date("2026-10-06T16:30:00Z") },
  { pianoId: "p3", pianoLabel: "Steinway", customerName: "C", nextServiceDueAt: new Date("2026-10-20T00:00:00Z") },
] });
check("timings use neutral words", rc.maintenance.items.map((m) => m.timing), ["date passed", "today", "upcoming"]);
const rcText = JSON.stringify(rc.maintenance) + summaryToText(rc).split("Piano maintenance")[1]!.split("Priorities")[0];
check("no 'overdue' wording and no day counts for recalls", /overdue|days/i.test(rcText), false);
check("piano with no info reads 'Piano (info needed)'", rc.maintenance.items[0]!.piano, "Piano (info needed)");

console.log("\nmoney passes through unchanged");
const inv = (id: string, balance: number, days: number) => ({ id, code: `INV-2026-000${id}`, customerName: `C${id}`, balanceCents: balance, dueDate: null, daysOverdue: days, status: days > 0 ? "overdue" : "sent" });
const m = buildOpsSummary({ ...empty, outstandingCents: 1_234_567, overdueCents: 800_000, draftInvoices: { count: 2, totalCents: 50_000 }, unpaid: [inv("1", 300_000, 0), inv("2", 500_000, 12), inv("3", 0, 40)] });
check("outstanding/overdue are the stored figures", [m.financial.outstandingCents, m.financial.overdueCents], [1_234_567, 800_000]);
check("zero-balance invoices are dropped, oldest overdue first", m.financial.items.map((i) => i.id), ["2", "1"]);
const op = m.priorities.find((p) => p.key === "overdue-invoices");
check("overdue priority sums only overdue balances", [op?.count, op?.amountCents], [1, 500_000]);
check("no peso figure is invented in the text", summaryToText(m).includes("₱12,345.67"), true);

console.log("\nworkshop");
const w = buildOpsSummary({ ...empty, tasks: [
  { id: "t1", title: "Regulate", status: "backlog", priority: "normal", dueDate: new Date("2026-10-01T00:00:00Z"), waitingParts: false, assigneeNames: [], projectName: "P1" },
  { id: "t2", title: "Strings", status: "in_progress", priority: "urgent", dueDate: null, waitingParts: true, assigneeNames: ["Ben"], projectName: "P1" },
  { id: "t3", title: "Done one", status: "done", priority: "low", dueDate: null, waitingParts: false, assigneeNames: ["Ben"], projectName: null },
], projects: [{ id: "p", clientName: "Cruz", pianoName: "Baldwin", status: "in_progress", progress: 40, dueDate: null, workerName: "Ben", openTasks: 2 }, { id: "q", clientName: "Done", pianoName: "X", status: "delivered", progress: 100, dueDate: null, workerName: null, openTasks: 0 }] });
check("done tasks excluded; counts", [w.workshop.openTasks, w.workshop.unassignedTasks, w.workshop.waitingPartsTasks, w.workshop.overdueTasks], [2, 1, 1, 1]);
check("overdue first, then priority", w.workshop.items.map((t) => t.id), ["t1", "t2"]);
check("finished projects are not 'open'", w.workshop.openProjects, 1);

console.log("\npriorities order");
const p = buildOpsSummary({ ...empty, jobsToday: [job("x", "2026-10-07T01:00:00Z")], unfinishedJobs: [job("old", "2026-10-01T01:00:00Z")], recalls: rc.maintenance.items.length ? [{ pianoId: "p", pianoLabel: "K", customerName: "Z", nextServiceDueAt: new Date("2026-10-20T00:00:00Z") }] : [] });
check("high before medium before info", p.priorities.map((x) => x.severity), ["high", "medium", "info"]);

console.log("\nstatic guards (behavioural boundary tests are in tests/ops-handler.ts)");
const strip = (src: string) => src.replace(/\r\n/g, "\n").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const loader = strip(readFileSync("src/server/ops-summary-data.ts", "utf8"));
check("loader has no write calls and avoids the writing reads", /\.(insert|update|delete)\(|getServiceSettings|getTodayBoard|getDashboardBoard|sweepNotNow|getFollowUpsDue|getWaitlist\b|recalc|rollPianoRecall/.test(loader), false);
// Every existing read the loader calls must itself be write-free (found by tracing in review; enforced here so it cannot regress).
const fnBody = (file: string, name: string) => {
  const src = strip(readFileSync(file, "utf8"));
  const start = src.search(new RegExp("export (async )?function " + name + "\\b"));
  if (start < 0) return null;
  const end = src.indexOf("\n}\n", start); // top-level functions in these files close with a "}" at column 0
  return end < 0 ? null : src.slice(start, end + 2);
};
for (const [file, names] of [
  ["src/server/service-data.ts", ["getJobs", "getInvoices", "getReceivablesSnapshot", "getUntrackedRecalls", "getRecalls"]],
  ["src/server/service-reminders-data.ts", ["getRemindersDue", "getOpenReminders"]],
  ["src/server/data.ts", ["getTaskRows", "getProjectRows"]],
] as [string, string[]][]) {
  for (const n of names) {
    const body = fnBody(file, n);
    check(`${n} exists and does not write`, body !== null && !/\.(insert|update|delete)\(|getServiceSettings|sweepNotNow/.test(body), true);
  }
}
check("detector sanity: it does flag getServiceSettings (which inserts a row)", /\.(insert|update|delete)\(/.test(fnBody("src/server/service-data.ts", "getServiceSettings") ?? ""), true);
const page = readFileSync("src/app/owner/assistant/page.tsx", "utf8");
check("page requires login and owner role before loading", page.indexOf("requireUser()") < page.indexOf('user.role !== "owner"') && page.indexOf('user.role !== "owner"') < page.indexOf("getOpsSummary(user.id)"), true);
const route = readFileSync("src/app/api/ops-assistant/report/route.ts", "utf8");
check("route exports POST only", /export async function (GET|PUT|PATCH|DELETE)/.test(route), false);

if (failures) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
console.log("\nall ops-summary checks passed");
