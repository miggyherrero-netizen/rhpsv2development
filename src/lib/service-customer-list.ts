/** What one row of the customers list shows: area, next tuning due, and how urgent it is. Pure — no React, no DB. */

const DAY_MS = 86_400_000;

export type RowPiano = { nextServiceDueAt?: Date | string | null };
export type RowLocation = { area?: string | null; city?: string | null; addressLine?: string | null };

export type DueState = "none" | "overdue" | "soon" | "later";

export type CustomerRowSummary = {
  area: string | null;
  /** The earliest tuning due across this customer's pianos (null when none has one). */
  nextDueAt: Date | null;
  daysUntilDue: number | null;
  dueState: DueState;
};

/** Within this many days a due tuning is flagged as "soon". */
export const DUE_SOON_DAYS = 14;

/** First location's area or city; blank values are skipped so we never show an empty string. */
export function rowArea(locations: RowLocation[]): string | null {
  for (const l of locations) {
    const a = l.area?.trim() || l.city?.trim();
    if (a) return a;
  }
  return null;
}

export function nextDue(pianos: RowPiano[]): Date | null {
  let best: number | null = null;
  for (const p of pianos) {
    if (!p.nextServiceDueAt) continue;
    const t = new Date(p.nextServiceDueAt).getTime();
    if (!Number.isNaN(t) && (best === null || t < best)) best = t;
  }
  return best === null ? null : new Date(best);
}

export function dueState(daysUntilDue: number | null): DueState {
  if (daysUntilDue === null) return "none";
  if (daysUntilDue < 0) return "overdue";
  return daysUntilDue <= DUE_SOON_DAYS ? "soon" : "later";
}

export function customerRowSummary(
  c: { locations: RowLocation[]; pianos: RowPiano[] },
  now: Date,
): CustomerRowSummary {
  const nextDueAt = nextDue(c.pianos);
  const daysUntilDue = nextDueAt ? Math.round((nextDueAt.getTime() - now.getTime()) / DAY_MS) : null;
  return { area: rowArea(c.locations), nextDueAt, daysUntilDue, dueState: dueState(daysUntilDue) };
}

/** Phone number reduced to what a `tel:` link accepts (digits and a leading +); null when there is nothing dialable. */
export function telHref(phone: string | null | undefined): string | null {
  const digits = (phone ?? "").replace(/[^\d+]/g, "");
  return digits.replace(/\+/g, "").length >= 5 ? `tel:${digits}` : null;
}

/** Short label for the "Next due" cell. */
export function dueLabel(s: Pick<CustomerRowSummary, "daysUntilDue" | "dueState">): string {
  if (s.daysUntilDue === null) return "—";
  if (s.dueState === "overdue") return `${Math.abs(s.daysUntilDue)}d overdue`;
  if (s.daysUntilDue === 0) return "Due today";
  return s.dueState === "soon" ? `in ${s.daysUntilDue}d` : "";
}

/** Sort keys for the list. Customers without a due date go last for "Due soonest". */
export function dueSortKey(s: Pick<CustomerRowSummary, "nextDueAt">): number {
  return s.nextDueAt ? s.nextDueAt.getTime() : Number.POSITIVE_INFINITY;
}
