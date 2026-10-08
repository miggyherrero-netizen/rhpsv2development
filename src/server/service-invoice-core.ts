/**
 * Shared invoice money core. NOT a "use server" file (it exports helpers, never endpoints).
 *
 * Every write that changes an invoice's lines, payments, discount, tax or status goes through
 * `withInvoiceLock`, which opens ONE transaction and locks the invoice row (SELECT ... FOR UPDATE).
 * That gives a single lock order everywhere (invoice row first, then its job), so two edits of the same
 * invoice queue up instead of overwriting each other, and `recalcInvoice` always sees committed data.
 */

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { pianos, serviceCustomers, serviceInvoiceItems, serviceInvoices, serviceJobs, servicePayments } from "@/db/schema";
import { jobCode } from "@/lib/service";
import type { FinanceChanges } from "@/lib/service-finance-history";
import {
  AMOUNT_TOO_LARGE, EditRejected, computeInvoiceState, isNumericOverflow, jobStatusAfterInvoice, overpayError, type InvoiceState,
} from "@/lib/service-finance-edit";

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
/** Anything that can run a select: the shared pool or an open transaction. */
export type Ex = Tx | typeof db;
export type InvoiceRow = typeof serviceInvoices.$inferSelect;

export type LockResult<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * Runs `fn` inside a transaction holding a lock on the invoice row. `invoice` is the freshly locked row
 * (null when it does not exist). Throw `EditRejected` to roll back and refuse; any other error rolls back
 * and propagates.
 */
export async function withInvoiceLock<T>(
  invoiceId: string,
  fn: (tx: Tx, invoice: InvoiceRow | null) => Promise<T>,
): Promise<LockResult<T>> {
  try {
    const value = await db.transaction(async (tx) => {
      const [invoice] = await tx.select().from(serviceInvoices).where(eq(serviceInvoices.id, invoiceId)).for("update").limit(1);
      return fn(tx, invoice ?? null);
    });
    return { ok: true, value };
  } catch (e) {
    if (e instanceof EditRejected) return { ok: false, error: e.message };
    if (isNumericOverflow(e)) return { ok: false, error: AMOUNT_TOO_LARGE };
    throw e;
  }
}

export type RecalcResult = { before: InvoiceRow; after: InvoiceRow; state: InvoiceState };

/**
 * Recomputes an invoice's totals, paid amount, status and paidAt from its lines and payments, and keeps the
 * linked job in step. ALL reads and writes go through `tx`. The arithmetic and status rules live in the pure
 * `computeInvoiceState`. Call it from inside `withInvoiceLock` after the edit's own writes.
 */
export async function recalcInvoice(tx: Tx, invoiceId: string): Promise<RecalcResult | null> {
  const [before] = await tx.select().from(serviceInvoices).where(eq(serviceInvoices.id, invoiceId)).limit(1);
  if (!before) return null;
  const items = await tx.select().from(serviceInvoiceItems).where(eq(serviceInvoiceItems.invoiceId, invoiceId));
  const payments = await tx.select().from(servicePayments).where(eq(servicePayments.invoiceId, invoiceId));
  const state = computeInvoiceState({
    items, payments,
    discountCents: before.discountCents, taxRateBps: before.taxRateBps,
    sentAt: before.sentAt, voidedAt: before.voidedAt, previousPaidAt: before.paidAt,
  });
  const [after] = await tx.update(serviceInvoices).set({
    subtotalCents: state.subtotalCents, taxCents: state.taxCents, totalCents: state.totalCents,
    amountPaidCents: state.amountPaidCents, status: state.status, paidAt: state.paidAt, updatedAt: new Date(),
  }).where(eq(serviceInvoices.id, invoiceId)).returning();

  // Keep the linked job's status in step with its money (invoiced <-> paid only).
  if (before.jobId) {
    const [job] = await tx.select({ id: serviceJobs.id, status: serviceJobs.status }).from(serviceJobs).where(eq(serviceJobs.id, before.jobId)).limit(1);
    if (job) {
      const next = jobStatusAfterInvoice({ jobStatus: job.status, invoiceStatus: state.status, previousInvoiceStatus: before.status });
      if (next !== job.status) {
        // Conditional on the status we read: if someone changed the job meanwhile (cancelled, on hold...) we leave it alone.
        await tx.update(serviceJobs).set({ status: next as typeof job.status, updatedAt: new Date() })
          .where(and(eq(serviceJobs.id, job.id), eq(serviceJobs.status, job.status)));
      }
    }
  }
  return { before, after: after!, state };
}

/** Throws EditRejected when the recalculated invoice would show payments above its total. */
export function assertNotOverpaid(r: RecalcResult): void {
  const msg = overpayError(
    { totalCents: r.before.totalCents, paidCents: r.before.amountPaidCents },
    { totalCents: r.state.totalCents, paidCents: r.state.amountPaidCents },
  );
  if (msg) throw new EditRejected(msg);
}

/* ---- Finance history helpers shared by the invoice ops and the other finance actions ---- */

/** Runs a best-effort history write; any error (missing table, lookup failure) is logged and swallowed. */
export async function safeHistory(fn: () => Promise<void>): Promise<void> {
  try { await fn(); } catch (e) { console.error("[finance-history] skipped:", e instanceof Error ? e.message : e); }
}
export const actorOf = (user: { name?: string | null }) => user.name || "Owner";

/** Swaps customer / job / piano ids in a diff for readable names (falls back to the raw id). */
export async function nameRefs(changes: FinanceChanges, ex: Ex = db): Promise<FinanceChanges> {
  const name = async (key: string, id: unknown): Promise<unknown> => {
    if (typeof id !== "string") return id;
    if (key === "customerId") {
      const [r] = await ex.select({ n: serviceCustomers.name }).from(serviceCustomers).where(eq(serviceCustomers.id, id)).limit(1);
      return r?.n ?? id;
    }
    if (key === "jobId") {
      const [r] = await ex.select({ n: serviceJobs.jobNumber, t: serviceJobs.title, d: serviceJobs.createdAt }).from(serviceJobs).where(eq(serviceJobs.id, id)).limit(1);
      return r ? `${jobCode("WO", r.n, r.d)} ${r.t}` : id;
    }
    if (key === "pianoId") {
      const [r] = await ex.select({ b: pianos.brand, m: pianos.model }).from(pianos).where(eq(pianos.id, id)).limit(1);
      return r ? `${r.b} ${r.m}` : id;
    }
    return id;
  };
  const out: FinanceChanges = {};
  for (const [k, c] of Object.entries(changes)) {
    out[k] = ["customerId", "jobId", "pianoId"].includes(k) ? { from: await name(k, c.from), to: await name(k, c.to) } : c;
  }
  return out;
}
