/**
 * Mock-data checks for the Home Service workspace. Realistic piano-service scenarios
 * with hand-calculated expectations (amounts in centavos, PHP).
 *
 * Run with:  npx tsx tests/service-mock.ts
 * No database required.
 */

import {
  computeTotals, lineTotalCents, invoiceStatus, isOverdue, balanceCents, agingSummary, agingBucket,
  daysOverdue, jobMargin, parseLocal, optionalDate, moneyToCents, intOr, boolOr, oneOf, str, strOr,
  elapsedMinutes, toMinutes, fmtMinutes, fmtMinuteOfDay, utilizationPct, sumMinutes,
  serviceTypeMinutes, jobCode, invoiceCode, DEFAULT_WORKING_HOURS, SERVICE_TYPES,
  JOB_STATUSES, JOB_STATUS_TONE, JOB_STATUS_LABEL, OPEN_JOB_STATUSES, CLOSED_JOB_STATUSES,
  INVOICE_STATUS_TONE, INVOICE_STATUS_LABEL, AGING_BUCKETS, avgInvoiceCents, taxLineLabel, fmtRatePct,
  validateReportSettings,
} from "../src/lib/service";

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    failures++;
    console.error(`  ✗ ${name}\n      expected ${e}\n      actual   ${a}`);
  } else {
    console.log(`  ✓ ${name}`);
  }
}

const inv = (o: Partial<{ totalCents: number; amountPaidCents: number; dueDate: string | null; sentAt: string | null; voidedAt: string | null }> = {}) => ({
  status: "sent",
  totalCents: 100_000,
  amountPaidCents: 0,
  dueDate: "2026-09-30T00:00:00Z" as string | null,
  sentAt: null as string | null,
  voidedAt: null as string | null,
  ...o,
});

console.log("line totals and quote arithmetic");
{
  check("fractional qty rounds to centavo (1.5h x 833.33)", lineTotalCents({ qty: 1.5, unitPriceCents: 83_333 }), 125_000);
  check("zero qty is zero", lineTotalCents({ qty: 0, unitPriceCents: 500_000 }), 0);
  // Grand piano: tuning 3,500 + pitch raise 1,500 + strings (3 x 450 taxable) + travel fee 500 exempt
  const lines = [
    { qty: 1, unitPriceCents: 350_000, taxable: true, kind: "service" },
    { qty: 1, unitPriceCents: 150_000, taxable: true, kind: "service" },
    { qty: 3, unitPriceCents: 45_000, taxable: true, kind: "part" },
    { qty: 1, unitPriceCents: 50_000, taxable: false, kind: "fee" },
  ];
  const t = computeTotals(lines, { taxRateBps: 1200 });
  check("subtotal", t.subtotalCents, 685_000);
  check("taxable base", t.taxableCents, 635_000);
  check("VAT 12% of 6,350.00", t.taxCents, 76_200);
  check("total", t.totalCents, 761_200);
  const d = computeTotals(lines, { taxRateBps: 1200, discountCents: 35_000 });
  check("discount lowers tax: 12% of 6,000", d.taxCents, 72_000);
  check("discount total 6,850 - 350 + 720", d.totalCents, 722_000);
  check("no options: no tax, no discount", computeTotals(lines).totalCents, 685_000);
  check("empty lines all zero", computeTotals([]), {
    subtotalCents: 0, discountCents: 0, taxableCents: 0, taxCents: 0, totalCents: 0,
  });
  check("taxable undefined/null counts as taxable", computeTotals(
    [{ qty: 1, unitPriceCents: 100_000 }, { qty: 1, unitPriceCents: 100_000, taxable: null }], { taxRateBps: 1000 },
  ).taxCents, 20_000);
  check("negative discountCents clamps to 0", computeTotals(lines, { discountCents: -5_000 }).discountCents, 0);
  check("negative tax rate clamps to 0", computeTotals(lines, { taxRateBps: -500 }).taxCents, 0);
  check("discount larger than taxable base: tax floors at 0", computeTotals(
    [{ qty: 1, unitPriceCents: 50_000, taxable: true }], { discountCents: 80_000, taxRateBps: 1200 }).taxCents, 0);
  check("discount larger than subtotal yields negative total", computeTotals(
    [{ qty: 1, unitPriceCents: 50_000, taxable: true }], { discountCents: 80_000, taxRateBps: 1200 }).totalCents, -30_000);
  check("tax rounding half-up: 12% of 0.05 => 0.006 -> 1c", computeTotals(
    [{ qty: 1, unitPriceCents: 5, taxable: true }], { taxRateBps: 1200 }).taxCents, 1);
  check("tax rounding: 12% of 0.04 => 0.0048 -> 0c", computeTotals(
    [{ qty: 1, unitPriceCents: 4, taxable: true }], { taxRateBps: 1200 }).taxCents, 0);
  check("fractional discountCents rounds", computeTotals(lines, { discountCents: 100.6 }).discountCents, 101);
}

console.log("invoice status and overdue boundaries");
{
  const now = new Date("2026-09-23T04:00:00Z"); // 12:00 Manila, Sep 23
  check("due today is not overdue", daysOverdue(inv({ dueDate: "2026-09-23T00:00:00Z" }), now), 0);
  check("due yesterday is 1 day overdue", daysOverdue(inv({ dueDate: "2026-09-22T04:00:00Z" }), now), 1);
  check("no due date is never overdue", isOverdue(inv({ dueDate: null }), now), false);
  check("overdue when sent, unpaid and past due", invoiceStatus(inv({ dueDate: "2026-09-01T00:00:00Z", sentAt: "2026-08-20T00:00:00Z" }), now), "overdue");
  check("a draft past its due date stays a draft (not a receivable)", invoiceStatus(inv({ dueDate: "2026-09-01T00:00:00Z" }), now), "draft");
  check("partial payment beats overdue", invoiceStatus(inv({ dueDate: "2026-09-01T00:00:00Z", amountPaidCents: 1 }), now), "partial");
  check("overpayment is paid, balance 0", [invoiceStatus(inv({ amountPaidCents: 120_000 }), now), balanceCents(inv({ amountPaidCents: 120_000 }))], ["paid", 0]);
  check("zero-total invoice with no payment is not paid", invoiceStatus(inv({ totalCents: 0 }), now), "draft");
  check("void invoice never overdue", isOverdue(inv({ dueDate: "2026-01-01T00:00:00Z", voidedAt: "2026-02-01T00:00:00Z" }), now), false);
  check("settled invoice never overdue", isOverdue(inv({ dueDate: "2026-01-01T00:00:00Z", amountPaidCents: 100_000 }), now), false);
  check("sent + not yet due", invoiceStatus(inv({ sentAt: "2026-09-20T00:00:00Z" }), now), "sent");
  // Manila day edges: due 2026-09-23 00:00 Manila == 2026-09-22T16:00Z
  const due = inv({ dueDate: "2026-09-22T16:00:00Z" });
  check("23:59 Manila on due day: 0 overdue", daysOverdue(due, new Date("2026-09-23T15:59:00Z")), 0);
  check("00:00 Manila next day: 1 overdue", daysOverdue(due, new Date("2026-09-23T16:00:00Z")), 1);
  check("Manila edge: 16:30Z due is Manila next day", daysOverdue(inv({ dueDate: "2026-09-22T16:30:00Z" }), new Date("2026-09-23T04:00:00Z")), 0);
}

console.log("aging buckets on exact boundaries");
{
  const now = new Date("2026-09-23T04:00:00Z");
  const daysAgo = (n: number) => inv({ dueDate: new Date(now.getTime() - n * 86_400_000).toISOString() });
  check("30 days -> 1_30", agingBucket(daysAgo(30), now), "1_30");
  check("31 days -> 31_60", agingBucket(daysAgo(31), now), "31_60");
  check("60 days -> 31_60", agingBucket(daysAgo(60), now), "31_60");
  check("61 days -> 61_90", agingBucket(daysAgo(61), now), "61_90");
  check("90 days -> 61_90", agingBucket(daysAgo(90), now), "61_90");
  check("91 days -> 90_plus", agingBucket(daysAgo(91), now), "90_plus");
  check("no due date -> current", agingBucket(inv({ dueDate: null }), now), "current");

  const s = agingSummary([
    inv({ totalCents: 350_000, dueDate: "2026-10-05T00:00:00Z" }),                         // current 3,500
    inv({ totalCents: 500_000, amountPaidCents: 200_000, dueDate: "2026-09-13T04:00:00Z" }), // 10d, bal 3,000
    inv({ totalCents: 120_000, dueDate: "2026-08-04T04:00:00Z" }),                         // 50d, 1,200
    inv({ totalCents: 800_000, amountPaidCents: 799_999, dueDate: "2026-07-05T04:00:00Z" }), // 80d, bal 1c
    inv({ totalCents: 260_000, dueDate: "2026-03-01T04:00:00Z" }),                         // 206d, 2,600
    inv({ totalCents: 90_000, dueDate: "2026-09-01T00:00:00Z", voidedAt: "2026-09-02T00:00:00Z" }),
  ], now);
  check("bucket amounts", s.buckets.map((b) => b.amountCents), [350_000, 300_000, 120_000, 1, 260_000]);
  check("bucket counts", s.buckets.map((b) => b.count), [1, 1, 1, 1, 1]);
  check("total outstanding", s.totalOutstandingCents, 1_030_001);
  check("overdue total", s.overdueCents, 680_001);
  check("bucket keys follow AGING_BUCKETS order", s.buckets.map((b) => b.key), AGING_BUCKETS.map((b) => b.key));
  check("empty list summary", agingSummary([]).totalOutstandingCents, 0);
}

console.log("job margin edge cases");
{
  const loss = jobMargin({ laborCostCents: 200_000, partsCostCents: 50_000, expenseCents: 10_000, invoicedCents: 200_000 });
  check("loss-making job profit", loss.profitCents, -60_000);
  check("loss-making margin pct", loss.marginPct, -30);
  check("margin rounds 1/3 -> 33", jobMargin({ laborCostCents: 200_000, partsCostCents: 0, expenseCents: 0, invoicedCents: 300_000 }).marginPct, 33);
  check("margin rounds 2/3 -> 67", jobMargin({ laborCostCents: 100_000, partsCostCents: 0, expenseCents: 0, invoicedCents: 300_000 }).marginPct, 67);
  check("free job with no costs", jobMargin({ laborCostCents: 0, partsCostCents: 0, expenseCents: 0, invoicedCents: 0 }), { costCents: 0, profitCents: 0, marginPct: 0, revenueCents: 0 });
}

console.log("time helpers");
{
  check("fmtMinuteOfDay 0 -> 12:00 AM", fmtMinuteOfDay(0), "12:00 AM");
  check("fmtMinuteOfDay 480 -> 8:00 AM", fmtMinuteOfDay(480), "8:00 AM");
  check("fmtMinuteOfDay 720 -> 12:00 PM", fmtMinuteOfDay(720), "12:00 PM");
  check("fmtMinuteOfDay 1080 -> 6:00 PM", fmtMinuteOfDay(1080), "6:00 PM");
  check("fmtMinuteOfDay 845 -> 2:05 PM", fmtMinuteOfDay(845), "2:05 PM");
  check("fmtMinuteOfDay 24h", fmtMinuteOfDay(545, "24h"), "09:05");
  check("fmtMinuteOfDay 24h midnight", fmtMinuteOfDay(0, "24h"), "00:00");
  check("fmtMinuteOfDay 1440 wraps to midnight", fmtMinuteOfDay(1440), "12:00 AM");
  check("fmtMinutes exact hour", fmtMinutes(120), "2h");
  check("fmtMinutes under an hour", fmtMinutes(45), "45m");
  check("fmtMinutes negative clamps", fmtMinutes(-10), "0m");
  check("fmtMinutes null", fmtMinutes(null), "0m");
  check("fmtMinutes rounds 59.6 -> 1h", fmtMinutes(59.6), "1h");
  check("toMinutes rounds", toMinutes(90_000), 2);
  check("toMinutes negative clamps", toMinutes(-60_000), 0);
  check("elapsed: end before start is 0", elapsedMinutes("2026-09-23T03:00:00Z", "2026-09-23T02:00:00Z"), 0);
  check("elapsed: end equals start is 0", elapsedMinutes("2026-09-23T03:00:00Z", "2026-09-23T03:00:00Z"), 0);
  check("elapsed: open log vs explicit now", elapsedMinutes("2026-09-23T01:00:00Z", null, new Date("2026-09-23T02:45:00Z")), 105);
  check("elapsed: ISO strings accepted", elapsedMinutes("2026-09-23T01:00:00Z", "2026-09-23T01:29:31Z"), 30);

  check("utilization 6h of 10h day", utilizationPct(360, 600), 60);
  check("utilization caps at 100", utilizationPct(700, 600), 100);
  check("utilization zero window", utilizationPct(100, 0), 0);
  check("utilization negative window", utilizationPct(100, -5), 0);
  check("utilization rounds 1/3", utilizationPct(200, 600), 33);

  const logs = [
    { kind: "travel", minutes: 40 }, { kind: "work", minutes: 95 }, { kind: "break", minutes: 15 },
    { kind: "work", minutes: 60 }, { kind: "travel", minutes: null },
  ];
  check("sumMinutes all kinds ignores null", sumMinutes(logs), 210);
  check("sumMinutes work", sumMinutes(logs, "work"), 155);
  check("sumMinutes travel with null", sumMinutes(logs, "travel"), 40);
  check("sumMinutes unknown kind", sumMinutes(logs, "nap"), 0);
  check("sumMinutes empty", sumMinutes([]), 0);
}

console.log("catalogs, working hours, tone maps");
{
  check("tuning 90m", serviceTypeMinutes("tuning"), 90);
  check("regulation 180m", serviceTypeMinutes("regulation"), 180);
  check("delivery 180m", serviceTypeMinutes("delivery"), 180);
  check("unknown service type defaults to 60", serviceTypeMinutes("levitation"), 60);
  check("all service types have positive minutes", SERVICE_TYPES.every((s) => s.minutes > 0), true);
  check("service keys unique", new Set(SERVICE_TYPES.map((s) => s.key)).size, SERVICE_TYPES.length);

  const wh = DEFAULT_WORKING_HOURS;
  check("Sunday closed", wh[0], null);
  check("Mon-Fri 8am-6pm", [1, 2, 3, 4, 5].every((d) => wh[d]![0] === 480 && wh[d]![1] === 1080), true);
  check("Saturday 9am-2pm", wh[6], [540, 840]);
  check("all weekdays defined", Object.keys(wh).length, 7);
  check("Mon window is 600 min", wh[1]![1] - wh[1]![0], 600);
  check("Sat window labels", wh[6]!.map((m) => fmtMinuteOfDay(m)), ["9:00 AM", "2:00 PM"]);
  check("one tuning + one repair fits Saturday? 210 of 300 = 70%", utilizationPct(90 + 120, wh[6]![1] - wh[6]![0]), 70);

  check("open + closed statuses partition all job statuses",
    [...OPEN_JOB_STATUSES, ...CLOSED_JOB_STATUSES].sort(), JOB_STATUSES.map((s) => s.key).sort());
  check("no overlap open/closed", OPEN_JOB_STATUSES.filter((s) => CLOSED_JOB_STATUSES.includes(s)), []);
  check("cancelled tone danger", JOB_STATUS_TONE.cancelled, "danger");
  check("paid tone success", JOB_STATUS_TONE.paid, "success");
  check("in_progress label", JOB_STATUS_LABEL.in_progress, "On site");
  check("invoice overdue tone danger", INVOICE_STATUS_TONE.overdue, "danger");
  check("invoice partial label", INVOICE_STATUS_LABEL.partial, "Part paid");
  check("void tone slate", INVOICE_STATUS_TONE.void, "slate");
  check("unknown status has no tone", JOB_STATUS_TONE.nope, undefined);
}

console.log("codes");
{
  check("job code pads to 4", jobCode("WO", 7, "2026-03-01T00:00:00Z"), "WO-2026-0007");
  check("job code no truncation over 4 digits", jobCode("WO", 12345, "2026-03-01T00:00:00Z"), "WO-2026-12345");
  check("year comes from the record date", invoiceCode("INV", 1, "2025-12-31T00:00:00Z"), "INV-2025-0001");
  check("negative number clamps to 0000", jobCode("WO", -3, "2026-01-01T00:00:00Z"), "WO-2026-0000");
  check("null date uses current year", jobCode("Q", 1, null), `Q-${new Date().getUTCFullYear()}-0001`);
  // Manila new-year: 2026-01-01 00:30 Manila == 2025-12-31T16:30Z; code uses UTC year
  check("UTC-year behaviour at Manila new year", invoiceCode("INV", 2, "2025-12-31T16:30:00Z"), "INV-2025-0002");
}

console.log("input guards and parseLocal");
{
  check("parseLocal date only = Manila midnight", parseLocal("2026-09-23")?.toISOString(), "2026-09-22T16:00:00.000Z");
  check("parseLocal space separator", parseLocal("2026-09-23 17:45")?.toISOString(), "2026-09-23T09:45:00.000Z");
  check("parseLocal early morning crosses UTC day", parseLocal("2026-01-01T06:00")?.toISOString(), "2025-12-31T22:00:00.000Z");
  check("parseLocal empty -> null", parseLocal("   "), null);
  check("parseLocal non-string -> null", parseLocal(12345), null);
  check("parseLocal garbage -> null", parseLocal("next tuesday"), null);
  check("parseLocal ISO with Z uses wall clock digits (Manila)", parseLocal("2026-09-23T09:30:00Z")?.toISOString(), "2026-09-23T01:30:00.000Z");
  check("optionalDate empty -> null", optionalDate(""), null);
  check("optionalDate undefined -> null", optionalDate(undefined), null);
  check("optionalDate value", optionalDate("2026-09-23T08:00")?.toISOString(), "2026-09-23T00:00:00.000Z");

  check("moneyToCents PHP symbol", moneyToCents("₱3,500.00"), 350_000);
  check("moneyToCents negative", moneyToCents("-250.75"), -25_075);
  check("moneyToCents rounding 19.99", moneyToCents("19.99"), 1_999);
  check("moneyToCents 1.005 style value", moneyToCents(0.29), 29);
  check("moneyToCents null", moneyToCents(null), 0);
  check("moneyToCents NaN number", moneyToCents(NaN), 0);
  check("intOr string", intOr("42", 0), 42);
  check("intOr garbage fallback", intOr("x", 7), 7);
  check("intOr rounds number", intOr(2.6, 0), 3);
  check("boolOr on", boolOr("on"), true);
  check("boolOr 0", boolOr("0", true), false);
  check("boolOr unknown fallback", boolOr("maybe", true), true);
  check("oneOf valid", oneOf("gcash", ["cash", "gcash"] as const, "cash"), "gcash");
  check("oneOf invalid", oneOf("bitcoin", ["cash", "gcash"] as const, "cash"), "cash");
  check("str trims", str("  Steinway  "), "Steinway");
  check("str truncates", str("abcdef", 3), "abc");
  check("str empty -> null", str("  "), null);
  check("strOr fallback", strOr(undefined, "n/a"), "n/a");
}

console.log("owner settings: VAT on/off");
{
  const lines = [
    { qty: 1, unitPriceCents: 450_000, taxable: true },
    { qty: 1, unitPriceCents: 150_000, taxable: false },
  ];
  const off = computeTotals(lines, { taxRateBps: 1200, vatEnabled: false });
  check("vatEnabled false: tax is 0 even with a 12% rate", off.taxCents, 0);
  check("vatEnabled false: total = subtotal", off.totalCents, 600_000);
  check("vatEnabled false: taxable base still reported", off.taxableCents, 450_000);
  check("vatEnabled false + discount: total = subtotal - discount", computeTotals(lines, { taxRateBps: 1200, vatEnabled: false, discountCents: 50_000 }).totalCents, 550_000);
  check("vatEnabled true matches omitted flag", computeTotals(lines, { taxRateBps: 1200, vatEnabled: true }), computeTotals(lines, { taxRateBps: 1200 }));
  check("vatEnabled omitted keeps 12% VAT", computeTotals(lines, { taxRateBps: 1200 }).taxCents, 54_000);
}

console.log("owner settings: job margin options");
{
  const costs = { laborCostCents: 0, partsCostCents: 25_000, expenseCents: 15_000, invoicedCents: 112_000, taxCents: 12_000 };
  const exVat = jobMargin(costs);
  check("excl. VAT (default): revenue = invoiced - saved tax", exVat.revenueCents, 100_000);
  check("excl. VAT: profit 100,000 - 40,000", exVat.profitCents, 60_000);
  check("excl. VAT: margin 60%", exVat.marginPct, 60);
  check("excl. VAT: cost unchanged", exVat.costCents, 40_000);
  const inclVat = jobMargin(costs, { marginExcludesVat: false });
  check("incl. VAT: revenue = invoiced", inclVat.revenueCents, 112_000);
  check("incl. VAT: profit 112,000 - 40,000", inclVat.profitCents, 72_000);
  check("incl. VAT: margin 64% (72/112)", inclVat.marginPct, 64);

  const labor = { laborCostCents: 30_000, partsCostCents: 10_000, expenseCents: 5_000, invoicedCents: 100_000 };
  check("labor included by default", jobMargin(labor).costCents, 45_000);
  const noLabor = jobMargin(labor, { includeLaborCost: false });
  check("includeLaborCost false: labor dropped from cost", noLabor.costCents, 15_000);
  check("includeLaborCost false: profit 100,000 - 15,000", noLabor.profitCents, 85_000);
  check("includeLaborCost false: margin 85%", noLabor.marginPct, 85);
  check("recorded labor input is not mutated", labor.laborCostCents, 30_000);

  check("zero revenue: margin 0 (not -Infinity)", jobMargin({ laborCostCents: 5_000, partsCostCents: 0, expenseCents: 0, invoicedCents: 0, taxCents: 0 }), { costCents: 5_000, profitCents: -5_000, marginPct: 0, revenueCents: 0 });
  check("revenue wiped out by tax: margin 0", jobMargin({ laborCostCents: 0, partsCostCents: 1_000, expenseCents: 0, invoicedCents: 12_000, taxCents: 12_000 }).marginPct, 0);
  check("taxCents omitted behaves like 0", jobMargin({ laborCostCents: 0, partsCostCents: 0, expenseCents: 0, invoicedCents: 50_000 }).revenueCents, 50_000);
  check("VAT-free historical invoice (tax 0): revenue = invoiced", jobMargin({ laborCostCents: 0, partsCostCents: 0, expenseCents: 0, invoicedCents: 80_000, taxCents: 0 }).revenueCents, 80_000);
}

console.log("owner settings: average invoice");
{
  check("avg: 3 invoices totalling 9,000", avgInvoiceCents(900_000, 3), 300_000);
  check("avg: rounds to nearest centavo", avgInvoiceCents(100_000, 3), 33_333);
  check("avg: zero denominator -> 0", avgInvoiceCents(500_000, 0), 0);
  check("avg: negative denominator -> 0", avgInvoiceCents(500_000, -1), 0);
  check("avg: nothing invoiced", avgInvoiceCents(0, 4), 0);
  check("avg: job basis divides by more jobs than invoices", [avgInvoiceCents(600_000, 2), avgInvoiceCents(600_000, 3)], [300_000, 200_000]);
}

console.log("tax line label");
{
  check("label already carrying the rate shows it once", taxLineLabel("VAT (12%)", 1200), "VAT (12%)");
  check("label without a rate gets the rate appended", taxLineLabel("VAT", 1200), "VAT (12%)");
  check("invoice's saved rate wins over the label's rate", taxLineLabel("VAT (12%)", 1000), "VAT (10%)");
  check("fractional rate", taxLineLabel("Sales tax", 1250), "Sales tax (12.5%)");
  check("blank label falls back to VAT", taxLineLabel("  ", 1200), "VAT (12%)");
  check("fmtRatePct trims zeros", fmtRatePct(1200), "12%");
}

console.log("owner settings: save validation");
{
  check("explicit false is kept (not dropped)", validateReportSettings({ vatEnabled: false, showFinance: false }), { ok: true, value: { vatEnabled: false, showFinance: false } });
  check("omitted fields are left out (unchanged)", validateReportSettings({ businessName: "X" }), { ok: true, value: {} });
  check("valid basis 'job' accepted", validateReportSettings({ avgInvoiceBasis: "job" }), { ok: true, value: { avgInvoiceBasis: "job" } });
  check("invalid basis rejected", validateReportSettings({ avgInvoiceBasis: "month" }).ok, false);
  check("non-string basis rejected", validateReportSettings({ avgInvoiceBasis: 1 }).ok, false);
  check("string 'false' toggle rejected, not coerced", validateReportSettings({ marginExcludesVat: "false" }).ok, false);
  check("null toggle rejected", validateReportSettings({ includeLaborCost: null }).ok, false);
  check("numeric toggle rejected", validateReportSettings({ showJobMargins: 0 }).ok, false);
  check("all five toggles + basis round-trip", validateReportSettings({
    vatEnabled: false, marginExcludesVat: false, includeLaborCost: false, showFinance: true, showJobMargins: false, avgInvoiceBasis: "invoice",
  }), { ok: true, value: { vatEnabled: false, marginExcludesVat: false, includeLaborCost: false, showFinance: true, showJobMargins: false, avgInvoiceBasis: "invoice" } });
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll home-service mock-data checks passed ✔");
