/**
 * Home-service reporting rules: drafts vs receivables, ranges (Manila), finance rollup,
 * past-due jobs, display helpers. No database. Run: npx tsx tests/service-reports.ts
 */
import { invoiceStatus, isOverdue, fmtHourShort } from "../src/lib/service";
import {
  isCountable, receivables, draftSummary, billedCents, needsFollowUp, resolveRange, inRange, parseRange,
  financeRollup, compactPeso, chartScale, needsClosing, hasQuote, looksAbbreviated, jobHeading, titleCaseName, isBatchCustomer, withCustomerType,
  type FinInvoice,
} from "../src/lib/service-reports";

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) { failures++; console.error(`  ✗ ${name}\n      expected ${e}\n      actual   ${a}`); }
  else console.log(`  ✓ ${name}`);
}

// "Now" = 2026-10-15 10:00 Manila (02:00 UTC). Manila midnight = 2026-10-14T16:00Z.
const NOW = new Date(Date.UTC(2026, 9, 15, 2, 0, 0));
const manila = (y: number, m: number, d: number, h = 12) => new Date(Date.UTC(y, m - 1, d, h - 8));

const inv = (o: Partial<FinInvoice> & { totalCents: number }): FinInvoice => ({
  status: "sent", amountPaidCents: 0, issueDate: manila(2026, 10, 1), dueDate: manila(2026, 10, 31), sentAt: manila(2026, 10, 1), voidedAt: null, ...o,
});
const draft = inv({ totalCents: 100_000, sentAt: null, status: "draft" });
const sent = inv({ totalCents: 200_000 });
const overdue = inv({ totalCents: 300_000, dueDate: manila(2026, 9, 1), issueDate: manila(2026, 8, 20), sentAt: manila(2026, 8, 20) });
const part = inv({ totalCents: 400_000, amountPaidCents: 150_000 });
const paid = inv({ totalCents: 500_000, amountPaidCents: 500_000, issueDate: manila(2026, 5, 10), sentAt: manila(2026, 5, 10) });
const voided = inv({ totalCents: 600_000, voidedAt: manila(2026, 10, 2) });
const all = [draft, sent, overdue, part, paid, voided];

console.log("drafts are not receivables");
check("draft not countable", isCountable(draft, NOW), false);
check("void not countable", isCountable(voided, NOW), false);
check("sent / overdue / partial / paid are countable", [sent, overdue, part, paid].map((i) => isCountable(i, NOW)), [true, true, true, true]);
const rec = receivables(all, NOW);
check("outstanding = sent 200k + overdue 300k + partial balance 250k", rec.totalOutstandingCents, 750_000);
check("draft and void excluded from AR bucket counts", rec.buckets.reduce((s, b) => s + b.count, 0), 3);
check("overdue amount only the overdue invoice", rec.overdueCents, 300_000);
check("draft summary", draftSummary(all, NOW), { count: 1, totalCents: 100_000 });
check("billed excludes draft + void", billedCents(all, NOW), 200_000 + 300_000 + 400_000 + 500_000);
check("a draft that already has a payment is a real receivable (partial)", isCountable(inv({ totalCents: 100_000, sentAt: null, amountPaidCents: 10_000 }), NOW), true);
check("follow-up = countable with balance, oldest due first", needsFollowUp(all, NOW).map((i) => i.totalCents), [300_000, 200_000, 400_000]);

const stalDraft = inv({ totalCents: 100_000, sentAt: null, status: "draft", dueDate: manila(2026, 1, 1) });
check("a draft past its due date is still just a draft, never 'overdue'", [invoiceStatus(stalDraft, NOW), isOverdue(stalDraft, NOW)], ["draft", false]);
check("a sent invoice past due is overdue", invoiceStatus(overdue, NOW), "overdue");
check("overdue amount ignores past-due drafts", receivables([stalDraft, overdue], NOW).overdueCents, 300_000);

console.log("ranges (Manila)");
const m = resolveRange("month", NOW);
check("month starts Oct 1 00:00 Manila", m.from?.toISOString(), "2026-09-30T16:00:00.000Z");
check("to = start of tomorrow Manila", m.to.toISOString(), "2026-10-15T16:00:00.000Z");
check("90d includes today -> 89 days back", resolveRange("90d", NOW).from?.toISOString(), "2026-07-17T16:00:00.000Z");
check("year starts Jan 1 Manila", resolveRange("year", NOW).from?.toISOString(), "2025-12-31T16:00:00.000Z");
check("all has no lower bound", resolveRange("all", NOW).from, null);
check("Oct 1 00:30 Manila is in this month", inRange(manila(2026, 10, 1, 0.5), m), true);
check("Sep 30 23:30 Manila is not", inRange(manila(2026, 9, 30, 23.5), m), false);
check("bad range falls back to 90d", parseRange("lol"), "90d");
// Server in UTC: Oct 1 01:00 Manila is still Sep 30 17:00 UTC — must belong to October.
check("UTC-vs-Manila month boundary", inRange(new Date(Date.UTC(2026, 8, 30, 17)), m), true);

console.log("finance rollup");
const payments = [
  { receivedAt: manila(2026, 10, 5), amountCents: 150_000 },
  { receivedAt: manila(2026, 5, 12), amountCents: 500_000 },
];
const expenses = [
  { spentAt: manila(2026, 10, 3), amountCents: 20_000, category: "fuel" },
  { spentAt: manila(2026, 10, 9), amountCents: 30_000, category: "fuel" },
  { spentAt: manila(2026, 9, 1), amountCents: 70_000, category: "parts" },
  { spentAt: manila(2026, 2, 1), amountCents: 90_000, category: "rent" },
];
const month = financeRollup({ invoices: all, payments, expenses }, "month", NOW);
check("month: invoiced = sent + partial issued in Oct (draft/void excluded)", month.invoicedCents, 200_000 + 400_000);
check("month: collected only Oct payments", month.collectedCents, 150_000);
check("month: expenses only Oct", month.expenseCents, 50_000);
check("month: net = collected - expenses", month.netCents, 100_000);
check("month: category follows range", month.expenseByCategory, [{ category: "fuel", amountCents: 50_000, count: 2 }]);
check("month: collection rate = paid on invoiced-in-range", month.collectionRatePct, Math.round((150_000 / 600_000) * 100));
check("month: AR ignores range", month.aging.totalOutstandingCents, 750_000);
check("month: drafts reported separately", month.drafts, { count: 1, totalCents: 100_000 });
check("month: daily series 1..15", [month.granularity, month.series.length, month.series[0].label, month.series[14].label], ["day", 15, "Oct 1", "Oct 15"]);
check("month: Oct 5 collected lands on that day", month.series[4].collectedCents, 150_000);
const d90 = financeRollup({ invoices: all, payments, expenses }, "90d", NOW);
check("90d: includes Aug-Oct invoices, not May", d90.invoicedCents, 200_000 + 300_000 + 400_000);
check("90d: expenses Sep + Oct", d90.expenseCents, 120_000);
check("90d: monthly series Jul..Oct", d90.series.map((p) => p.key), ["2026-07", "2026-08", "2026-09", "2026-10"]);
const yr = financeRollup({ invoices: all, payments, expenses }, "year", NOW);
check("year: Jan..Oct = 10 months", yr.series.length, 10);
check("year: includes May payment", yr.collectedCents, 650_000);
const everything = financeRollup({ invoices: all, payments, expenses }, "all", NOW);
check("all: includes February rent", everything.expenseCents, 210_000);
check("all: series is capped and ends this month", [everything.series.length <= 24, everything.series.at(-1)?.key], [true, "2026-10"]);
check("series sums match totals", [d90.series.reduce((s, p) => s + p.invoicedCents, 0), d90.series.reduce((s, p) => s + p.expenseCents, 0)], [d90.invoicedCents, d90.expenseCents]);
const empty = financeRollup({ invoices: [], payments: [], expenses: [] }, "all", NOW);
check("empty books: zeros, no NaN", [empty.invoicedCents, empty.collectionRatePct, empty.netCents], [0, 0, 0]);

console.log("chart axis");
check("compact peso", [compactPeso(0), compactPeso(85_000), compactPeso(1_250_000), compactPeso(125_000_000), compactPeso(-250_000)], ["₱0", "₱850", "₱12.5k", "₱1.3M", "−₱2.5k"]);
const sc = chartScale(1_234_500);
check("axis max covers the tallest value", sc.max >= 1_234_500, true);
check("axis has 5 ticks from 0, evenly spaced", [sc.ticks.length, sc.ticks[0], sc.ticks[1] - sc.ticks[0] === sc.ticks[2] - sc.ticks[1]], [5, 0, true]);
check("axis nice step (₱12,345 -> ₱5k steps up to ₱20k)", chartScale(1_234_500).ticks, [0, 500_000, 1_000_000, 1_500_000, 2_000_000]);
check("empty chart still has an axis", chartScale(0).max > 0, true);

console.log("calendar labels");
check("hour labels never carry :00 (so they can't wrap)", [fmtHourShort(600), fmtHourShort(540), fmtHourShort(720), fmtHourShort(0), fmtHourShort(990)], ["10 AM", "9 AM", "12 PM", "12 AM", "4:30 PM"]);

console.log("past-due jobs");
const job = (status: string, start: Date | null) => ({ status, scheduledStart: start });
check("yesterday + scheduled -> needs closing", needsClosing(job("scheduled", manila(2026, 10, 14, 9)), NOW), true);
check("yesterday + en route / on site too", [needsClosing(job("en_route", manila(2026, 10, 10)), NOW), needsClosing(job("in_progress", manila(2026, 10, 10)), NOW)], [true, true]);
check("earlier today is not past-due yet", needsClosing(job("scheduled", manila(2026, 10, 15, 7)), NOW), false);
check("completed / cancelled / lead never flagged", ["completed", "cancelled", "lead", "on_hold"].map((s) => needsClosing(job(s, manila(2026, 10, 1)), NOW)), [false, false, false, false]);
check("unscheduled never flagged", needsClosing(job("scheduled", null), NOW), false);
check("no quote", [hasQuote(0), hasQuote(null), hasQuote(150_000)], [false, false, true]);

console.log("display helpers");
check("TNG is an abbreviation", looksAbbreviated("TNG"), true);
check("short lowercase word is too", looksAbbreviated("tune"), true);
check("empty title", looksAbbreviated(""), true);
check("real description is not", looksAbbreviated("Annual tuning at the chapel"), false);
check("exact type label is not", looksAbbreviated("Tuning"), false);
check("heading falls back to job type, keeps original as sub-line", jobHeading("TNG", "tuning"), { heading: "Tuning", sub: "TNG" });
check("normal title is kept", jobHeading("Standard tuning — Yamaha U1", "tuning"), { heading: "Standard tuning — Yamaha U1", sub: null });
check("Title Case from lowercase", titleCaseName("maria dela cruz"), "Maria Dela Cruz");
check("Title Case from UPPERCASE", titleCaseName("JUAN DE LA CRUZ"), "Juan De La Cruz");
check("honorifics", titleCaseName("ATTY. NIKKI A."), "Atty. Nikki A.");
check("mixed case untouched", ["McDonald Reyes", "dela Cruz", "BDO Bank"].map(titleCaseName), ["McDonald Reyes", "dela Cruz", "BDO Bank"]);
check("acronym kept in all-caps name", titleCaseName("BDO BANK"), "BDO Bank");
check("hyphen / apostrophe", titleCaseName("anne-marie o'brien"), "Anne-Marie O'Brien");
check("blank", titleCaseName("  "), "");
check("batch tag", [isBatchCustomer(["type:batch"]), isBatchCustomer(["vip"]), isBatchCustomer(null)], [true, false, false]);
check("name with 'Trip' / 'Batch' is treated as a batch", [isBatchCustomer([], "Gensan Trip"), isBatchCustomer(null, "Davao Batch 2"), isBatchCustomer([], "Tripp Santos"), isBatchCustomer([], "Maria Santos")], [true, true, false, false]);
check("explicit client tag overrides the name guess", isBatchCustomer(["type:client"], "Gensan Trip"), false);
check("withCustomerType keeps other tags and replaces the old type", withCustomerType(["vip", "type:batch"], "client"), ["vip", "type:client"]);
check("withCustomerType batch", withCustomerType(undefined, "batch"), ["type:batch"]);

if (failures) { console.error(`\n${failures} failure(s)`); process.exit(1); }
console.log("\nall service report checks passed");
