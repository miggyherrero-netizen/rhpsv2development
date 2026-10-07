/**
 * Writes one row to the finance history. Deliberately NOT a "use server" file: it can only be called by
 * other server code, never as an endpoint. BEST-EFFORT — it must never break the money action that called
 * it, so call it AFTER the main write succeeded and outside any transaction. If the table does not exist
 * yet (SQL not pasted, Postgres 42P01) or the insert fails, it logs and returns.
 * Insert-only: there is no update or delete path for history anywhere.
 */

import { db } from "@/db";
import { serviceFinanceHistory } from "@/db/schema";
import type { FinanceAction, FinanceChanges, FinanceEntityType } from "@/lib/service-finance-history";

export type FinanceHistoryEntry = {
  entityType: FinanceEntityType;
  entityId: string;
  action: FinanceAction;
  summary: string;
  changes?: FinanceChanges | null;
  invoiceId?: string | null;
  jobId?: string | null;
  reason?: string | null;
  actorName?: string | null;
};

export function pgErrorCode(e: unknown): string | undefined {
  const x = e as { code?: string; cause?: { code?: string } } | null;
  return x?.code ?? x?.cause?.code;
}

export async function recordFinanceHistory(entry: FinanceHistoryEntry | FinanceHistoryEntry[]): Promise<void> {
  const rows = Array.isArray(entry) ? entry : [entry];
  if (!rows.length) return;
  try {
    await db.insert(serviceFinanceHistory).values(rows.map((r) => ({
      entityType: r.entityType, entityId: r.entityId, action: r.action,
      summary: r.summary.slice(0, 500),
      changes: r.changes && Object.keys(r.changes).length ? r.changes : null,
      invoiceId: r.invoiceId ?? null, jobId: r.jobId ?? null,
      reason: r.reason ?? null, actorName: r.actorName ?? null,
    })));
  } catch (e) {
    if (pgErrorCode(e) === "42P01") console.error("[finance-history] table service_finance_history is missing — run drizzle/manual/09_finance_history.sql. History not recorded.");
    else console.error("[finance-history] could not record history:", e instanceof Error ? e.message : e);
  }
}
