/**
 * Finance health check — PURE, read-only. Finds every place the stored Home Service money
 * does not balance. It reuses `computeTotals` / `lineTotalCents` / `partsCostFromLines`, so it
 * agrees exactly with how the app itself computes and rounds money. No database, no writes.
 * Amounts are integer centavos.
 */

import { balanceCents, computeTotals, isOverdue, lineTotalCents } from "@/lib/service";
import { lineCostCents, partsCostFromLines } from "@/lib/service-lines";
import { pesoExact } from "@/lib/service-finance-history";
import { startOfManilaDayUTC } from "@/lib/dates";

export type Severity = "error" | "warn" | "info";
export type EntityType = "invoice" | "payment" | "expense" | "job";

export type Finding = {
  code: string;
  severity: Severity;
  entity: { type: EntityType; id: string; label: string };
  message: string;
  expectedCents?: number;
  actualCents?: number;
  diffCents?: number;
  /** Payments only: the invoice to open. */
  invoiceId?: string;
};

export type AuditInvoice = {
  id: string; label: string; status: string;
  subtotalCents: number; discountCents: number; taxCents: number; totalCents: number;
  amountPaidCents: number; taxRateBps: number;
  createdAt: Date; dueDate: Date | null; sentAt: Date | null; voidedAt: Date | null;
  /** Editable by the owner, so a backdated invoice is not flagged for payments before its created-at. */
  issueDate?: Date | null;
};
export type AuditInvoiceItem = { invoiceId: string; qty: number; unitPriceCents: number; taxable: boolean };
export type AuditPayment = { id: string; invoiceId: string; amountCents: number; receivedAt: Date };
export type AuditJob = {
  id: string; label: string; quotedCents: number; partsCostCents: number; laborCostCents: number;
};
export type AuditJobItem = {
  jobId: string; kind: string; qty: number; unitPriceCents: number; taxable: boolean; costCents: number;
};
export type AuditTimeLog = {
  jobId: string; kind: string; minutes: number | null; hourlyRateCents: number; endedAt: Date | null;
};
export type AuditExpense = {
  id: string; description: string; vendor: string | null; amountCents: number; spentAt: Date;
  kind: string | null; jobId: string | null; pianoId: string | null; hasReceipt: boolean;
  /** Expense category key (fuel, materials, parts...). Optional so older callers still work. */
  category?: string | null;
};

export type AuditInput = {
  invoices: AuditInvoice[];
  invoiceItems: AuditInvoiceItem[];
  payments: AuditPayment[];
  jobs: AuditJob[];
  jobItems: AuditJobItem[];
  timeLogs: AuditTimeLog[];
  expenses: AuditExpense[];
  now?: Date;
};

export type AuditSummary = {
  errors: number;
  warnings: number;
  info: number;
  total: number;
  /** Sum of the absolute difference of every finding that has one. */
  disputeCents: number;
  byCode: Record<string, { severity: Severity; count: number; disputeCents: number }>;
};

/** Expenses at or above this have no excuse for a missing receipt photo (PHP 1,000). */
export const RECEIPT_EXPECTED_FROM_CENTS = 100_000;

/** Builds a finding; the difference is always actual − expected when both are given. */
function make(
  code: string, severity: Severity, type: EntityType, id: string, label: string, message: string,
  expectedCents?: number, actualCents?: number,
): Finding {
  const diffCents = expectedCents !== undefined && actualCents !== undefined ? actualCents - expectedCents : undefined;
  return { code, severity, entity: { type, id, label }, message, expectedCents, actualCents, diffCents };
}

/** Groups rows by a key. */
function groupBy<T>(rows: T[], key: (r: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const r of rows) {
    const k = key(r);
    const list = map.get(k);
    if (list) list.push(r); else map.set(k, [r]);
  }
  return map;
}

const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);
const day = (d: Date): number => startOfManilaDayUTC(d).getTime();

/** (a) Stored subtotal vs the sum of its lines. */
function checkSubtotal(inv: AuditInvoice, items: AuditInvoiceItem[]): Finding[] {
  const expected = sum(items.map(lineTotalCents));
  if (expected === inv.subtotalCents) return [];
  return [make("invoice_subtotal", "error", "invoice", inv.id, inv.label, "Subtotal does not match the sum of the invoice lines.", expected, inv.subtotalCents)];
}

/** (b) Stored total vs subtotal − discount + tax. */
function checkTotal(inv: AuditInvoice): Finding[] {
  const expected = inv.subtotalCents - inv.discountCents + inv.taxCents;
  if (expected === inv.totalCents) return [];
  return [make("invoice_total", "error", "invoice", inv.id, inv.label, "Total is not subtotal − discount + tax.", expected, inv.totalCents)];
}

/** (c) Stored tax vs tax recomputed from taxable lines at the invoice's own saved rate. */
function checkTax(inv: AuditInvoice, items: AuditInvoiceItem[]): Finding[] {
  const expected = computeTotals(items, { discountCents: inv.discountCents, taxRateBps: inv.taxRateBps }).taxCents;
  if (expected === inv.taxCents) return [];
  return [make("invoice_tax", "error", "invoice", inv.id, inv.label, "Tax does not match the taxable lines at the saved tax rate.", expected, inv.taxCents)];
}

/** (d) Stored amount paid vs the sum of its payments. */
function checkAmountPaid(inv: AuditInvoice, pays: AuditPayment[]): Finding[] {
  const expected = sum(pays.map((p) => p.amountCents));
  if (expected === inv.amountPaidCents) return [];
  return [make("invoice_amount_paid", "error", "invoice", inv.id, inv.label, "Amount paid does not match the payments recorded.", expected, inv.amountPaidCents)];
}

/** (e) Status that contradicts the money (and, as info only, a sent invoice that is overdue). */
function checkStatus(inv: AuditInvoice, pays: AuditPayment[], now: Date): Finding[] {
  const out: Finding[] = [];
  const add = (code: string, message: string, exp?: number, act?: number) =>
    out.push(make(code, "error", "invoice", inv.id, inv.label, message, exp, act));
  const held = Math.max(inv.amountPaidCents, sum(pays.map((p) => p.amountCents)));
  const balance = balanceCents(inv);
  if (inv.status === "paid" && balance > 0) add("status_paid_with_balance", "Marked paid but a balance is still owing.", 0, balance);
  if (inv.status === "paid" && inv.amountPaidCents === 0) add("status_paid_no_payment", "Marked paid but no payment is recorded.", inv.totalCents, 0);
  // The app marks a zero-total invoice that holds a payment "partial" (recalcInvoice), so that is not a mismatch.
  if (inv.status === "partial" && (inv.amountPaidCents === 0 || (inv.totalCents > 0 && inv.amountPaidCents >= inv.totalCents))) {
    add("status_partial_mismatch", inv.amountPaidCents === 0 ? "Marked part paid but nothing has been paid." : "Marked part paid but it is fully paid.");
  }
  if ((inv.status === "draft" || inv.status === "sent") && held > 0) add("status_unpaid_holds_payment", `Marked ${inv.status} but it holds payments.`, 0, held);
  if (inv.status === "void" && held > 0) add("status_void_holds_payment", "Voided but it still holds payments.", 0, held);
  if (inv.status === "sent" && inv.amountPaidCents === 0 && isOverdue(inv, now)) {
    out.push(make("invoice_overdue", "info", "invoice", inv.id, inv.label, "Sent, unpaid and past its due date."));
  }
  return out;
}

/** (f) Payments exceed the invoice total. */
function checkOverpaid(inv: AuditInvoice, pays: AuditPayment[]): Finding[] {
  const paid = sum(pays.map((p) => p.amountCents));
  if (paid <= inv.totalCents || inv.voidedAt) return [];
  return [make("invoice_overpaid", "error", "invoice", inv.id, inv.label, "Payments add up to more than the invoice total.", inv.totalCents, paid)];
}

/** (g) Payment with a zero/negative amount, or dated before its invoice existed. */
function checkPayment(p: AuditPayment, inv: AuditInvoice): Finding[] {
  const out: Finding[] = [];
  if (p.amountCents <= 0) out.push(make("payment_non_positive", "error", "payment", p.id, `Payment on ${inv.label}`, "Payment amount is zero or negative.", undefined, p.amountCents));
  const existedFrom = inv.issueDate && inv.issueDate < inv.createdAt ? inv.issueDate : inv.createdAt;
  if (day(p.receivedAt) < day(existedFrom)) {
    out.push(make("payment_before_invoice", "warn", "payment", p.id, `Payment on ${inv.label}`, "Payment is dated before the invoice was created."));
  }
  return out.map((f) => ({ ...f, invoiceId: inv.id }));
}

/** (j) No lines at all but a non-zero total. */
function checkNoItems(inv: AuditInvoice, items: AuditInvoiceItem[]): Finding[] {
  if (items.length > 0 || inv.totalCents === 0) return [];
  return [make("invoice_no_items", "error", "invoice", inv.id, inv.label, "Invoice has no lines but a non-zero total.", 0, inv.totalCents)];
}

/** (h) Job derived columns vs what recalcJobMoney / recalcJobLabor would write today. */
function checkJob(job: AuditJob, items: AuditJobItem[], logs: AuditTimeLog[]): Finding[] {
  const out: Finding[] = [];
  const quoted = Math.max(0, sum(items.map(lineTotalCents)));
  if (quoted !== job.quotedCents) out.push(make("job_quoted_drift", "warn", "job", job.id, job.label, "Quoted total does not match the job lines.", quoted, job.quotedCents));
  const parts = partsCostFromLines(items);
  if (parts !== job.partsCostCents) out.push(make("job_parts_drift", "warn", "job", job.id, job.label, "Parts cost does not match the job lines.", parts, job.partsCostCents));
  const labor = sum(logs.filter((l) => l.endedAt && l.kind === "work").map((l) => Math.round(((l.minutes ?? 0) / 60) * l.hourlyRateCents)));
  if (labor !== job.laborCostCents) out.push(make("job_labor_drift", "warn", "job", job.id, job.label, "Labor cost does not match the stopped work time logs.", labor, job.laborCostCents));
  return out;
}

/** (i) Single-expense problems: amount, kind/link consistency, receipt. */
function checkExpense(e: AuditExpense): Finding[] {
  const out: Finding[] = [];
  const label = e.description;
  if (e.amountCents <= 0) out.push(make("expense_amount", "error", "expense", e.id, label, "Expense amount is zero or negative.", undefined, e.amountCents));
  if (!e.kind) out.push(make("expense_no_kind", "info", "expense", e.id, label, "Not classified yet (job, stock or overhead). Use Review expenses to sort it."));
  if (e.kind === "job" && !e.jobId) out.push(make("expense_job_no_job", "warn", "expense", e.id, label, "Marked as a job cost but not linked to a job."));
  if (e.kind === "stock" && !e.pianoId) out.push(make("expense_stock_no_piano", "warn", "expense", e.id, label, "Marked as piano stock but not linked to a piano."));
  if (!e.hasReceipt && e.amountCents >= RECEIPT_EXPECTED_FROM_CENTS) out.push(make("expense_no_receipt", "info", "expense", e.id, label, "No receipt photo on a large expense."));
  return out;
}

/** (i) Same day + amount + vendor/description: every row after the first is flagged. */
function checkDuplicates(expenses: AuditExpense[]): Finding[] {
  const groups = groupBy(expenses, (e) => `${day(e.spentAt)}|${e.amountCents}|${(e.vendor || e.description).trim().toLowerCase()}`);
  const out: Finding[] = [];
  for (const rows of groups.values()) {
    for (const e of rows.slice(1)) {
      out.push(make("expense_duplicate", "warn", "expense", e.id, e.description, `Possible duplicate: ${rows.length} expenses with the same date, amount and vendor.`, 0, e.amountCents));
    }
  }
  return out;
}

/**
 * (k) Parts priced at their selling price (no explicit cost) AND expenses linked to the same job: the job cost may
 * be counted twice. Limit: only flagged when the part cost is derived from the price; with an explicit cost we cannot
 * know whether the expense is the same purchase.
 */
function checkPartsDoubled(job: AuditJob, items: AuditJobItem[], allExpenses: AuditExpense[]): Finding[] {
  // Only a purchase of materials/parts can be the same thing as a part line; fuel, meals, fares etc. cannot.
  const expenses = allExpenses.filter((e) => e.category === "materials" || e.category === "parts");
  const derived = items.filter((i) => i.kind === "part" && !(i.costCents > 0));
  if (derived.length === 0 || expenses.length === 0) return [];
  const parts = sum(derived.map(lineCostCents));
  const linked = sum(expenses.map((e) => e.amountCents));
  return [make("job_part_cost_maybe_doubled", "warn", "job", job.id, job.label,
    `Parts are costed at their selling price and a materials/parts expense is also linked to this job, so the job cost may be counted twice. Parts at selling price ${pesoExact(parts)} plus linked materials/parts expenses ${pesoExact(linked)}.`)];
}

/** (l) Linked to a job but not kind "job": job margin counts it, Finance profit does not. */
function checkExpenseKindMismatch(e: AuditExpense): Finding[] {
  if (!e.jobId || !e.kind || e.kind === "job") return [];
  return [make("expense_job_kind_mismatch", "warn", "expense", e.id, e.description, `Linked to a job but marked ${e.kind}; the job margin counts it, the Finance profit does not.`)];
}

/** Rolls findings up into counts per severity and code, plus the cents in dispute. */
export function summarize(findings: Finding[]): AuditSummary {
  const summary: AuditSummary = { errors: 0, warnings: 0, info: 0, total: findings.length, disputeCents: 0, byCode: {} };
  for (const f of findings) {
    if (f.severity === "error") summary.errors++;
    else if (f.severity === "warn") summary.warnings++;
    else summary.info++;
    const cents = Math.abs(f.diffCents ?? 0);
    summary.disputeCents += cents;
    const entry = (summary.byCode[f.code] ??= { severity: f.severity, count: 0, disputeCents: 0 });
    entry.count++;
    entry.disputeCents += cents;
  }
  return summary;
}

const SEVERITY_ORDER: Record<Severity, number> = { error: 0, warn: 1, info: 2 };

/** Runs every check over the given rows and returns sorted findings plus a summary. */
export function auditFinance(input: AuditInput): { findings: Finding[]; summary: AuditSummary } {
  const now = input.now ?? new Date();
  const itemsBy = groupBy(input.invoiceItems, (i) => i.invoiceId);
  const paysBy = groupBy(input.payments, (p) => p.invoiceId);
  const jobItemsBy = groupBy(input.jobItems, (i) => i.jobId);
  const logsBy = groupBy(input.timeLogs, (l) => l.jobId);
  const expensesByJob = groupBy(input.expenses.filter((e) => e.jobId), (e) => e.jobId!);
  const findings: Finding[] = [];

  for (const inv of input.invoices) {
    const items = itemsBy.get(inv.id) ?? [];
    const pays = paysBy.get(inv.id) ?? [];
    findings.push(
      ...checkSubtotal(inv, items), ...checkTotal(inv), ...checkTax(inv, items), ...checkAmountPaid(inv, pays),
      ...checkStatus(inv, pays, now), ...checkOverpaid(inv, pays), ...checkNoItems(inv, items),
      ...pays.flatMap((p) => checkPayment(p, inv)),
    );
  }
  for (const job of input.jobs) findings.push(...checkJob(job, jobItemsBy.get(job.id) ?? [], logsBy.get(job.id) ?? []));
  for (const job of input.jobs) findings.push(...checkPartsDoubled(job, jobItemsBy.get(job.id) ?? [], expensesByJob.get(job.id) ?? []));
  for (const e of input.expenses) findings.push(...checkExpense(e), ...checkExpenseKindMismatch(e));
  findings.push(...checkDuplicates(input.expenses));

  findings.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.code.localeCompare(b.code));
  return { findings, summary: summarize(findings) };
}
