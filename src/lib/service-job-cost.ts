/**
 * Job cost basis - PURE. Decides which parts and expense amounts count toward a job's margin, so the job page and the
 * Finance per-job margin agree. No DB, no React.
 *
 * Rules (owner decision 2026-10-08):
 *  R1. A part line with no explicit cost costs 0 (see `lineCostCents`), not its selling price.
 *  R2. If a counted expense is a Materials/Parts purchase, the part-line cost is ignored: the expenses win, so the
 *      same purchase is never counted twice.
 *  F.  Only expenses of kind "job" (or not yet sorted: kind null, as before) count. Overhead / stock never do.
 */

export type CostBasisExpense = { amountCents: number; kind?: string | null; category?: string | null };

export type JobCostBasis = {
  /** Part-line cost to feed into jobMargin (0 when the expenses cover the parts). */
  partsCostCents: number;
  /** Sum of the counted expenses. */
  expenseCents: number;
  /** True when materials/parts expenses replaced the part-line cost. */
  partsFromExpenses: boolean;
};

export const countsInJobMargin = (e: { kind?: string | null }): boolean => e.kind == null || e.kind === "job";

export function jobCostBasis(input: { partLinesCostCents: number; expenses: CostBasisExpense[] }): JobCostBasis {
  const counted = input.expenses.filter(countsInJobMargin);
  const expenseCents = counted.reduce((s, e) => s + e.amountCents, 0);
  const partsFromExpenses = counted.some((e) => e.category === "materials" || e.category === "parts");
  return { partsCostCents: partsFromExpenses ? 0 : input.partLinesCostCents, expenseCents, partsFromExpenses };
}
