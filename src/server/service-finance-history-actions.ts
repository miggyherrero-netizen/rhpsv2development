"use server";

/** Tiny gated wrapper so a client component can load one expense's history on demand. Data only, no writes. */

import { getExpenseFinanceHistory, type FinanceHistoryResult } from "@/server/service-finance-history-data";

export async function loadExpenseHistory(expenseId: string): Promise<{ ok: true; data: FinanceHistoryResult } | { ok: false; error: string }> {
  if (typeof expenseId !== "string" || !expenseId) return { ok: false, error: "Missing expense." };
  const data = await getExpenseFinanceHistory(expenseId);
  return data ? { ok: true, data } : { ok: false, error: "Only the owner can see finance history." };
}
