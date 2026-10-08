/**
 * Pure calculations for the Home Service Dashboard: month series, month-over-month change,
 * the prioritised "needs attention" queue, crew status and the job pipeline. No DB, no React.
 * Money is centavos; all month boundaries are Asia/Manila (UTC+8).
 */
import { countable, type FinInvoice, type FinPayment, type FinExpense } from "@/lib/service-reports";

const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/* ------------------------------------------------------------------ months */

export type MonthSlot = { key: string; label: string; from: Date; to: Date };

const manilaYM = (d: Date) => {
  const s = new Date(d.getTime() + MANILA_OFFSET_MS);
  return { y: s.getUTCFullYear(), m: s.getUTCMonth() };
};
const manilaMonthStart = (y: number, m: number) => new Date(Date.UTC(y, m, 1) - MANILA_OFFSET_MS);

/** The last `n` Manila calendar months ending with the month of `now`, oldest first. */
export function lastMonths(now: Date, n = 6): MonthSlot[] {
  const cur = manilaYM(now);
  const slots: MonthSlot[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const idx = cur.y * 12 + cur.m - i;
    const y = Math.floor(idx / 12);
    const m = ((idx % 12) + 12) % 12;
    slots.push({
      key: `${y}-${String(m + 1).padStart(2, "0")}`,
      label: `${MONTHS[m]} ${String(y).slice(2)}`,
      from: manilaMonthStart(y, m),
      to: manilaMonthStart(m === 11 ? y + 1 : y, (m + 1) % 12),
    });
  }
  return slots;
}

export type DashboardMonth = { key: string; label: string; invoicedCents: number; collectedCents: number; expenseCents: number };

/**
 * Month buckets with the same rules as the Finance page: invoiced = countable invoices by issue date,
 * collected = payments by received date, spent = the expenses passed in (callers drop unsold stock).
 */
export function buildMonthSeries(
  input: { invoices: FinInvoice[]; payments: FinPayment[]; expenses: FinExpense[] },
  now: Date,
  n = 6,
): DashboardMonth[] {
  const slots = lastMonths(now, n);
  const rows: DashboardMonth[] = slots.map((s) => ({ key: s.key, label: s.label, invoicedCents: 0, collectedCents: 0, expenseCents: 0 }));
  const slotOf = (at: Date | string) => {
    const t = new Date(at).getTime();
    return slots.findIndex((s) => t >= s.from.getTime() && t < s.to.getTime());
  };
  for (const i of countable(input.invoices, now)) {
    const k = slotOf(i.issueDate);
    if (k >= 0) rows[k]!.invoicedCents += i.totalCents ?? 0;
  }
  for (const p of input.payments) {
    const k = slotOf(p.receivedAt);
    if (k >= 0) rows[k]!.collectedCents += p.amountCents;
  }
  for (const e of input.expenses) {
    const k = slotOf(e.spentAt);
    if (k >= 0) rows[k]!.expenseCents += e.amountCents;
  }
  return rows;
}

/* ------------------------------------------------------------------ change */

export type Delta = {
  direction: "up" | "down" | "flat" | "none";
  /** Whole percent, absolute. Null when there is no earlier figure to compare with. */
  pct: number | null;
  /** Plain text that stands on its own (never colour alone). */
  text: string;
};

/** Change from `previous` to `current`; `none` when last period had nothing to compare. */
export function deltaOf(current: number, previous: number, periodLabel = "last month"): Delta {
  if (previous <= 0) {
    return { direction: "none", pct: null, text: `Nothing to compare with ${periodLabel}` };
  }
  const pct = Math.round(((current - previous) / previous) * 100);
  if (pct === 0) return { direction: "flat", pct: 0, text: `Same as ${periodLabel}` };
  return pct > 0
    ? { direction: "up", pct, text: `Up ${pct}% on ${periodLabel}` }
    : { direction: "down", pct: Math.abs(pct), text: `Down ${Math.abs(pct)}% on ${periodLabel}` };
}

/* ------------------------------------------------- like-for-like (this month so far) */

export const INVOICE_KINDS = ["service", "sale"] as const;
export type InvoiceKind = (typeof INVOICE_KINDS)[number];
/** Only 'service' and 'sale' may be saved on an invoice. */
export const isInvoiceKind = (v: unknown): v is InvoiceKind => v === "service" || v === "sale";

export type LikeForLikeRange = {
  current: { from: Date; to: Date };
  previous: { from: Date; to: Date };
  /** e.g. "Oct 1–8" */
  label: string;
  /** e.g. "Sep 1–8" */
  previousLabel: string;
};

const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
const spanLabel = (m: number, endDay: number) => (endDay <= 1 ? `${MONTHS[m]} 1` : `${MONTHS[m]} 1–${endDay}`);

/**
 * This Manila month so far (1st .. end of today) against the same day-span of the previous month,
 * clamped to that month's length (Mar 31 -> Feb 1-28/29). `to` is exclusive.
 */
export function likeForLikeRange(now: Date): LikeForLikeRange {
  const { y, m } = manilaYM(now);
  const day = new Date(now.getTime() + MANILA_OFFSET_MS).getUTCDate();
  const py = m === 0 ? y - 1 : y;
  const pm = m === 0 ? 11 : m - 1;
  const prevEnd = Math.min(day, daysInMonth(py, pm));
  const prevFrom = manilaMonthStart(py, pm);
  return {
    current: { from: manilaMonthStart(y, m), to: new Date(manilaMonthStart(y, m).getTime() + day * 86_400_000) },
    previous: { from: prevFrom, to: new Date(prevFrom.getTime() + prevEnd * 86_400_000) },
    label: spanLabel(m, day),
    previousLabel: spanLabel(pm, prevEnd),
  };
}

export type PeriodDelta = {
  direction: "up" | "down" | "flat" | "new";
  /** Whole percent, absolute. Null for "new" (nothing before to divide by). */
  pct: number | null;
  /** Stands on its own, e.g. "Up 12% vs Sep 1–8", "New". */
  text: string;
};

/** Change between two periods. Never divides by zero: from nothing to something is "New". */
export function periodDelta(current: number, previous: number, periodLabel?: string): PeriodDelta {
  const vs = periodLabel ? ` vs ${periodLabel}` : "";
  if (previous <= 0) {
    return current > 0
      ? { direction: "new", pct: null, text: "New" }
      : { direction: "flat", pct: 0, text: periodLabel ? `Same as ${periodLabel}` : "Same" };
  }
  const pct = Math.round(((current - previous) / previous) * 100);
  if (pct === 0) return { direction: "flat", pct: 0, text: periodLabel ? `Same as ${periodLabel}` : "Same" };
  return pct > 0
    ? { direction: "up", pct, text: `Up ${pct}%${vs}` }
    : { direction: "down", pct: Math.abs(pct), text: `Down ${Math.abs(pct)}%${vs}` };
}

export type KindInvoice = FinInvoice & { totalCents: number; kind: string };
export type KindSplit = { currentCents: number; previousCents: number; delta: PeriodDelta };
export type InvoicedByKind = {
  service: KindSplit;
  sales: KindSplit;
  totalCents: number;
  previousTotalCents: number;
  rangeLabel: string;
  previousLabel: string;
};

/**
 * Invoiced so far this month vs the same days last month, split into service and piano sales.
 * Same rule as the Finance page: countable() (no void, no draft) by issue date. Unknown kinds count as service.
 */
export function invoicedByKind(invoices: KindInvoice[], now: Date): InvoicedByKind {
  const r = likeForLikeRange(now);
  const sum = { service: [0, 0], sales: [0, 0] };
  for (const i of countable(invoices, now)) {
    const t = new Date(i.issueDate).getTime();
    const bucket = i.kind === "sale" ? sum.sales : sum.service;
    if (t >= r.current.from.getTime() && t < r.current.to.getTime()) bucket[0] += i.totalCents ?? 0;
    else if (t >= r.previous.from.getTime() && t < r.previous.to.getTime()) bucket[1] += i.totalCents ?? 0;
  }
  const split = ([c, p]: number[]): KindSplit => ({ currentCents: c!, previousCents: p!, delta: periodDelta(c!, p!, r.previousLabel) });
  return {
    service: split(sum.service),
    sales: split(sum.sales),
    totalCents: sum.service[0]! + sum.sales[0]!,
    previousTotalCents: sum.service[1]! + sum.sales[1]!,
    rangeLabel: r.label,
    previousLabel: r.previousLabel,
  };
}

/** Profit ÷ money in, whole percent; null when nothing came in (no margin to show). */
export function marginPct(profitCents: number, revenueCents: number): number | null {
  return revenueCents > 0 ? Math.round((profitCents / revenueCents) * 100) : null;
}

/* --------------------------------------------------------------- attention */

export type AttentionSeverity = "danger" | "warn" | "info";
export type AttentionItem = {
  key: string;
  label: string;
  count: number;
  severity: AttentionSeverity;
  href: string;
  /** Shown beside the count when the item is money. */
  amountCents?: number;
  /** Short extra line, e.g. "2 errors, 1 warning". */
  detail?: string;
};

export type AttentionInput = {
  /** `amountCents` is left out when the viewer may not see money. */
  overdueInvoices: { count: number; amountCents?: number };
  drafts: { count: number; amountCents?: number };
  closeOut: number;
  remindersDue: number;
  recallsDue: number;
  staleQuotes: number;
  waitlistFollowUps: number;
  /** null = finance not visible to this user. */
  unreviewedExpenses: number | null;
  /** null = finance not visible to this user. */
  health: { errors: number; warnings: number } | null;
};

const SEVERITY_RANK: Record<AttentionSeverity, number> = { danger: 0, warn: 1, info: 2 };

/** One prioritised list: danger first, then warnings, then reminders-to-self. Zero-count items are dropped. */
export function attentionQueue(i: AttentionInput): AttentionItem[] {
  const items: AttentionItem[] = [
    { key: "overdue", label: "Overdue invoices", count: i.overdueInvoices.count, severity: "danger", href: "/service/invoices?filter=overdue", amountCents: i.overdueInvoices.amountCents },
    { key: "health_errors", label: "Finance errors to fix", count: i.health?.errors ?? 0, severity: "danger", href: "/service/finance/health" },
    { key: "close_out", label: "Past visits to close out", count: i.closeOut, severity: "warn", href: "/service/jobs?filter=scheduled" },
    { key: "reminders", label: "Reminders due", count: i.remindersDue, severity: "warn", href: "/service/reminders" },
    { key: "drafts", label: "Draft invoices to send", count: i.drafts.count, severity: "warn", href: "/service/invoices?filter=draft", amountCents: i.drafts.amountCents },
    { key: "waitlist", label: "Waitlist follow-ups", count: i.waitlistFollowUps, severity: "warn", href: "/service/waitlist" },
    { key: "quotes", label: "Quotes with no answer", count: i.staleQuotes, severity: "info", href: "/service/jobs?filter=quoted" },
    { key: "recalls", label: "Recalls due", count: i.recallsDue, severity: "info", href: "/service/customers" },
    { key: "expenses", label: "Expenses to review", count: i.unreviewedExpenses ?? 0, severity: "info", href: "/service/expenses/review" },
    { key: "health_warnings", label: "Finance warnings", count: i.health?.warnings ?? 0, severity: "info", href: "/service/finance/health" },
  ];
  return items
    .map((it, idx) => ({ it, idx }))
    .filter(({ it }) => it.count > 0)
    .sort((a, b) => SEVERITY_RANK[a.it.severity] - SEVERITY_RANK[b.it.severity] || a.idx - b.idx)
    .map(({ it }) => it);
}

/* -------------------------------------------------------------------- crew */

export type CrewJob = {
  id: string;
  title: string;
  status: string;
  scheduledStart: Date | string | null;
  technicianId: string | null;
  customerName: string;
  area: string | null;
};
export type CrewTech = { id: string; name: string; color: string | null };
export type CrewStatus = {
  technicianId: string | null;
  name: string;
  color: string | null;
  total: number;
  done: number;
  /** What they are doing right now, in plain words. */
  state: "on_site" | "en_route" | "next" | "done" | "idle";
  stateLabel: string;
  jobId: string | null;
  place: string | null;
};

const DONE = ["completed", "invoiced", "paid"];

/** Per technician: where they are (on site / en route), else their next visit, else finished or no visits. */
export function crewStatus(jobs: CrewJob[], techs: CrewTech[]): CrewStatus[] {
  const live = jobs.filter((j) => j.status !== "cancelled");
  const ids = [...techs.map((t) => t.id), ...(live.some((j) => !j.technicianId) ? [null] : [])];
  const byStart = (a: CrewJob, b: CrewJob) =>
    (a.scheduledStart ? +new Date(a.scheduledStart) : Infinity) - (b.scheduledStart ? +new Date(b.scheduledStart) : Infinity);
  const out = ids.map((id): CrewStatus => {
    const t = techs.find((x) => x.id === id);
    const mine = live.filter((j) => (j.technicianId ?? null) === id).sort(byStart);
    const done = mine.filter((j) => DONE.includes(j.status)).length;
    const onSite = mine.find((j) => j.status === "in_progress");
    const route = mine.find((j) => j.status === "en_route");
    const next = mine.find((j) => !DONE.includes(j.status) && !["in_progress", "en_route"].includes(j.status));
    const place = (j: CrewJob | undefined) => (j ? j.area ?? j.customerName : null);
    const base = { technicianId: id, name: t?.name ?? "Unassigned", color: t?.color ?? null, total: mine.length, done };
    if (onSite) return { ...base, state: "on_site", stateLabel: "On site", jobId: onSite.id, place: place(onSite) };
    if (route) return { ...base, state: "en_route", stateLabel: "En route", jobId: route.id, place: place(route) };
    if (next) return { ...base, state: "next", stateLabel: "Next", jobId: next.id, place: place(next) };
    if (mine.length > 0) return { ...base, state: "done", stateLabel: "Done for today", jobId: null, place: null };
    return { ...base, state: "idle", stateLabel: "No visits today", jobId: null, place: null };
  });
  // Unassigned only matters when it has visits; technicians with nothing today go last.
  return out.sort((a, b) => Number(a.state === "idle") - Number(b.state === "idle"));
}

/* ---------------------------------------------------------------- pipeline */

export const PIPELINE_STATUSES = ["lead", "quoted", "scheduled", "en_route", "in_progress", "on_hold"] as const;

/** Counts per open status in a fixed order (zeros kept so the bars line up from day to day). */
export function pipelineCounts(rows: { status: string; count: number }[]): { status: string; count: number }[] {
  return PIPELINE_STATUSES.map((status) => ({ status, count: rows.filter((r) => r.status === status).reduce((s, r) => s + r.count, 0) }));
}

/** Bar width as a share of the largest value; 0 stays 0 and any non-zero value stays visible. */
export function barPct(value: number, max: number): number {
  if (max <= 0 || value <= 0) return 0;
  return Math.max(3, Math.round((value / max) * 100));
}
