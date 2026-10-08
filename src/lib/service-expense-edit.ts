/**
 * Pure helpers for editing an existing service expense: row -> form prefill, form -> update patch.
 * Kept free of React / server imports so they can be unit-tested.
 */

export type ExpenseEditValues = {
  category: string; description: string; amount: number; spentAt: string | null; vendor: string;
  method: string; reimbursable: boolean; jobId: string | null; receiptUrl: string | null;
  kind: string; pianoId: string | null;
};

export type ExpenseEditSource = {
  id: string; category: string; description: string; amountCents: number; spentAt: Date | string;
  vendor: string | null; method: string; reimbursable: boolean; jobId: string | null;
  kind: string | null; pianoId: string | null;
};

/** Form prefill for an existing expense. `spentAt` stays an ISO string; the form converts it to Manila local time. */
export function expenseToFormInitial(row: ExpenseEditSource): Partial<ExpenseEditValues> & { id: string } {
  return {
    id: row.id,
    category: row.category,
    description: row.description,
    amount: row.amountCents / 100,
    spentAt: new Date(row.spentAt).toISOString(),
    vendor: row.vendor ?? "",
    method: row.method,
    reimbursable: row.reimbursable,
    jobId: row.jobId,
    kind: row.kind ?? undefined,
    pianoId: row.pianoId,
  };
}

export type ExpenseUpdatePatch = Omit<ExpenseEditValues, "receiptUrl"> & { receiptUrl?: string };

/**
 * Form values -> update patch. `receiptUrl` is only included when a NEW photo was picked, so saving
 * never wipes a receipt that is already stored. `jobId: null` is kept on purpose: it clears the link.
 */
export function buildExpensePatch(values: ExpenseEditValues): ExpenseUpdatePatch {
  const { receiptUrl, ...rest } = values;
  return receiptUrl ? { ...rest, receiptUrl } : rest;
}

/**
 * Picking a job for an expense that had none: the kind becomes "Job cost" (null = follow the job) unless the owner
 * chose "stock". An old "Overhead" fuel/meals/materials row therefore counts in the job margin once it is linked.
 */
export const kindAfterJobLink = (prevJobId: string, nextJobId: string, kindPicked: string | null): string | null =>
  !prevJobId && nextJobId && kindPicked !== "stock" ? null : kindPicked;
