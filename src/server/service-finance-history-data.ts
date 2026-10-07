/**
 * Finance history reads. Owner-only (same gate as the finance health check); NOT a "use server" file.
 * Tolerates the table not existing yet (SQL not pasted): returns an empty list with `tableMissing`.
 */

import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { serviceFinanceHistory } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { canViewFinance } from "@/lib/service-flow";
import type { FinanceAction, FinanceChanges, FinanceEntityType } from "@/lib/service-finance-history";
import { pgErrorCode } from "@/server/service-finance-history";

export type FinanceHistoryItem = {
  id: string;
  /** ISO instant. */
  at: string;
  entityType: FinanceEntityType;
  action: FinanceAction;
  summary: string;
  changes: FinanceChanges | null;
  reason: string | null;
  actorName: string | null;
};
export type FinanceHistoryResult = { items: FinanceHistoryItem[]; tableMissing: boolean };

async function load(where: ReturnType<typeof eq> | ReturnType<typeof and>): Promise<FinanceHistoryResult> {
  try {
    const rows = await db.select({
      id: serviceFinanceHistory.id, createdAt: serviceFinanceHistory.createdAt, entityType: serviceFinanceHistory.entityType,
      action: serviceFinanceHistory.action, summary: serviceFinanceHistory.summary, changes: serviceFinanceHistory.changes,
      reason: serviceFinanceHistory.reason, actorName: serviceFinanceHistory.actorName,
    }).from(serviceFinanceHistory).where(where).orderBy(desc(serviceFinanceHistory.createdAt)).limit(200);
    return {
      tableMissing: false,
      items: rows.map((r) => ({
        id: r.id, at: r.createdAt.toISOString(), entityType: r.entityType, action: r.action,
        summary: r.summary, changes: r.changes ?? null, reason: r.reason, actorName: r.actorName,
      })),
    };
  } catch (e) {
    if (pgErrorCode(e) === "42P01") return { items: [], tableMissing: true };
    throw e;
  }
}

/** History of an invoice, its lines and its payments. Null when the user may not see finance. */
export async function getInvoiceFinanceHistory(invoiceId: string): Promise<FinanceHistoryResult | null> {
  const user = await requireUser();
  if (!canViewFinance(user)) return null;
  return load(eq(serviceFinanceHistory.invoiceId, invoiceId));
}

/** History of one expense. Null when the user may not see finance. */
export async function getExpenseFinanceHistory(expenseId: string): Promise<FinanceHistoryResult | null> {
  const user = await requireUser();
  if (!canViewFinance(user)) return null;
  return load(and(eq(serviceFinanceHistory.entityType, "expense"), eq(serviceFinanceHistory.entityId, expenseId)));
}
