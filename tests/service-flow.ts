/** Job flow, type-to-confirm, due dates, money input, access. No database. Run: npx tsx tests/service-flow.ts */
import {
  nextJobStep, stepEffect, confirmMatches, demoLoadAllowed, quoteCode, defaultDueDate, manilaDateTimeLocal,
  parsePesoInput, billedHeadline, canViewFinance, parseMessengerHandle, messengerHandle, withMessenger, quoteStatus, quoteLines, type StepKey,
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
check("lead with nothing yet -> schedule", key("lead", { ...ctx, hasLineItems: false, hasSchedule: false }), "schedule");
check("lead already scheduled, no quote -> start travel (no dead end)", key("lead", { ...ctx, hasLineItems: false }), "start_travel");
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

console.log("messenger link");
check("handles from links and @names", ["m.me/herrero.pianos", "https://www.facebook.com/herrero.pianos?ref=x", "@herrero_pianos", "herrero.pianos"].map(parseMessengerHandle), ["herrero.pianos", "herrero.pianos", "herrero_pianos", "herrero.pianos"]);
check("junk is rejected", ["", "a b", "ab", "javascript:alert(1)", "https://evil.com/x y"].map(parseMessengerHandle), [null, null, null, null, null]);
check("stored in tags, other tags kept", [messengerHandle(withMessenger(["vip"], "abc.def")), withMessenger(["vip", "messenger:old"], "new.one")], ["abc.def", ["vip", "messenger:new.one"]]);
check("clearing removes it", withMessenger(["vip", "messenger:old"], null), ["vip"]);

console.log("quote lifecycle");
check("lead = draft, quoted = sent", [quoteStatus("lead", []), quoteStatus("quoted", [])], ["draft", "sent"]);
check("accepted event wins until it is invoiced", [quoteStatus("scheduled", [{ type: "quote_accepted" }]), quoteStatus("completed", [{ type: "quote_accepted" }])], ["accepted", "accepted"]);
check("invoiced / paid = converted", [quoteStatus("invoiced", [{ type: "quote_accepted" }]), quoteStatus("paid", [])], ["converted", "converted"]);
const li = [{ kind: "service", description: "Tuning", qty: 1, unitPriceCents: 250_000, taxable: true }];
check("travel fee appears as a line when the job has no fee line", quoteLines(li, 30_000).map((l) => l.description), ["Tuning", "Travel / service call"]);
check("no double travel charge when a fee line exists", quoteLines([...li, { kind: "fee", description: "Call-out", qty: 1, unitPriceCents: 30_000, taxable: true }], 30_000).length, 2);
check("no travel fee -> items untouched", quoteLines(li, 0).length, 1);

console.log("finance access");
check("owner only", [canViewFinance({ role: "owner" }), canViewFinance({ role: "technician" }), canViewFinance({ role: null }), canViewFinance(null)], [true, false, false, false]);

console.log("\npiano sale steps");
const sale = { hasLineItems: false, hasInvoice: false, hasSchedule: true, isSale: true };
check("sale with a delivery date goes out for delivery", nextJobStep("lead", sale)?.label, "Out for delivery");
check("sale without a date asks for one", nextJobStep("lead", { ...sale, hasSchedule: false })?.key, "schedule");
check("sale flow: delivery → delivered → complete sale", ["scheduled", "en_route", "in_progress"].map((st) => nextJobStep(st, sale)?.label), ["Out for delivery", "Delivered", "Complete sale"]);
check("a completed sale has no invoice step (it is sold)", nextJobStep("completed", sale), null);
check("sales skip the quote step even with lines", nextJobStep("lead", { ...sale, hasLineItems: true })?.key, "start_travel");

console.log("\nall service flow checks passed");

check("quote re-sent after acceptance shows Sent", quoteStatus("quoted", [{ type: "quote_accepted" }]), "sent");
check("reopened quote (lead) shows Draft", quoteStatus("lead", [{ type: "quote_accepted" }]), "draft");
check("accepted quote stays accepted once scheduled", quoteStatus("scheduled", [{ type: "quote_accepted" }]), "accepted");
check("messenger rejects profile.php", parseMessengerHandle("https://facebook.com/profile.php?id=123"), null);
check("messenger rejects trailing dot", parseMessengerHandle("juan."), null);
check("messenger accepts m.me link", parseMessengerHandle("https://m.me/juan.dela.cruz"), "juan.dela.cruz");

if (failures) { console.error(`\n${failures} failure(s)`); process.exit(1); }
