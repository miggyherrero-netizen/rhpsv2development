/** Finance health check — one failing case per check plus a clean dataset. No database. Run: npx tsx tests/service-finance-audit.ts */
import {
  auditFinance, type AuditInput, type AuditInvoice, type AuditPayment, type AuditExpense, type AuditJob,
} from "../src/lib/service-finance-audit";

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) { failures++; console.error(`  ✗ ${name}\n      expected ${e}\n      actual   ${a}`); }
  else console.log(`  ✓ ${name}`);
}

const NOW = new Date("2026-10-01T04:00:00Z");
const D = (s: string) => new Date(s);

// Clean base: 2 lines = 1000.00 (one non-taxable 200.00) ; 12% on 800.00 = 96.00 ; total 1096.00; fully paid.
const inv = (o: Partial<AuditInvoice> = {}): AuditInvoice => ({
  id: "i1", label: "INV-2026-0001", status: "paid", subtotalCents: 100_000, discountCents: 0, taxCents: 9_600, totalCents: 109_600,
  amountPaidCents: 109_600, taxRateBps: 1200, createdAt: D("2026-09-01T02:00:00Z"), dueDate: D("2026-09-16T00:00:00Z"),
  sentAt: D("2026-09-01T03:00:00Z"), voidedAt: null, ...o,
});
const items = (id = "i1") => [
  { invoiceId: id, qty: 2, unitPriceCents: 40_000, taxable: true },
  { invoiceId: id, qty: 1, unitPriceCents: 20_000, taxable: false },
];
const pay = (o: Partial<AuditPayment> = {}): AuditPayment => ({ id: "p1", invoiceId: "i1", amountCents: 109_600, receivedAt: D("2026-09-05T02:00:00Z"), ...o });
const job = (o: Partial<AuditJob> = {}): AuditJob => ({ id: "j1", label: "WO-2026-0001 · Tuning", quotedCents: 100_000, partsCostCents: 20_000, laborCostCents: 25_000, ...o });
const exp = (o: Partial<AuditExpense> = {}): AuditExpense => ({
  id: "e1", description: "Fuel", vendor: "Shell", amountCents: 50_000, spentAt: D("2026-09-03T02:00:00Z"),
  kind: "job", jobId: "j1", pianoId: null, hasReceipt: true, category: "fuel", ...o,
});
const clean = (): AuditInput => ({
  invoices: [inv()], invoiceItems: items(), payments: [pay()], now: NOW,
  jobs: [job()],
  jobItems: [
    { jobId: "j1", kind: "service", qty: 1, unitPriceCents: 80_000, taxable: true, costCents: 0 },
    { jobId: "j1", kind: "part", qty: 2, unitPriceCents: 10_000, taxable: true, costCents: 10_000 }, // explicit cost
  ],
  timeLogs: [
    { jobId: "j1", kind: "work", minutes: 60, hourlyRateCents: 25_000, endedAt: D("2026-09-02T05:00:00Z") },
    { jobId: "j1", kind: "travel", minutes: 30, hourlyRateCents: 25_000, endedAt: D("2026-09-02T04:00:00Z") },
    { jobId: "j1", kind: "work", minutes: 99, hourlyRateCents: 25_000, endedAt: null }, // running: ignored
  ],
  expenses: [exp()],
});
const codes = (i: AuditInput) => auditFinance(i).findings.map((f) => f.code).sort();

console.log("clean dataset");
check("a fully consistent dataset has zero findings", auditFinance(clean()), { findings: [], summary: { errors: 0, warnings: 0, info: 0, total: 0, disputeCents: 0, byCode: {} } });

console.log("\ninvoice arithmetic");
check("(a) subtotal != sum of lines", codes({ ...clean(), invoices: [inv({ subtotalCents: 90_000, totalCents: 99_600, amountPaidCents: 99_600 })], payments: [pay({ amountCents: 99_600 })] }).includes("invoice_subtotal"), true);
{
  const f = auditFinance({ ...clean(), invoices: [inv({ subtotalCents: 90_000 })] }).findings.find((x) => x.code === "invoice_subtotal");
  check("(a) reports expected / actual / diff", [f?.expectedCents, f?.actualCents, f?.diffCents], [100_000, 90_000, -10_000]);
}
check("(b) total != subtotal - discount + tax", codes({ ...clean(), invoices: [inv({ totalCents: 110_000, amountPaidCents: 110_000 })], payments: [pay({ amountCents: 110_000 })] }), ["invoice_total"]);
check("(c) tax != recomputed tax", codes({ ...clean(), invoices: [inv({ taxCents: 12_000, totalCents: 112_000, amountPaidCents: 112_000 })], payments: [pay({ amountCents: 112_000 })] }), ["invoice_tax"]);
check("(c) discount lowers the taxable base like computeTotals", codes({ ...clean(), invoices: [inv({ discountCents: 10_000, taxCents: 8_400, totalCents: 98_400, amountPaidCents: 98_400 })], payments: [pay({ amountCents: 98_400 })] }), []);
check("(c) rounding follows computeTotals (half-up on cents)", codes({
  ...clean(), invoices: [inv({ subtotalCents: 1_005, taxCents: 121, totalCents: 1_126, amountPaidCents: 1_126, taxRateBps: 1200 })],
  invoiceItems: [{ invoiceId: "i1", qty: 1, unitPriceCents: 1_005, taxable: true }], payments: [pay({ amountCents: 1_126 })],
}), []);
check("(d) amountPaid != sum of payments", codes({ ...clean(), invoices: [inv({ amountPaidCents: 100_000 })] }), ["invoice_amount_paid", "status_paid_with_balance"]);
check("(j) no lines but non-zero total", codes({ ...clean(), invoiceItems: [] }).includes("invoice_no_items"), true);

console.log("\nstatus vs money");
const unpaid = { amountPaidCents: 0 };
check("(e) paid but balance > 0", codes({ ...clean(), invoices: [inv({ amountPaidCents: 100_000 })], payments: [pay({ amountCents: 100_000 })] }), ["status_paid_with_balance"]);
check("(e) paid with amountPaid 0", codes({ ...clean(), invoices: [inv(unpaid)], payments: [] }).includes("status_paid_no_payment"), true);
check("(e) partial with amountPaid 0", codes({ ...clean(), invoices: [inv({ status: "partial", ...unpaid })], payments: [] }), ["status_partial_mismatch"]);
check("(e) zero-total invoice with a payment is partial by design", codes({ ...clean(), invoices: [inv({ status: "partial", subtotalCents: 0, taxCents: 0, totalCents: 0, amountPaidCents: 5_000 })], invoiceItems: [], payments: [pay({ amountCents: 5_000 })] }).filter((c) => c === "status_partial_mismatch"), []);
check("(e) partial but fully paid", codes({ ...clean(), invoices: [inv({ status: "partial" })] }), ["status_partial_mismatch"]);
check("(e) sent holding payments", codes({ ...clean(), invoices: [inv({ status: "sent" })] }), ["status_unpaid_holds_payment"]);
check("(e) draft holding payments", codes({ ...clean(), invoices: [inv({ status: "draft", sentAt: null })] }), ["status_unpaid_holds_payment"]);
check("(e) void holding payments", codes({ ...clean(), invoices: [inv({ status: "void", voidedAt: NOW })] }), ["status_void_holds_payment"]);
{
  const r = auditFinance({ ...clean(), invoices: [inv({ status: "sent", ...unpaid })], payments: [] });
  check("(e) sent, unpaid, past due is info only", r.findings.map((f) => [f.code, f.severity]), [["invoice_overdue", "info"]]);
  check("(e) info findings add nothing to the dispute total", r.summary.disputeCents, 0);
  check("(e) not yet due is not even info", codes({ ...clean(), invoices: [inv({ status: "sent", ...unpaid, dueDate: D("2026-12-01T00:00:00Z") })], payments: [] }), []);
}
check("(f) overpaid", codes({ ...clean(), invoices: [inv({ amountPaidCents: 120_000 })], payments: [pay({ amountCents: 120_000 })] }), ["invoice_overpaid"]);

console.log("\npayments");
check("(g) zero-amount payment", codes({ ...clean(), payments: [pay(), pay({ id: "p2", amountCents: 0 })] }), ["payment_non_positive"]);
check("(g) negative payment", codes({ ...clean(), invoices: [inv({ amountPaidCents: 109_000 })], payments: [pay({ amountCents: 110_000 }), pay({ id: "p2", amountCents: -1_000 })] }).includes("payment_non_positive"), true);
check("(g) backdated issue date is not flagged", codes({ ...clean(), invoices: [inv({ issueDate: D("2026-08-15T02:00:00Z") })], payments: [pay({ receivedAt: D("2026-08-20T02:00:00Z") })] }), []);
check("(g) dated before the invoice was created", codes({ ...clean(), payments: [pay({ receivedAt: D("2026-08-20T02:00:00Z") })] }), ["payment_before_invoice"]);
check("(g) same-day payment earlier than creation time is fine", codes({ ...clean(), payments: [pay({ receivedAt: D("2026-08-31T16:00:00Z") })] }), []);

console.log("\njob derived columns");
check("(h) quotedCents drift", codes({ ...clean(), jobs: [job({ quotedCents: 99_000 })] }), ["job_quoted_drift"]);
check("(h) partsCostCents drift", codes({ ...clean(), jobs: [job({ partsCostCents: 0 })] }), ["job_parts_drift"]);
check("(h) laborCostCents drift", codes({ ...clean(), jobs: [job({ laborCostCents: 10_000 })] }), ["job_labor_drift"]);
check("(h) a part with no cost is expected to cost 0 (stored selling-price value drifts)", codes({
  ...clean(), jobs: [job({ partsCostCents: 20_000 })],
  jobItems: [{ jobId: "j1", kind: "part", qty: 2, unitPriceCents: 10_000, taxable: true, costCents: 0 }],
}).filter((c) => c === "job_parts_drift"), ["job_parts_drift"]);
check("(h) an explicit line cost wins over the priced amount", codes({
  ...clean(), jobs: [job({ partsCostCents: 15_000 })],
  jobItems: [{ jobId: "j1", kind: "service", qty: 1, unitPriceCents: 80_000, taxable: true, costCents: 0 }, { jobId: "j1", kind: "part", qty: 2, unitPriceCents: 10_000, taxable: true, costCents: 7_500 }],
}), []);

console.log("\nexpenses");
check("(i) amount <= 0", codes({ ...clean(), expenses: [exp({ amountCents: 0 })] }), ["expense_amount"]);
check("(i) kind missing", codes({ ...clean(), expenses: [exp({ kind: null })] }), ["expense_no_kind"]);
check("(i) kind=job without jobId", codes({ ...clean(), expenses: [exp({ jobId: null })] }), ["expense_job_no_job"]);
check("(i) kind=stock without pianoId", codes({ ...clean(), expenses: [exp({ kind: "stock", jobId: null })] }), ["expense_stock_no_piano"]);
check("(i) missing receipt on a large expense (info)", auditFinance({ ...clean(), expenses: [exp({ hasReceipt: false, amountCents: 150_000 })] }).findings.map((f) => [f.code, f.severity]), [["expense_no_receipt", "info"]]);
check("(i) small expense without receipt is ignored", codes({ ...clean(), expenses: [exp({ hasReceipt: false })] }), []);
{
  const r = auditFinance({ ...clean(), expenses: [exp(), exp({ id: "e2", spentAt: D("2026-09-03T05:00:00Z"), vendor: " shell " })] });
  check("(i) duplicate: same day, amount, vendor flags the later row", r.findings.map((f) => [f.code, f.entity.id, f.diffCents]), [["expense_duplicate", "e2", 50_000]]);
  check("(i) different amount is not a duplicate", codes({ ...clean(), expenses: [exp(), exp({ id: "e2", amountCents: 50_100 })] }), []);
}

console.log("\nexpense linked to a job with another kind");
{
  check("(l) linked expense with kind overhead is flagged (info)", auditFinance({ ...clean(), expenses: [exp({ kind: "overhead" })] }).findings.map((f) => [f.code, f.severity, f.entity.id]), [["expense_job_kind_mismatch", "info", "e1"]]);
  check("(l) message says it is not counted in the job margin", auditFinance({ ...clean(), expenses: [exp({ kind: "overhead" })] }).findings[0]?.message, "Linked to a job but marked overhead; it is not counted in the job margin.");
  check("(l) stock expense linked to a job (with piano) is flagged", codes({ ...clean(), expenses: [exp({ kind: "stock", pianoId: "pi1" })] }), ["expense_job_kind_mismatch"]);
  check("(l) overhead without a job link is fine", codes({ ...clean(), expenses: [exp({ kind: "overhead", jobId: null })] }), []);
  check("(l) unsorted (null kind) linked expense is left to expense_no_kind", codes({ ...clean(), expenses: [exp({ kind: null })] }), ["expense_no_kind"]);
}

console.log("\nsummary");
{
  const r = auditFinance({ ...clean(), invoices: [inv({ subtotalCents: 90_000 })], expenses: [exp({ kind: null })] });
  check("counts per severity and code, dispute in absolute cents", [r.summary.errors, r.summary.warnings, r.summary.info, r.summary.disputeCents, r.summary.byCode.invoice_subtotal], [2, 0, 1, 20_000, { severity: "error", count: 1, disputeCents: 10_000 }]);
  check("errors sort before info", r.findings.map((f) => f.severity), ["error", "error", "info"]);
}

if (failures) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
console.log("\nall finance audit checks passed");
