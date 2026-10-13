/**
 * Invoice / payment WRITE logic (phase 3). NOT a "use server" file: the Server Actions in `service.ts` are
 * thin wrappers (auth + revalidate) around these functions, which take the signed-in user as an argument so
 * they can also be exercised directly against a local database (tests/service-finance-edit-db.ts).
 *
 * Rules enforced here, after the invoice row is locked and re-read:
 *  - void invoices cannot be edited (reopen first);
 *  - once an invoice has a payment (or is paid / partial) every edit is owner-only, needs a written reason,
 *    and writes its history row INSIDE the same transaction, so no such change is ever saved without it;
 *  - payments may never add up to more than the invoice total.
 */

import { eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { serviceInvoiceItems, serviceInvoices, serviceJobEvents, serviceJobs, servicePayments } from "@/db/schema";
import {
  boolOr, computeTotals, intOr, invoiceCode, moneyToCents, oneOf, optionalDate, str, PAYMENT_METHODS,
} from "@/lib/service";
import { isInvoiceKind } from "@/lib/service-dashboard";
import { canViewFinance, confirmMatches } from "@/lib/service-flow";
import { cleanDetails } from "@/lib/service-lines";
import {
  EditRejected, clampQty, clampTaxBps, lineLimitError, discountMessage, discountTooLarge, fmtPesoExact, needsReason, paymentChanges,
  validateReason, wouldOverpay,
} from "@/lib/service-finance-edit";
import { jobIsFinished } from "@/lib/service-sale";
import { rollPianoRecall } from "@/server/service-recall";
import { describeChange, diffFields, dropSameDay, pesoExact, type FinanceChanges } from "@/lib/service-finance-history";
import {
  actorOf, assertNotOverpaid, nameRefs, recalcInvoice, safeHistory, withInvoiceLock,
  type Ex, type InvoiceRow, type LockResult, type Tx,
} from "@/server/service-invoice-core";
import { recordFinanceHistory, recordFinanceHistoryStrict, type FinanceHistoryEntry } from "@/server/service-finance-history";
import { getServiceSettings } from "@/server/service-data";

export type OpUser = { id: string; name?: string | null; role?: string | null };
export type OpResult<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };
const ok = <T>(data?: T): OpResult<T> => ({ ok: true, data });
const fail = (error: string): OpResult<never> => ({ ok: false, error });

export const MAX_LINES_PER_BATCH = 30;
export const FINANCE_DENIED_MESSAGE = "Only the owner can use finance and expenses.";
const VOID_MESSAGE = "This invoice is void — reopen it before changing it.";

/* ------------------------------------------------------------------ locking + history plumbing */

type Ctx = { actor: string; label: (inv: { invoiceNumber: number; issueDate: Date }) => string };
type HistoryPlan = { required: boolean; reason: string | null; build: (ex: Ex) => Promise<FinanceHistoryEntry[]> };

const paymentsSum = async (tx: Tx, invoiceId: string): Promise<number> => {
  const [r] = await tx.select({ n: sql<number>`coalesce(sum(${servicePayments.amountCents}), 0)::int` })
    .from(servicePayments).where(eq(servicePayments.invoiceId, invoiceId));
  return r?.n ?? 0;
};

/**
 * Decides, from the freshly locked invoice, whether this edit needs a reason. If it does: owner only and
 * the reason must be valid. Throws EditRejected (rolls the edit back) otherwise.
 */
async function gateEdit(tx: Tx, inv: InvoiceRow, user: OpUser, rawReason: unknown, always = false): Promise<{ required: boolean; reason: string | null }> {
  const sum = await paymentsSum(tx, inv.id);
  const required = always || needsReason({ status: inv.status, amountPaidCents: Math.max(inv.amountPaidCents, sum) });
  if (!required) return { required: false, reason: null };
  if (!canViewFinance(user)) throw new EditRejected(FINANCE_DENIED_MESSAGE);
  const r = validateReason(rawReason);
  if (!r.ok) throw new EditRejected(r.error);
  return { required: true, reason: r.reason };
}

/**
 * Lock the invoice, run the edit, and record its history. When the plan says a reason was required, the
 * history rows are written strictly inside the transaction (a failure rolls the edit back); otherwise they
 * are written best-effort after the commit, exactly like the pre-phase-3 behaviour.
 */
async function lockedEdit<T>(
  user: OpUser,
  invoiceId: string,
  fn: (tx: Tx, inv: InvoiceRow, ctx: Ctx) => Promise<{ plan: HistoryPlan; value: T }>,
): Promise<LockResult<T>> {
  const settings = await getServiceSettings(user.id);
  const ctx: Ctx = { actor: actorOf(user), label: (inv) => invoiceCode(settings.invoicePrefix, inv.invoiceNumber, inv.issueDate) };
  let deferred: HistoryPlan | null = null;
  const res = await withInvoiceLock(invoiceId, async (tx, inv) => {
    if (!inv) throw new EditRejected("Invoice not found.");
    const out = await fn(tx, inv, ctx);
    if (out.plan.required) {
      const rows = await out.plan.build(tx);
      await recordFinanceHistoryStrict(tx, rows.map((r) => ({ ...r, reason: out.plan.reason })));
    } else {
      deferred = out.plan;
    }
    return out.value;
  });
  const plan = deferred as HistoryPlan | null;
  if (res.ok && plan) await safeHistory(async () => { await recordFinanceHistory(await plan.build(db)); });
  return res;
}

const unwrap = <T>(r: LockResult<T>): OpResult<T> => (r.ok ? ok(r.value) : fail(r.error));

/** After a recalculation: refuse a discount above the subtotal where the rules say so. */
function assertDiscountOk(r: { before: InvoiceRow; after: InvoiceRow; state: { subtotalCents: number } }, opts: { explicit: boolean; required: boolean }) {
  if (!discountTooLarge(r.after.discountCents, r.state.subtotalCents)) return;
  // Explicit discount input is always checked. Line edits are only blocked on invoices that already carry
  // money (typing a price on a draft passes through odd intermediate totals).
  if (opts.explicit || (opts.required && !discountTooLarge(r.before.discountCents, r.before.subtotalCents))) {
    throw new EditRejected(discountMessage(r.after.discountCents, r.state.subtotalCents));
  }
}

/* ------------------------------------------------------------------ invoice details */

export async function updateInvoiceOp(
  user: OpUser,
  id: string,
  patch: {
    issueDate?: string; dueDate?: string | null; notes?: string | null; terms?: string | null;
    taxRateBps?: number; discount?: number; customerId?: string; kind?: string;
  },
  reasonRaw?: unknown,
): Promise<OpResult> {
  if (patch.kind !== undefined && !isInvoiceKind(patch.kind)) return fail("Invoice type must be service or piano sale.");
  const issue = patch.issueDate !== undefined ? optionalDate(patch.issueDate) : undefined;
  if (patch.issueDate !== undefined && !issue) return fail("Pick a valid issue date.");
  const newDiscount = patch.discount !== undefined ? Math.max(0, moneyToCents(patch.discount)) : undefined;

  const res = await lockedEdit(user, id, async (tx, inv, ctx) => {
    if (inv.voidedAt) throw new EditRejected(VOID_MESSAGE);
    const gate = await gateEdit(tx, inv, user, reasonRaw);
    await tx.update(serviceInvoices).set({
      issueDate: issue ?? undefined,
      dueDate: patch.dueDate !== undefined ? optionalDate(patch.dueDate) : undefined,
      notes: patch.notes !== undefined ? str(patch.notes, 2_000) : undefined,
      terms: patch.terms !== undefined ? str(patch.terms, 1_000) : undefined,
      taxRateBps: patch.taxRateBps !== undefined ? clampTaxBps(intOr(patch.taxRateBps, 0)) : undefined,
      discountCents: newDiscount,
      customerId: patch.customerId || undefined,
      kind: patch.kind,
      updatedAt: new Date(),
    }).where(eq(serviceInvoices.id, id));
    const rc = await recalcInvoice(tx, id);
    if (!rc) throw new EditRejected("Invoice not found.");
    assertDiscountOk(rc, { explicit: newDiscount !== undefined, required: gate.required });
    assertNotOverpaid(rc);
    const before = inv, after = rc.after;
    return {
      value: undefined,
      plan: {
        ...gate,
        build: async (ex) => {
          const changes = dropSameDay(
            diffFields(before, after, ["discountCents", "taxRateBps", "dueDate", "issueDate", "customerId", "notes", "terms", "totalCents", "kind", "status"]),
            ["issueDate", "dueDate"],
          );
          if (!Object.keys(changes).length) return [];
          const named = await nameRefs(changes, ex);
          return [{
            entityType: "invoice", entityId: id, invoiceId: id, jobId: after.jobId, action: "update",
            summary: describeChange("invoice", "update", ctx.label(after), named), changes: named, actorName: ctx.actor,
          }];
        },
      },
    };
  });
  return unwrap(res);
}

/* ------------------------------------------------------------------ invoice lines */

export type InvoiceItemInput = { description: string; details?: string | null; qty?: number; unitPrice?: number; taxable?: boolean; position?: number };

export async function addInvoiceItemsOp(
  user: OpUser,
  invoiceId: string,
  inputs: InvoiceItemInput[],
  reasonRaw?: unknown,
): Promise<OpResult<{ ids: string[]; positions: number[] }>> {
  if (!Array.isArray(inputs) || inputs.length === 0) return fail("Nothing to add.");
  if (inputs.length > MAX_LINES_PER_BATCH) return fail("Too many lines at once.");
  if (inputs.some((i) => !str(i.description, 300))) return fail("Describe the line item.");
  for (const i of inputs) {
    const tooBig = lineLimitError(Math.min(9_999, Math.max(1, intOr(i.qty, 1))), moneyToCents(i.unitPrice));
    if (tooBig) return fail(tooBig);
  }

  const res = await lockedEdit(user, invoiceId, async (tx, inv, ctx) => {
    if (inv.voidedAt) throw new EditRejected("This invoice is void — reopen it before changing lines.");
    const gate = await gateEdit(tx, inv, user, reasonRaw);
    const [{ max }] = await tx
      .select({ max: sql<number>`coalesce(max(${serviceInvoiceItems.position}), 0)::int` })
      .from(serviceInvoiceItems)
      .where(eq(serviceInvoiceItems.invoiceId, invoiceId));
    const out: { id: string; position: number }[] = [];
    let next = (max ?? 0) + 1;
    for (const input of inputs) {
      const position = typeof input.position === "number" && inputs.length === 1 ? Math.max(0, Math.round(input.position)) : next++;
      const [row] = await tx.insert(serviceInvoiceItems).values({
        invoiceId,
        description: str(input.description, 300) ?? "",
        details: cleanDetails(input.details),
        qty: Math.min(9_999, Math.max(1, intOr(input.qty, 1))),
        unitPriceCents: moneyToCents(input.unitPrice),
        taxable: boolOr(input.taxable, true),
        position,
      }).returning({ id: serviceInvoiceItems.id });
      out.push({ id: row!.id, position });
    }
    const rc = await recalcInvoice(tx, invoiceId);
    if (!rc) throw new EditRejected("Invoice not found.");
    assertDiscountOk(rc, { explicit: false, required: gate.required });
    assertNotOverpaid(rc);
    const after = rc.after;
    return {
      value: { ids: out.map((r) => r.id), positions: out.map((r) => r.position) },
      plan: {
        ...gate,
        build: async (ex) => {
          const found = await ex.select().from(serviceInvoiceItems).where(inArray(serviceInvoiceItems.id, out.map((r) => r.id)));
          const label = ctx.label(after);
          return found.map((it) => {
            const changes: FinanceChanges = {
              description: { from: null, to: it.description }, qty: { from: null, to: it.qty },
              unitPriceCents: { from: null, to: it.unitPriceCents }, taxable: { from: null, to: it.taxable },
            };
            if (found.length === 1) changes.totalCents = { from: inv.totalCents, to: after.totalCents };
            return {
              entityType: "invoice_item" as const, entityId: it.id, invoiceId, jobId: after.jobId, action: "create" as const,
              summary: `${describeChange("invoice_item", "create", `"${it.description}" on ${label}`)} (${it.qty} x ${pesoExact(it.unitPriceCents)})`,
              changes, actorName: ctx.actor,
            };
          });
        },
      },
    };
  });
  return unwrap(res);
}

export async function updateInvoiceItemOp(
  user: OpUser,
  id: string,
  patch: { description?: string; details?: string | null; qty?: number; unitPrice?: number; taxable?: boolean },
  reasonRaw?: unknown,
): Promise<OpResult> {
  const [found] = await db.select({ invoiceId: serviceInvoiceItems.invoiceId }).from(serviceInvoiceItems).where(eq(serviceInvoiceItems.id, id)).limit(1);
  if (!found) return fail("Line item not found.");
  const res = await lockedEdit(user, found.invoiceId, async (tx, inv, ctx) => {
    if (inv.voidedAt) throw new EditRejected(VOID_MESSAGE);
    const [item] = await tx.select().from(serviceInvoiceItems).where(eq(serviceInvoiceItems.id, id)).limit(1);
    if (!item) throw new EditRejected("Line item not found.");
    const set = {
      description: patch.description !== undefined ? str(patch.description, 300) || item.description : undefined,
      details: patch.details !== undefined ? cleanDetails(patch.details) : undefined,
      qty: patch.qty !== undefined ? clampQty(intOr(patch.qty, 1)) : undefined,
      unitPriceCents: patch.unitPrice !== undefined ? moneyToCents(patch.unitPrice) : undefined,
      taxable: patch.taxable !== undefined ? boolOr(patch.taxable, true) : undefined,
    };
    const tooBig = lineLimitError(set.qty ?? item.qty, set.unitPriceCents ?? item.unitPriceCents);
    if (tooBig) throw new EditRejected(tooBig);
    // Nothing to change (empty patch): a clean no-op, never an empty UPDATE.
    if (Object.values(set).every((v) => v === undefined)) {
      return { value: undefined, plan: { required: false, reason: null, build: async () => [] } };
    }
    const gate = await gateEdit(tx, inv, user, reasonRaw);
    await tx.update(serviceInvoiceItems).set(set).where(eq(serviceInvoiceItems.id, id));
    const rc = await recalcInvoice(tx, inv.id);
    if (!rc) throw new EditRejected("Invoice not found.");
    assertDiscountOk(rc, { explicit: false, required: gate.required });
    assertNotOverpaid(rc);
    const after = rc.after;
    return {
      value: undefined,
      plan: {
        ...gate,
        build: async (ex) => {
          const [now] = await ex.select().from(serviceInvoiceItems).where(eq(serviceInvoiceItems.id, id)).limit(1);
          if (!now) return [];
          const changes = diffFields(item, now, ["description", "details", "qty", "unitPriceCents", "taxable"]);
          if (!Object.keys(changes).length) return [];
          if (inv.totalCents !== after.totalCents) changes.totalCents = { from: inv.totalCents, to: after.totalCents };
          if (inv.status !== after.status) changes.status = { from: inv.status, to: after.status };
          return [{
            entityType: "invoice_item", entityId: id, invoiceId: inv.id, jobId: after.jobId, action: "update",
            summary: describeChange("invoice_item", "update", `"${now.description}" on ${ctx.label(after)}`, changes), changes, actorName: ctx.actor,
          }];
        },
      },
    };
  });
  return unwrap(res);
}

export async function deleteInvoiceItemOp(user: OpUser, id: string, reasonRaw?: unknown): Promise<OpResult> {
  const [found] = await db.select({ invoiceId: serviceInvoiceItems.invoiceId }).from(serviceInvoiceItems).where(eq(serviceInvoiceItems.id, id)).limit(1);
  if (!found) return fail("Line item not found.");
  const res = await lockedEdit(user, found.invoiceId, async (tx, inv, ctx) => {
    if (inv.voidedAt) throw new EditRejected(VOID_MESSAGE);
    const [item] = await tx.select().from(serviceInvoiceItems).where(eq(serviceInvoiceItems.id, id)).limit(1);
    if (!item) throw new EditRejected("Line item not found.");
    const gate = await gateEdit(tx, inv, user, reasonRaw);
    await tx.delete(serviceInvoiceItems).where(eq(serviceInvoiceItems.id, id));
    const rc = await recalcInvoice(tx, inv.id);
    if (!rc) throw new EditRejected("Invoice not found.");
    assertDiscountOk(rc, { explicit: false, required: gate.required });
    assertNotOverpaid(rc);
    const after = rc.after;
    return {
      value: undefined,
      plan: {
        ...gate,
        build: async () => {
          const changes: FinanceChanges = {
            description: { from: item.description, to: null }, qty: { from: item.qty, to: null },
            unitPriceCents: { from: item.unitPriceCents, to: null }, taxable: { from: item.taxable, to: null },
          };
          if (inv.totalCents !== after.totalCents) changes.totalCents = { from: inv.totalCents, to: after.totalCents };
          if (inv.status !== after.status) changes.status = { from: inv.status, to: after.status };
          return [{
            entityType: "invoice_item", entityId: id, invoiceId: inv.id, jobId: after.jobId, action: "delete",
            summary: `${describeChange("invoice_item", "delete", `"${item.description}" on ${ctx.label(after)}`)} (${item.qty} x ${pesoExact(item.unitPriceCents)})`,
            changes, actorName: ctx.actor,
          }];
        },
      },
    };
  });
  return unwrap(res);
}

/* ------------------------------------------------------------------ status: sent / draft / void */

export async function setInvoiceStatusOp(user: OpUser, id: string, status: string, reasonRaw?: unknown): Promise<OpResult> {
  // Explicit allow-list: unknown input never falls back to "draft" (which would clear sentAt).
  if (status !== "draft" && status !== "sent" && status !== "void") return fail("Unknown invoice status. Use draft, sent or void.");
  const next: "draft" | "sent" | "void" = status;
  const res = await lockedEdit(user, id, async (tx, inv, ctx) => {
    if (next === "sent" && inv.voidedAt) throw new EditRejected("This invoice is void — reopen it before marking it as sent.");
    // Voiding or reopening an invoice that has money on it is a finance decision: owner + reason + audit.
    const gate = await gateEdit(tx, inv, user, reasonRaw);
    await tx.update(serviceInvoices).set({
      sentAt: next === "sent" ? new Date() : next === "draft" ? null : undefined,
      voidedAt: next === "void" ? new Date() : next === "draft" ? null : undefined,
      updatedAt: new Date(),
    }).where(eq(serviceInvoices.id, id));
    const rc = await recalcInvoice(tx, id);
    if (!rc) throw new EditRejected("Invoice not found.");
    assertNotOverpaid(rc);
    const after = rc.after;
    return {
      value: undefined,
      plan: {
        ...gate,
        build: async () => {
          const changes = diffFields(inv, after, ["status"]);
          if (!changes.status) return [];
          return [{
            entityType: "invoice", entityId: id, invoiceId: id, jobId: after.jobId, action: "status",
            summary: describeChange("invoice", "status", ctx.label(after), changes), changes, actorName: ctx.actor,
          }];
        },
      },
    };
  });
  return unwrap(res);
}

/* ------------------------------------------------------------------ payments */

/**
 * Recording a payment is deliberately NOT a reasoned edit: it needs no reason and its history row is
 * best-effort (written after commit), exactly as before phase 3. It still runs under the invoice lock and
 * can never overpay. Only changing or removing money already recorded needs a reason + strict history.
 */
export async function recordPaymentOp(user: OpUser, input: {
  invoiceId: string; amount?: number; method?: string; reference?: string | null;
  receivedAt?: string | null; note?: string | null; markSent?: boolean;
}): Promise<OpResult> {
  const amountCents = moneyToCents(input.amount);
  if (amountCents <= 0) return fail("Enter a payment amount above zero.");
  if (amountCents > 2_000_000_000) return fail("Amount too large — keep each line under ₱20,000,000.");
  const receivedAt = optionalDate(input.receivedAt) ?? new Date();

  const res = await lockedEdit(user, input.invoiceId, async (tx, target, ctx) => {
    if (target.voidedAt) throw new EditRejected("This invoice is void — reopen it before recording a payment.");
    if (!target.sentAt && target.amountPaidCents <= 0) {
      if (!input.markSent) throw new EditRejected("This invoice is still a draft. Mark it as sent first, or choose “Mark as sent and record payment”.");
      await tx.update(serviceInvoices).set({ sentAt: new Date(), updatedAt: new Date() }).where(eq(serviceInvoices.id, input.invoiceId));
    }
    // Compare against the real lines and payments, not the stored columns.
    const items = await tx.select().from(serviceInvoiceItems).where(eq(serviceInvoiceItems.invoiceId, input.invoiceId));
    const paidNow = await paymentsSum(tx, input.invoiceId);
    const totalNow = computeTotals(items, { discountCents: target.discountCents, taxRateBps: target.taxRateBps }).totalCents;
    if (wouldOverpay(totalNow, paidNow + amountCents)) {
      const owed = Math.max(0, totalNow - paidNow);
      throw new EditRejected(
        `This payment (${fmtPesoExact(amountCents)}) is more than the balance (${fmtPesoExact(owed)}) on this invoice. Enter ${fmtPesoExact(owed)} or less.`,
      );
    }
    const [paymentRow] = await tx.insert(servicePayments).values({
      invoiceId: input.invoiceId,
      amountCents,
      method: oneOf(input.method, PAYMENT_METHODS.map((m) => m.key), "cash"),
      reference: str(input.reference, 120),
      receivedAt,
      note: str(input.note, 500),
    }).returning();
    const rc = await recalcInvoice(tx, input.invoiceId);
    if (!rc) throw new EditRejected("Invoice not found.");
    assertNotOverpaid(rc);
    if (rc.after.jobId) {
      await tx.insert(serviceJobEvents).values({
        jobId: rc.after.jobId, type: "payment", message: `Payment received — ${(amountCents / 100).toFixed(2)}`,
        actorName: "Owner", at: receivedAt,
      });
    }
    const invoice = rc.after;
    return {
      value: undefined,
      plan: {
        required: false, reason: null,
        build: async () => {
          if (!paymentRow) return [];
          const label = ctx.label(invoice);
          const changes: FinanceChanges = {
            amountCents: { from: null, to: paymentRow.amountCents }, method: { from: null, to: paymentRow.method },
            receivedAt: { from: null, to: paymentRow.receivedAt.toISOString() },
          };
          if (paymentRow.reference) changes.reference = { from: null, to: paymentRow.reference };
          const rows: FinanceHistoryEntry[] = [{
            entityType: "payment", entityId: paymentRow.id, invoiceId: invoice.id, jobId: invoice.jobId, action: "create",
            summary: `${describeChange("payment", "create", `${pesoExact(paymentRow.amountCents)} on ${label}`)} (${paymentRow.method})`, changes, actorName: ctx.actor,
          }];
          if (invoice.status !== target.status) {
            const sc = { status: { from: target.status, to: invoice.status } };
            rows.push({
              entityType: "invoice", entityId: invoice.id, invoiceId: invoice.id, jobId: invoice.jobId, action: "status",
              summary: describeChange("invoice", "status", label, sc), changes: sc, actorName: ctx.actor,
            });
          }
          return rows;
        },
      },
    };
  });
  // After the lock is released and the payment is committed: date the piano's service. Best-effort, never affects the payment.
  if (res.ok) await stampPianoServiceDate(input.invoiceId, receivedAt);
  return unwrap(res);
}

/**
 * A payment on an invoice linked to a tuning-type home-service job (finished only) dates that piano's last service / next due date and
 * its recall (see `rollPianoRecall`). Runs OUTSIDE `withInvoiceLock` (the payment is already committed), reads only, and
 * swallows every error: the money has been recorded and must never be undone or failed by this.
 */
async function stampPianoServiceDate(invoiceId: string, paidAt: Date): Promise<void> {
  try {
    const [inv] = await db.select({ jobId: serviceInvoices.jobId }).from(serviceInvoices).where(eq(serviceInvoices.id, invoiceId)).limit(1);
    if (!inv?.jobId) return;
    const [job] = await db.select({ completedAt: serviceJobs.completedAt, status: serviceJobs.status, cancelledAt: serviceJobs.cancelledAt }).from(serviceJobs).where(eq(serviceJobs.id, inv.jobId)).limit(1);
    // Only a finished job is dated by a payment (rollPianoRecall re-checks): a deposit or prepayment on a booked job is skipped.
    if (!job || !jobIsFinished(job)) return;
    const [count] = await db.select({ n: sql<number>`count(*)::int` }).from(servicePayments).where(eq(servicePayments.invoiceId, invoiceId));
    await rollPianoRecall(inv.jobId, { paidAt, firstPayment: (count?.n ?? 0) <= 1 });
  } catch (err) {
    console.error("recordPayment: payment saved, but dating the piano's service failed", invoiceId, err);
  }
}

export type EditPaymentInput = {
  /** Pesos, like recordPayment. */
  amount?: number | string;
  receivedAt?: string | null;
  method?: string;
  reference?: string | null;
  note?: string | null;
  reason: string;
};

/** Edits ONE payment row in place (never adds an adjustment row). Owner only; reason always required. */
export async function editPaymentOp(user: OpUser, paymentId: string, input: EditPaymentInput): Promise<OpResult> {
  if (!canViewFinance(user)) return fail(FINANCE_DENIED_MESSAGE);
  const [found] = await db.select({ invoiceId: servicePayments.invoiceId }).from(servicePayments).where(eq(servicePayments.id, paymentId)).limit(1);
  if (!found) return fail("Payment not found.");

  let amountCents: number | undefined;
  if (input.amount !== undefined) {
    amountCents = moneyToCents(input.amount);
    if (amountCents <= 0) return fail("Enter a payment amount above zero.");
    if (amountCents > 2_000_000_000) return fail("Amount too large — keep each line under ₱20,000,000.");
  }
  let receivedAt: Date | undefined;
  if (input.receivedAt !== undefined) {
    const d = optionalDate(input.receivedAt);
    if (!d || Number.isNaN(d.getTime())) return fail("Pick a valid date received.");
    receivedAt = d;
  }
  if (input.method !== undefined && !PAYMENT_METHODS.some((m) => m.key === input.method)) return fail("Pick a valid payment method.");

  const res = await lockedEdit(user, found.invoiceId, async (tx, inv, ctx) => {
    if (inv.voidedAt) throw new EditRejected(VOID_MESSAGE);
    const [pBefore] = await tx.select().from(servicePayments).where(eq(servicePayments.id, paymentId)).limit(1);
    if (!pBefore || pBefore.invoiceId !== inv.id) throw new EditRejected("Payment not found.");
    // Editing a payment ALWAYS needs a valid reason and strict history, whatever the invoice status.
    const gate = await gateEdit(tx, inv, user, input.reason, true);
    const set = {
      amountCents: amountCents ?? undefined,
      receivedAt,
      method: input.method,
      reference: input.reference !== undefined ? str(input.reference, 120) : undefined,
      note: input.note !== undefined ? str(input.note, 500) : undefined,
    };
    if (Object.values(set).every((v) => v === undefined)) throw new EditRejected("Nothing was changed.");
    const [pAfter] = await tx.update(servicePayments).set(set).where(eq(servicePayments.id, paymentId)).returning();
    const changes = paymentChanges(pBefore, pAfter!);
    if (!Object.keys(changes).length) throw new EditRejected("Nothing was changed.");
    const rc = await recalcInvoice(tx, inv.id);
    if (!rc) throw new EditRejected("Invoice not found.");
    assertNotOverpaid(rc);
    const after = rc.after;
    return {
      value: undefined,
      plan: {
        ...gate,
        build: async () => {
          const label = ctx.label(after);
          if (inv.amountPaidCents !== after.amountPaidCents) changes.amountPaidCents = { from: inv.amountPaidCents, to: after.amountPaidCents };
          const rows: FinanceHistoryEntry[] = [{
            entityType: "payment", entityId: paymentId, invoiceId: inv.id, jobId: after.jobId, action: "update",
            summary: describeChange("payment", "update", `${pesoExact(pBefore.amountCents)} on ${label}`, changes), changes, actorName: ctx.actor,
          }];
          if (inv.status !== after.status) {
            const sc = { status: { from: inv.status, to: after.status } };
            rows.push({
              entityType: "invoice", entityId: inv.id, invoiceId: inv.id, jobId: after.jobId, action: "status",
              summary: describeChange("invoice", "status", label, sc), changes: sc, actorName: ctx.actor,
            });
          }
          return rows;
        },
      },
    };
  });
  return unwrap(res);
}

/** Owner correction path: removes a payment. Owner + reason + lock + strict history; the row keeps the full payment. */
export async function deletePaymentOp(user: OpUser, id: string, reasonRaw?: unknown): Promise<OpResult> {
  if (!canViewFinance(user)) return fail(FINANCE_DENIED_MESSAGE);
  const [found] = await db.select({ invoiceId: servicePayments.invoiceId }).from(servicePayments).where(eq(servicePayments.id, id)).limit(1);
  if (!found) return fail("Payment not found.");
  const res = await lockedEdit(user, found.invoiceId, async (tx, inv, ctx) => {
    if (inv.voidedAt) throw new EditRejected(VOID_MESSAGE);
    const [payment] = await tx.select().from(servicePayments).where(eq(servicePayments.id, id)).limit(1);
    if (!payment || payment.invoiceId !== inv.id) throw new EditRejected("Payment not found.");
    const gate = await gateEdit(tx, inv, user, reasonRaw, true); // always reason + strict history
    await tx.delete(servicePayments).where(eq(servicePayments.id, id));
    const rc = await recalcInvoice(tx, inv.id);
    if (!rc) throw new EditRejected("Invoice not found.");
    assertNotOverpaid(rc);
    const after = rc.after;
    return {
      value: undefined,
      plan: {
        ...gate,
        build: async () => {
          const label = ctx.label(after);
          const changes: FinanceChanges = {
            amountCents: { from: payment.amountCents, to: null }, method: { from: payment.method, to: null },
            receivedAt: { from: payment.receivedAt.toISOString(), to: null },
          };
          if (payment.reference) changes.reference = { from: payment.reference, to: null };
          if (payment.note) changes.note = { from: payment.note, to: null };
          const rows: FinanceHistoryEntry[] = [{
            entityType: "payment", entityId: id, invoiceId: inv.id, jobId: after.jobId, action: "delete",
            summary: `${describeChange("payment", "delete", `${pesoExact(payment.amountCents)} on ${label}`)} (${payment.method})`, changes, actorName: ctx.actor,
          }];
          if (inv.status !== after.status) {
            const sc = { status: { from: inv.status, to: after.status } };
            rows.push({
              entityType: "invoice", entityId: inv.id, invoiceId: inv.id, jobId: after.jobId, action: "status",
              summary: describeChange("invoice", "status", label, sc), changes: sc, actorName: ctx.actor,
            });
          }
          return rows;
        },
      },
    };
  });
  return unwrap(res);
}

/* ------------------------------------------------------------------ delete invoice */

export async function deleteInvoiceOp(user: OpUser, id: string, confirmCode: string): Promise<OpResult> {
  const [exists] = await db.select({ id: serviceInvoices.id }).from(serviceInvoices).where(eq(serviceInvoices.id, id)).limit(1);
  if (!exists) return ok();
  const res = await lockedEdit(user, id, async (tx, inv, ctx) => {
    const label = ctx.label(inv);
    if (!confirmMatches(confirmCode ?? "", label)) throw new EditRejected("Type the invoice number exactly to confirm.");
    const [{ n: nPayments }] = await tx.select({ n: sql<number>`count(*)::int` }).from(servicePayments).where(eq(servicePayments.invoiceId, id));
    if (nPayments > 0 || inv.amountPaidCents > 0 || inv.status === "paid" || inv.status === "partial") {
      throw new EditRejected("This invoice has payments, so it can't be deleted. Void it instead — the payments stay on record.");
    }
    const [{ n: nItems }] = await tx.select({ n: sql<number>`count(*)::int` }).from(serviceInvoiceItems).where(eq(serviceInvoiceItems.invoiceId, id));
    await tx.delete(serviceInvoices).where(eq(serviceInvoices.id, id));
    return {
      value: undefined,
      plan: {
        required: false, reason: null,
        build: async () => {
          const changes: FinanceChanges = {
            status: { from: inv.status, to: null }, subtotalCents: { from: inv.subtotalCents, to: null },
            discountCents: { from: inv.discountCents, to: null }, taxCents: { from: inv.taxCents, to: null },
            totalCents: { from: inv.totalCents, to: null }, amountPaidCents: { from: inv.amountPaidCents, to: null },
            itemCount: { from: nItems, to: null }, paymentCount: { from: nPayments, to: null },
          };
          return [{
            entityType: "invoice", entityId: id, invoiceId: id, jobId: inv.jobId, action: "delete",
            summary: `${describeChange("invoice", "delete", label)} (total ${pesoExact(inv.totalCents)}, paid ${pesoExact(inv.amountPaidCents)}, ${nItems} lines, ${nPayments} payments)`,
            changes, actorName: ctx.actor,
          }];
        },
      },
    };
  });
  return unwrap(res);
}
