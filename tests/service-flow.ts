/** Job flow, type-to-confirm, due dates, money input, access. No database. Run: npx tsx tests/service-flow.ts */
import {
  nextJobStep, stepEffect, confirmMatches, demoLoadAllowed, quoteCode, defaultDueDate, manilaDateTimeLocal,
  parsePesoInput, billedHeadline, canViewFinance, type StepKey,
} from "../src/lib/service-flow";

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) { failures++; console.error(`  ✗ ${name}\n      expected ${e}\n      actual   ${a}`); }
  else console.log(`  ✓ ${name}`);
}
const ctx = { hasLineItems: true, hasInvoice: false, hasSchedule: true };
const key = (status: string, c = ctx) => nextJobStep(status, c)?.key ?? null;

console.log("job next step");
check("lead with quote lines -> send quote", key("lead"), "send_quote");
check("lead with nothing yet -> schedule", key("lead", { ...ctx, hasLineItems: false }), "schedule");
check("quoted -> accept", key("quoted"), "accept_quote");
check("scheduled -> start travel; unscheduled -> schedule", [key("scheduled"), key("scheduled", { ...ctx, hasSchedule: false })], ["start_travel", "schedule"]);
check("travel -> arrived -> complete", [key("en_route"), key("in_progress")], ["arrive", "complete"]);
check("completed -> create invoice (or view if one exists)", [key("completed"), key("completed", { ...ctx, hasInvoice: true })], ["create_invoice", "view_invoice"]);
check("invoiced -> view invoice", key("invoiced"), "view_invoice");
check("paid has nothing left", key("paid"), null);
check("on hold -> resume; cancelled -> reopen", [key("on_hold"), key("cancelled")], ["resume", "reopen"]);
check("main path is exactly Start travel -> Arrived -> Complete -> Create invoice",
  ["scheduled", "en_route", "in_progress", "completed"].map((s) => nextJobStep(s, ctx)!.label), ["Start travel", "Arrived", "Complete job", "Create invoice"]);

console.log("step effects (status + timers)");
check("start travel: status + travel timer", stepEffect("start_travel"), { status: "en_route", stopTimers: true, startTimer: "travel", event: { type: "en_route", message: "Travel started" } });
check("arrived stops travel and starts on-site", [stepEffect("arrive")!.stopTimers, stepEffect("arrive")!.startTimer, stepEffect("arrive")!.status], [true, "work", "in_progress"]);
check("complete stops timers and starts none", [stepEffect("complete")!.stopTimers, stepEffect("complete")!.startTimer], [true, null]);
check("navigation-only steps have no effect", (["schedule", "create_invoice", "view_invoice"] as StepKey[]).map((k) => stepEffect(k)), [null, null, null]);
check("accepting a quote lands on scheduled", stepEffect("accept_quote")!.status, "scheduled");

console.log("type-to-confirm");
check("exact code", confirmMatches("WO-2026-0012", "WO-2026-0012"), true);
check("case and spaces forgiven", confirmMatches("  wo-2026-0012 ", "WO-2026-0012"), true);
check("partial / empty / wrong are rejected", [confirmMatches("WO-2026", "WO-2026-0012"), confirmMatches("", "WO-2026-0012"), confirmMatches("delete", "WO-2026-0012")], [false, false, false]);
check("demo load: free on an empty database", demoLoadAllowed(false, ""), true);
check("demo load: needs the phrase when real data exists", [demoLoadAllowed(true, ""), demoLoadAllowed(true, "load"), demoLoadAllowed(true, "load demo"), demoLoadAllowed(true, "LOAD DEMO")], [false, false, true, true]);

console.log("quotes + dates");
check("quote shares the job number", quoteCode("WO-2026-0012"), "QT-2026-0012");
// 2026-10-15 10:00 Manila
const NOW = new Date(Date.UTC(2026, 9, 15, 2, 0, 0));
check("due date = today + terms (Manila)", defaultDueDate(NOW, 14), "2026-10-29");
check("terms 0 = today", defaultDueDate(NOW, 0), "2026-10-15");
check("crossing a month end", defaultDueDate(NOW, 30), "2026-11-14");
// 2026-10-15 23:30 UTC is already Oct 16 07:30 in Manila
check("late UTC evening is the next Manila day", defaultDueDate(new Date(Date.UTC(2026, 9, 15, 23, 30)), 1), "2026-10-17");
check("datetime-local default is Manila wall clock", manilaDateTimeLocal(NOW), "2026-10-15T10:00");

console.log("money input");
check("peso formats parse", ["2,500", "₱2,500.50", " 2500 ", "0.5", ".75"].map(parsePesoInput), [2500, 2500.5, 2500, 0.5, 0.75]);
check("garbage is rejected", ["", "abc", "12a", "1.2.3", "-5"].map(parsePesoInput), [null, null, null, null, null]);
check("customer headline", [billedHeadline(4, 25_400_000), billedHeadline(1, 0)], ["4 jobs · ₱254,000 billed", "1 job · ₱0 billed"]);

console.log("finance access");
check("owner only", [canViewFinance({ role: "owner" }), canViewFinance({ role: "technician" }), canViewFinance({ role: null }), canViewFinance(null)], [true, false, false, false]);

if (failures) { console.error(`\n${failures} failure(s)`); process.exit(1); }
console.log("\nall service flow checks passed");
