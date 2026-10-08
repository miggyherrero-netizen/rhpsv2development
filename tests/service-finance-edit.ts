/** Finance edit rules (phase 3) — pure logic, no database. Run: npx tsx tests/service-finance-edit.ts */
import {
  EditRejected, computeInvoiceState, describeReason, discountTooLarge, historyRowOf, jobStatusAfterInvoice, needsReason,
  overpayError, paymentChanges, validateReason, wouldOverpay, fmtPesoExact, overpaymentMessage, discountMessage,
  type InvoiceState, type StateItem, type StatePayment, clampQty, clampTaxBps, lineLimitError, isNumericOverflow, AMOUNT_TOO_LARGE,
} from "../src/lib/service-finance-edit";
import { computeTotals } from "../src/lib/service";
import { buildMonthSeries } from "../src/lib/service-dashboard";
import { receivables } from "../src/lib/service-reports";
import { describeChange, fieldLabel } from "../src/lib/service-finance-history";

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) { failures++; console.error(`  ✗ ${name}\n      expected ${e}\n      actual   ${a}`); }
  else console.log(`  ✓ ${name}`);
}
const d = (iso: string) => new Date(iso);

/* ---------------------------------------------------------------- reason */
console.log("validateReason");
check("missing", validateReason(undefined).ok, false);
check("empty / spaces", [validateReason("").ok, validateReason("    ").ok], [false, false]);
check("too short (2 chars)", validateReason("ab"), { ok: false, error: "The reason is too short — write at least 3 characters." });
check("not a string", validateReason(42).ok, false);
check("exactly 3 chars is valid", validateReason("abc"), { ok: true, reason: "abc" });
check("trims and collapses whitespace", validateReason("  Customer paid   less \n by GCash "), { ok: true, reason: "Customer paid less by GCash" });
check("500 chars ok, 501 too long", [validateReason("x".repeat(500)).ok, validateReason("x".repeat(501)).ok], [true, false]);
check("error text tells what to do", (validateReason("") as { error: string }).error, "Add a short reason for this change (at least 3 characters).");
check("whitespace padding does not count toward the minimum", validateReason("  a  b ").ok, true); // "a b" = 3 chars

console.log("\nvalidateReason: blank-looking and odd input");
check("zero-width characters only", validateReason("\u200B\u200C\u200D\u2060\uFEFF\u200B").ok, false);
check("zero-width padding is stripped before the length check", validateReason("a\u200Bb").ok, false); // "ab" = 2 chars
check("zero-width inside a valid reason is removed", validateReason("fi\u200Bxed").ok && (validateReason("fi\u200Bxed") as { reason: string }).reason === "fixed", true);
check("symbols only fail", [validateReason("...").ok, validateReason("---").ok, validateReason("???").ok], [false, false, false]);
check("symbols-only error says why", (validateReason("...") as { error: string }).error, "The reason needs some words or numbers, not just symbols.");
check("digits count", validateReason("123").ok, true);
check("letters from other scripts count", validateReason("ミス修正").ok, true);
check("array / object / null / boolean reasons fail", [validateReason(["abc"]).ok, validateReason({ a: "abc" }).ok, validateReason(null).ok, validateReason(true).ok], [false, false, false, false]);

console.log("\nlimits");
check("qty clamped to 1..9999", [clampQty(0), clampQty(-5), clampQty(12_000), clampQty(NaN), clampQty(3.6)], [1, 1, 9_999, 1, 4]);
check("tax rate clamped to 0..10000 bps", [clampTaxBps(-1), clampTaxBps(99_999), clampTaxBps(1200), clampTaxBps(NaN)], [0, 10_000, 1_200, 0]);
check("line limit: fine, too big price, too big qty x price", [lineLimitError(2, 100_000), lineLimitError(1, 2_000_000_001), lineLimitError(9_999, 300_000_000), lineLimitError(1, NaN)], [null, AMOUNT_TOO_LARGE, AMOUNT_TOO_LARGE, AMOUNT_TOO_LARGE]);
check("Postgres 22003 is recognised, also when wrapped", [isNumericOverflow({ code: "22003" }), isNumericOverflow({ cause: { code: "22003" } }), isNumericOverflow({ code: "23505" }), isNumericOverflow(null)], [true, true, false, false]);
check("tax-rate edit that would drop a paid invoice's total below payments is an overpayment",
  overpayError({ totalCents: 162_000, paidCents: 162_000 }, { totalCents: computeInvoiceState({ items: [{ qty: 1, unitPriceCents: 100_000, taxable: true }, { qty: 1, unitPriceCents: 50_000, taxable: false }], payments: [], discountCents: 0, taxRateBps: 0 }).totalCents, paidCents: 162_000 }) !== null, true);

/* ---------------------------------------------------------------- needsReason */
console.log("\nneedsReason matrix");
const nr = (status: string, amountPaidCents: number) => needsReason({ status, amountPaidCents });
check("draft, nothing paid: free", nr("draft", 0), false);
check("sent, nothing paid: free", nr("sent", 0), false);
check("partial: reason", nr("partial", 50_000), true);
check("paid: reason", nr("paid", 100_000), true);
check("sent but has a payment amount: reason", nr("sent", 1), true);
check("stale status \"sent\" but payments exist: reason", nr("sent", 5_000), true);
check("status paid with stale 0 paid: reason (safer)", nr("paid", 0), true);
check("void with payments: reason", nr("void", 100), true);
check("void with nothing paid: free", nr("void", 0), false);

/* ---------------------------------------------------------------- state helpers */
const lines: StateItem[] = [
  { qty: 1, unitPriceCents: 100_000, taxable: true },    // 1,000.00 taxable
  { qty: 1, unitPriceCents: 50_000, taxable: false },    //   500.00 not taxable
];
// subtotal 150,000; tax = 12% of 100,000 = 12,000; total 162,000
const base = { items: lines, discountCents: 0, taxRateBps: 1200, sentAt: d("2026-09-01T00:00:00Z"), voidedAt: null, previousPaidAt: null };
const pay = (amountCents: number, iso: string): StatePayment => ({ amountCents, receivedAt: d(iso) });
const st = (over: Partial<Parameters<typeof computeInvoiceState>[0]> & { payments?: StatePayment[] }): InvoiceState =>
  computeInvoiceState({ ...base, payments: [], ...over });
const invariant = (s: InvoiceState, payments: StatePayment[]) => s.amountPaidCents === payments.reduce((a, p) => a + p.amountCents, 0);

console.log("\ncomputeInvoiceState");
const s0 = st({});
check("totals use computeTotals (mixed taxable / exempt)", [s0.subtotalCents, s0.taxCents, s0.totalCents], [150_000, 12_000, 162_000]);
check("no payments + sent -> sent, paidAt null", [s0.status, s0.paidAt, s0.balanceCents], ["sent", null, 162_000]);
check("no payments + not sent -> draft", st({ sentAt: null }).status, "draft");
check("void wins", st({ voidedAt: d("2026-09-02T00:00:00Z"), payments: [pay(162_000, "2026-09-05T00:00:00Z")] }).status, "void");

const twoPays = [pay(100_000, "2026-09-05T02:00:00Z"), pay(62_000, "2026-09-20T02:00:00Z")];
const paid = st({ payments: twoPays });
check("exact payment equals total -> paid, balance 0", [paid.status, paid.balanceCents, paid.overpaidCents], ["paid", 0, 0]);
check("paidAt = latest payment date (not now)", paid.paidAt?.toISOString(), "2026-09-20T02:00:00.000Z");
check("paidAt ignores row order", st({ payments: [twoPays[1]!, twoPays[0]!] }).paidAt?.toISOString(), "2026-09-20T02:00:00.000Z");

const partial = st({ payments: [pay(100_000, "2026-09-05T02:00:00Z")] });
check("part payment -> partial, paidAt null", [partial.status, partial.balanceCents, partial.paidAt], ["partial", 62_000, null]);
check("partial -> paid when the second payment lands", st({ payments: twoPays }).status, "paid");

// paid -> partial
const afterEditDown = st({ payments: [pay(100_000, "2026-09-05T02:00:00Z"), pay(50_000, "2026-09-20T02:00:00Z")] });
check("paid -> partial after a payment is lowered; paidAt cleared", [afterEditDown.status, afterEditDown.paidAt], ["partial", null]);
const afterRaise = st({ items: [...lines, { qty: 1, unitPriceCents: 10_000, taxable: true }], payments: twoPays });
check("paid -> partial after the total grows (line added)", [afterRaise.status, afterRaise.totalCents, afterRaise.balanceCents], ["partial", 173_200, 11_200]);
// paid -> sent / draft
check("paid -> sent after all payments removed (was sent)", st({ payments: [] }).status, "sent");
check("paid -> draft after all payments removed (never sent)", st({ payments: [], sentAt: null }).status, "draft");
check("reopen clears paidAt (void -> reopened partial)", st({ voidedAt: null, payments: [pay(10_000, "2026-09-05T00:00:00Z")], previousPaidAt: d("2026-09-20T00:00:00Z") }).paidAt, null);
check("previousPaidAt only used if paid with no payment dates", st({ items: [{ qty: 1, unitPriceCents: 0 }], payments: [], previousPaidAt: d("2026-09-20T00:00:00Z") }).paidAt, null);

console.log("\nrounding and tax: current computeTotals behaviour (documented, unchanged)");
const r1 = st({ items: [{ qty: 3, unitPriceCents: 3333, taxable: true }], discountCents: 1 });
check("centavo rounding: 9,999 - 1 discount, tax on 9,998 x 12% = 1199.76 -> 1,200", [r1.subtotalCents, r1.taxCents, r1.totalCents], [9_999, 1_200, 11_198]);
const r2 = st({ items: [{ qty: 1, unitPriceCents: 10_001, taxable: true }, { qty: 1, unitPriceCents: 5_000, taxable: false }], discountCents: 2_000 });
check("mixed lines + discount: the WHOLE discount comes off the taxable base", [r2.taxCents, r2.totalCents], [960, 13_961]);
const r3 = st({ items: [{ qty: 1, unitPriceCents: 1_000, taxable: true }, { qty: 1, unitPriceCents: 5_000, taxable: false }], discountCents: 3_000 });
check("discount above the taxable part: tax floors at 0 (existing behaviour)", [r3.taxCents, r3.totalCents], [0, 3_000]);
const r4 = st({ taxRateBps: 0 });
check("zero VAT: no tax", [r4.taxCents, r4.totalCents], [0, 150_000]);
check("saved taxRateBps is what counts (8% here, never current settings)", st({ taxRateBps: 800 }).taxCents, 8_000);
check("same as computeTotals directly", computeTotals(lines, { discountCents: 0, taxRateBps: 1200 }).totalCents, s0.totalCents);

/* ---------------------------------------------------------------- guards */
console.log("\noverpayment and discount guards");
check("wouldOverpay: equal is fine", wouldOverpay(162_000, 162_000), false);
check("wouldOverpay: one centavo over", wouldOverpay(162_000, 162_001), true);
check("wouldOverpay: nothing paid is never an overpayment, even on a negative total", wouldOverpay(-500, 0), false);
check("wouldOverpay: payment on a zero total", wouldOverpay(0, 100), true);
check("discountTooLarge", [discountTooLarge(150_000, 150_000), discountTooLarge(150_001, 150_000)], [false, true]);

// record payment: 162,000 total, 100,000 paid, adding 62,001
check("record: adding more than the balance is rejected with a how-to message",
  overpayError({ totalCents: 162_000, paidCents: 100_000 }, { totalCents: 162_000, paidCents: 162_001 }),
  "Payments (₱1,620.01) would be more than the invoice total (₱1,620.00). Lower the payment first.");
check("record: exactly the balance is fine", overpayError({ totalCents: 162_000, paidCents: 100_000 }, { totalCents: 162_000, paidCents: 162_000 }), null);
check("edit payment up past the total is rejected",
  overpayError({ totalCents: 162_000, paidCents: 162_000 }, { totalCents: 162_000, paidCents: 170_000 }) !== null, true);
check("edit payment down is fine", overpayError({ totalCents: 162_000, paidCents: 162_000 }, { totalCents: 162_000, paidCents: 100_000 }), null);
check("line edit lowering the total below what was paid is rejected",
  overpayError({ totalCents: 162_000, paidCents: 162_000 }, { totalCents: 112_000, paidCents: 162_000 }) !== null, true);
check("deleting the last line (total 0) of a paid invoice is rejected",
  overpayError({ totalCents: 162_000, paidCents: 162_000 }, { totalCents: 0, paidCents: 162_000 }) !== null, true);
check("a draft with a big discount is not 'overpaid' (nothing paid)", overpayError(null, { totalCents: -500, paidCents: 0 }), null);
check("legacy overpaid invoice: an edit that does not make it worse is allowed",
  overpayError({ totalCents: 100_000, paidCents: 110_000 }, { totalCents: 100_000, paidCents: 110_000 }), null);
check("legacy overpaid invoice: making it worse is rejected",
  overpayError({ totalCents: 100_000, paidCents: 110_000 }, { totalCents: 90_000, paidCents: 110_000 }) !== null, true);
check("legacy overpaid invoice: fixing it is allowed", overpayError({ totalCents: 100_000, paidCents: 110_000 }, { totalCents: 100_000, paidCents: 100_000 }), null);
check("money text", [fmtPesoExact(123_456), fmtPesoExact(5), overpaymentMessage(100, 200), discountMessage(300, 200)],
  ["₱1,234.56", "₱0.05",
   "Payments (₱2.00) would be more than the invoice total (₱1.00). Lower the payment first.",
   "The discount (₱3.00) is more than the subtotal (₱2.00). Lower the discount."]);

/* ---------------------------------------------------------------- job follows invoice */
console.log("\njobStatusAfterInvoice");
const j = (jobStatus: string, invoiceStatus: string, previousInvoiceStatus?: string) => jobStatusAfterInvoice({ jobStatus, invoiceStatus, previousInvoiceStatus });
check("invoiced -> paid when invoice becomes paid", j("invoiced", "paid"), "paid");
check("paid -> invoiced when invoice stops being paid", [j("paid", "partial"), j("paid", "sent"), j("paid", "void"), j("paid", "draft")], ["invoiced", "invoiced", "invoiced", "invoiced"]);
check("paid stays paid while invoice is paid", j("paid", "paid"), "paid");
check("invoiced stays invoiced for partial", j("invoiced", "partial"), "invoiced");
check("with a previous status, only the real transition out of paid moves the job back", [j("paid", "sent", "sent"), j("paid", "partial", "paid")], ["paid", "invoiced"]);
check("other job statuses are never touched",
  ["lead", "quoted", "scheduled", "in_progress", "completed", "cancelled", "on_hold"].map((s) => [j(s, "paid"), j(s, "sent"), j(s, "void")].every((x) => x === s)),
  [true, true, true, true, true, true, true]);

/* ---------------------------------------------------------------- invariant under a sequence of edits */
console.log("\namountPaid == SUM(payments) after every edit (in-memory model of the rules)");
type Model = { items: StateItem[]; payments: (StatePayment & { id: number })[]; discountCents: number; taxRateBps: number; sentAt: Date | null; stored: InvoiceState };
function apply(m: Model, mutate: (c: Model) => void): { model: Model; error: string | null } {
  const draft: Model = JSON.parse(JSON.stringify(m), (_k, v) => (typeof v === "string" && /^\d{4}-\d\d-\d\dT/.test(v) ? new Date(v) : v));
  mutate(draft);
  const next = computeInvoiceState({ items: draft.items, payments: draft.payments, discountCents: draft.discountCents, taxRateBps: draft.taxRateBps, sentAt: draft.sentAt });
  const err = overpayError({ totalCents: m.stored.totalCents, paidCents: m.stored.amountPaidCents }, { totalCents: next.totalCents, paidCents: next.amountPaidCents })
    ?? (discountTooLarge(draft.discountCents, next.subtotalCents) && m.stored.status !== "draft" ? discountMessage(draft.discountCents, next.subtotalCents) : null);
  if (err) return { model: m, error: err };
  draft.stored = next;
  return { model: draft, error: null };
}
let m: Model = { items: lines, payments: [], discountCents: 0, taxRateBps: 1200, sentAt: d("2026-09-01T00:00:00Z"), stored: s0 };
const steps: [string, (c: Model) => void, boolean][] = [
  ["record 1,000.00", (c) => c.payments.push({ id: 1, ...pay(100_000, "2026-09-05T02:00:00Z") }), false],
  ["record 620.00 -> paid", (c) => c.payments.push({ id: 2, ...pay(62_000, "2026-09-20T02:00:00Z") }), false],
  ["record 1 centavo more -> rejected", (c) => c.payments.push({ id: 3, ...pay(1, "2026-09-21T02:00:00Z") }), true],
  ["edit payment 2 up by 1 centavo -> rejected", (c) => { c.payments[1]!.amountCents += 1; }, true],
  ["edit payment 2 down to 500.00 -> partial", (c) => { c.payments[1]!.amountCents = 50_000; }, false],
  ["discount 100.00 on a partial invoice", (c) => { c.discountCents = 10_000; }, false],
  ["discount above subtotal -> rejected", (c) => { c.discountCents = 150_001; }, true],
  ["lower line price below paid -> rejected", (c) => { c.items = [{ qty: 1, unitPriceCents: 10_000, taxable: true }]; }, true],
  ["delete every line -> rejected", (c) => { c.items = []; }, true],
  ["delete payment 1", (c) => { c.payments = c.payments.filter((p) => p.id !== 1); }, false],
  ["delete payment 2 -> sent", (c) => { c.payments = []; }, false],
];
for (const [name, mutate, shouldFail] of steps) {
  const r = apply(m, mutate);
  m = r.model;
  const sum = m.payments.reduce((a, p) => a + p.amountCents, 0);
  check(`${name} (${shouldFail ? "rejected" : "ok"}), amountPaid == SUM(payments)`, [r.error !== null, m.stored.amountPaidCents === sum, invariant(m.stored, m.payments)], [shouldFail, true, true]);
}
check("final state after removing every payment is sent with paidAt null", [m.stored.status, m.stored.paidAt], ["sent", null]);

/* ---------------------------------------------------------------- month boundary */
console.log("\nmoving a payment across a Manila month boundary");
const now = d("2026-10-15T04:00:00Z");
const invoice = { status: "partial", totalCents: 162_000, amountPaidCents: 100_000, issueDate: d("2026-09-01T00:00:00Z"), dueDate: d("2026-09-16T00:00:00Z"), sentAt: d("2026-09-01T00:00:00Z"), voidedAt: null };
const monthsOf = (receivedAt: Date) => buildMonthSeries({ invoices: [invoice], payments: [{ receivedAt, amountCents: 100_000 }], expenses: [] }, now, 3);
const before = monthsOf(d("2026-09-30T15:30:00Z")); // 23:30 on 30 Sep in Manila
const after = monthsOf(d("2026-09-30T16:30:00Z"));  // 00:30 on 1 Oct in Manila
check("before the move the payment is in September only", before.map((r) => [r.key, r.collectedCents]), [["2026-08", 0], ["2026-09", 100_000], ["2026-10", 0]]);
check("after the move it is in October only", after.map((r) => [r.key, r.collectedCents]), [["2026-08", 0], ["2026-09", 0], ["2026-10", 100_000]]);
check("collected over all periods is counted exactly once either way", [before, after].map((r) => r.reduce((a, x) => a + x.collectedCents, 0)), [100_000, 100_000]);
// Aging reads only the invoice (total, paid, due date) - the payment date is not an input at all, so moving
// a payment between months cannot move the receivable.
const aging = receivables([invoice], now);
check("aging is balance/due based: 620.00 outstanding, all overdue, unchanged by the payment date", [aging.totalOutstandingCents, aging.overdueCents], [62_000, 62_000]);

/* ---------------------------------------------------------------- history entry shape */
console.log("\nhistory entry with a reason");
const pB = { amountCents: 100_000, receivedAt: d("2026-09-05T02:00:00Z"), method: "cash", reference: null, note: null };
const pA = { amountCents: 90_000, receivedAt: d("2026-09-06T02:00:00Z"), method: "gcash", reference: "GC-1", note: null };
const ch = paymentChanges(pB, pA);
check("payment changes: from/to, money in centavos, dates as ISO", ch, {
  amountCents: { from: 100_000, to: 90_000 }, receivedAt: { from: "2026-09-05T02:00:00.000Z", to: "2026-09-06T02:00:00.000Z" },
  method: { from: "cash", to: "gcash" }, reference: { from: null, to: "GC-1" },
});
check("no change gives an empty diff", paymentChanges(pB, { ...pB }), {});
const row = historyRowOf({ entityType: "payment", entityId: "p1", action: "update", summary: describeChange("payment", "update", "P1,000.00 on INV-1", ch), changes: ch, invoiceId: "i1", reason: "Customer sent GCash screenshot", actorName: "Owner" });
check("row carries the reason, ids, actor and changes", [row.reason, row.entityType, row.action, row.invoiceId, row.actorName, Object.keys(row.changes ?? {})], ["Customer sent GCash screenshot", "payment", "update", "i1", "Owner", ["amountCents", "receivedAt", "method", "reference"]]);
check("summary reads sensibly", row.summary, "Payment P1,000.00 on INV-1 amount changed from P1,000.00 to P900.00; date received changed from 2026-09-05 to 2026-09-06; method changed from cash to gcash; and 1 more");
check("empty changes are stored as null; reason defaults to null", [historyRowOf({ entityType: "invoice", entityId: "i", action: "status", summary: "x", changes: {} }).changes, historyRowOf({ entityType: "invoice", entityId: "i", action: "status", summary: "x" }).reason], [null, null]);
check("summary is cut at 500 characters", historyRowOf({ entityType: "invoice", entityId: "i", action: "status", summary: "y".repeat(700) }).summary.length, 500);
check("describeReason", [describeReason("  fixed typo "), describeReason(null), describeReason("  ")], ["Reason: fixed typo", null, null]);
check("labels: kind reads as type; payment fields read sensibly", ["kind", "amountCents", "receivedAt", "reference", "note", "amountPaidCents"].map(fieldLabel), ["type", "amount", "date received", "reference", "note", "paid so far"]);
check("EditRejected is an Error with a message", (() => { const e = new EditRejected("no"); return [e instanceof Error, e.message]; })(), [true, "no"]);

if (failures) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
console.log("\nAll finance-edit checks passed");
