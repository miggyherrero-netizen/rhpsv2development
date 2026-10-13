/**
 * Piano sale jobs and recalls. Pure maths — no DB, no React.
 *
 * A sale job sells a showroom piano: price, deposit already received, the piano's buy cost and any prep
 * (restoration / delivery) costs. Profit per piano is price − cost of goods. The balance is collected at delivery,
 * so completing the sale settles it.
 */
import { costOfGoodsCents } from "@/lib/service-finance-split";

export type SaleFigures = {
  salePriceCents: number;
  depositCents: number;
  buyCostCents: number;
  prepCostCents: number;
  /** Stock expenses recorded against this piano (any date). */
  stockExpensesCents: number;
};

/** Still to collect at delivery. Zero once the sale is completed (the balance is taken on the day). */
export function saleBalanceCents(f: Pick<SaleFigures, "salePriceCents" | "depositCents">, completed: boolean): number {
  if (completed) return 0;
  return Math.max(0, f.salePriceCents - f.depositCents);
}

export function salePianoProfit(f: SaleFigures): { revenueCents: number; costOfGoodsCents: number; profitCents: number; marginPct: number } {
  const cogs = costOfGoodsCents({ pianoId: null, salePriceCents: f.salePriceCents, buyCostCents: f.buyCostCents, prepCostCents: f.prepCostCents, stockExpensesCents: f.stockExpensesCents });
  const profit = f.salePriceCents - cogs;
  return { revenueCents: f.salePriceCents, costOfGoodsCents: cogs, profitCents: profit, marginPct: f.salePriceCents > 0 ? Math.round((profit / f.salePriceCents) * 100) : 0 };
}

/** What the buy-cost box starts with: whatever has been recorded as stock for that piano. */
export const suggestedBuyCostCents = (stockExpensesCents: number): number => Math.max(0, stockExpensesCents);

/** A sale can only be completed once it has a piano and a price. */
export function saleReadyToComplete(f: { salePianoId: string | null; salePriceCents: number }): string | null {
  if (!f.salePianoId) return "Choose the piano being sold first.";
  if (f.salePriceCents <= 0) return "Enter the sale price first.";
  return null;
}

/* -------------------------------------------------------------- recalls */

/** Only a tuning visit moves a piano's recall date; a repair or an assessment doesn't mean it was tuned. */
export const TUNING_SERVICE_TYPES = ["tuning", "maintenance"] as const;
export const countsAsTuning = (serviceType: string): boolean => (TUNING_SERVICE_TYPES as readonly string[]).includes(serviceType);

/** Last tuning date + the piano's interval (calendar months, UTC). Null when it has never been tuned. */
export function recallDueDate(lastTunedAt: Date | null | undefined, intervalMonths: number): Date | null {
  if (!lastTunedAt) return null;
  const next = new Date(lastTunedAt);
  const months = Math.max(1, Math.round(intervalMonths || 6));
  const day = next.getUTCDate();
  next.setUTCDate(1);
  next.setUTCMonth(next.getUTCMonth() + months);
  // Jan 31 + 1 month = Feb 28/29, not Mar 3.
  const lastDay = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
  next.setUTCDate(Math.min(day, lastDay));
  return next;
}

/** A job needs a piano chosen unless it is a trip/batch placeholder customer or a piano sale (which names its own piano). */
export function pianoRequired(job: { jobType: string; customerIsBatch: boolean }): boolean {
  return job.jobType === "service" && !job.customerIsBatch;
}

/**
 * Which date a payment stamps as the piano's "last serviced" date. Only a FINISHED job is ever stamped (the caller checks):
 * its completion date, else its visit date, else, for the very first payment only, the payment date. Never later than `now`.
 */
export function pickServedAt(f: {
  completedAt: Date | null; scheduledStart: Date | null; paidAt: Date; firstPayment: boolean; now: Date;
}): Date | null {
  const picked = f.completedAt ?? f.scheduledStart ?? (f.firstPayment ? f.paidAt : null);
  if (!picked) return null;
  return picked.getTime() > f.now.getTime() ? f.now : picked;
}

/** A payment only dates a service on a job that is actually finished (completed, not cancelled). */
export const jobIsFinished = (j: { completedAt: Date | null; status: string; cancelledAt?: Date | null }): boolean =>
  !j.cancelledAt && j.status !== "cancelled" && (!!j.completedAt || j.status === "completed");

/** The service date only ever moves forward: an equal or older date leaves the piano alone. */
export const isNewerServiceDate = (current: Date | null | undefined, candidate: Date): boolean =>
  !current || candidate.getTime() > current.getTime();
