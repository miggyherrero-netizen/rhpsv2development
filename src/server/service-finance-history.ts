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
import { EditRejected, historyRowOf } from "@/lib/service-finance-edit";
import type { Tx } from "@/server/service-invoice-core";

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
    await db.insert(serviceFinanceHistory).values(rows.map(historyRowOf));
  } catch (e) {
    if (pgErrorCode(e) === "42P01") console.error("[finance-history] table service_finance_history is missing — run drizzle/manual/09_finance_history.sql. History not recorded.");
    else console.error("[finance-history] could not record history:", e instanceof Error ? e.message : e);
  }
}

/**
 * STRICT variant for edits of paid / part-paid records. Runs on the caller's transaction and THROWS, so a
 * failure (including a missing table) rolls back the money edit it belongs to: no change is ever saved
 * without its history row. Never swallows errors.
 */
export async function recordFinanceHistoryStrict(tx: Tx, entry: FinanceHistoryEntry | FinanceHistoryEntry[]): Promise<void> {
  const rows = Array.isArray(entry) ? entry : [entry];
  if (!rows.length) return;
  try {
    // A savepoint keeps the outer transaction usable long enough to report a clear message.
    await tx.transaction(async (sp) => {
      await sp.insert(serviceFinanceHistory).values(rows.map(historyRowOf));
    });
  } catch (e) {
    if (pgErrorCode(e) === "42P01") {
      throw new EditRejected("The change history is not switched on yet, so this edit was not saved. Ask your developer to run drizzle/manual/09_finance_history.sql.");
    }
    console.error("[finance-history] strict write failed, edit rolled back:", e instanceof Error ? e.message : e);
    throw new EditRejected("Could not record the change history, so the edit was not saved. Nothing was changed. Try again.");
  }
}
