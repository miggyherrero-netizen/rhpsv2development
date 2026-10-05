/**
 * Expense kinds and the Service / Piano sales / Overhead profit split. Pure maths — no DB, no React.
 *
 *   job       a cost of doing home-service work (fuel, parts, meals…): reduces Service profit.
 *   overhead  running the business (rent, marketing…): shown on its own, never inside a line's profit.
 *   stock     money tied up in a piano you intend to sell: NOT a cost until that piano is sold, then it becomes
 *             cost of goods in Piano sales profit.
 */

export const EXPENSE_KINDS = [
  { key: "job", label: "Job cost", hint: "Fuel, parts, meals — part of doing home-service work" },
  { key: "stock", label: "Piano stock", hint: "Bought for a piano you'll sell — counts only once it's sold" },
  { key: "overhead", label: "Overhead", hint: "Rent, marketing — running the business" },
] as const;
export type ExpenseKind = (typeof EXPENSE_KINDS)[number]["key"];
export const EXPENSE_KIND_LABEL: Record<string, string> = Object.fromEntries(EXPENSE_KINDS.map((k) => [k.key, k.label]));
export const isExpenseKind = (v: unknown): v is ExpenseKind => v === "job" || v === "stock" || v === "overhead";

/** Suggested kind for a category; the owner can always change it. */
export function defaultKindForCategory(category: string | null | undefined): ExpenseKind {
  switch (category) {
    case "fuel": case "transport": case "meals": case "materials": case "parts": case "subcontractor":
      return "job";
    case "marketing": case "rent": case "tools": case "other":
    default:
      return "overhead";
  }
}

/** A saved kind wins; an unreviewed expense linked to a job is a job cost; otherwise its category's default. */
export const effectiveKind = (e: { kind?: string | null; category: string; jobId?: string | null }): ExpenseKind =>
  isExpenseKind(e.kind) ? e.kind : e.jobId ? "job" : defaultKindForCategory(e.category);

export type SplitExpense = { amountCents: number; category: string; kind?: string | null; pianoId?: string | null; jobId?: string | null };

/** One sold piano inside the period. `stockExpensesCents` = stock expenses recorded against that piano (any date). */
export type SaleLine = {
  pianoId: string | null;
  salePriceCents: number;
  buyCostCents: number;
  prepCostCents: number;
  stockExpensesCents: number;
};

/**
 * Cost of goods for one sold piano: buy cost + prep costs, but never less than the stock expenses on record.
 * Stock expenses often already include the purchase AND its restoration, so the two are compared as a whole
 * (adding prep on top of the stock total would count the restoration twice).
 */
export const costOfGoodsCents = (s: SaleLine): number => Math.max(s.buyCostCents + s.prepCostCents, s.stockExpensesCents);

export type FinanceSplit = {
  service: { collectedCents: number; jobCostCents: number; profitCents: number };
  sales: { count: number; revenueCents: number; costOfGoodsCents: number; profitCents: number };
  overhead: { cents: number };
  /** Stock expenses for pianos not sold yet — money out, but not in any profit figure. */
  stockOnHandCents: number;
  /** Service + Piano sales − Overhead. */
  netCents: number;
};

export function financeSplit(input: {
  /** Money received on home-service work in the period (sale-job payments are not service income). */
  serviceCollectedCents: number;
  /** Expenses dated inside the period. Stock-kind ones are ignored here (they only count through a sale). */
  periodExpenses: SplitExpense[];
  /** Sale jobs closed in the period. */
  sales: SaleLine[];
  /** Every stock expense ever recorded (any date), for "stock on hand". */
  allStockExpenses: { pianoId: string | null; amountCents: number }[];
  /** Pianos that have a sale job at all (any date): their stock is accounted for by that sale, not "on hand". */
  pianosWithSale: Set<string>;
}): FinanceSplit {
  let jobCostCents = 0;
  let overheadCents = 0;
  for (const e of input.periodExpenses) {
    const kind = effectiveKind(e);
    if (kind === "job") jobCostCents += e.amountCents;
    else if (kind === "overhead") overheadCents += e.amountCents;
  }
  const revenueCents = input.sales.reduce((s, x) => s + x.salePriceCents, 0);
  const cogs = input.sales.reduce((s, x) => s + costOfGoodsCents(x), 0);
  const stockOnHandCents = input.allStockExpenses
    .filter((e) => !e.pianoId || !input.pianosWithSale.has(e.pianoId))
    .reduce((s, e) => s + e.amountCents, 0);
  const serviceProfit = input.serviceCollectedCents - jobCostCents;
  const salesProfit = revenueCents - cogs;
  return {
    service: { collectedCents: input.serviceCollectedCents, jobCostCents, profitCents: serviceProfit },
    sales: { count: input.sales.length, revenueCents, costOfGoodsCents: cogs, profitCents: salesProfit },
    overhead: { cents: overheadCents },
    stockOnHandCents,
    netCents: serviceProfit + salesProfit - overheadCents,
  };
}

/** Expenses still waiting for the one-time review (no kind saved yet). */
export const needsKindReview = (e: { kind?: string | null }): boolean => !isExpenseKind(e.kind);
