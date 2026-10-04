/**
 * Home-service domain logic — pure, dependency-light, safe to import from both
 * Server Components and client components (no database or Node-only APIs here).
 *
 * Money convention: every amount is an **integer number of centavos**, matching the
 * rest of the app (`peso()` in `src/lib/format.ts`). Time is minutes unless stated.
 */

import { dayDiff } from "@/lib/dates";

/** Dispatch-board working hours: weekday index (0=Sun) → [startMinute, endMinute] or null. */
export type WorkingHours = Record<number, [number, number] | null>;

export const DEFAULT_WORKING_HOURS: WorkingHours = {
  0: null,
  1: [480, 1080],
  2: [480, 1080],
  3: [480, 1080],
  4: [480, 1080],
  5: [480, 1080],
  6: [540, 840],
};

/* ============================================================
 * Enums
 * ============================================================ */

export const SERVICE_TYPES = [
  { key: "tuning", label: "Tuning", minutes: 90 },
  { key: "repair", label: "Repair", minutes: 120 },
  { key: "regulation", label: "Regulation", minutes: 180 },
  { key: "voicing", label: "Voicing", minutes: 120 },
  { key: "cleaning", label: "Cleaning", minutes: 90 },
  { key: "assessment", label: "Assessment", minutes: 60 },
  { key: "delivery", label: "Delivery / Move", minutes: 180 },
  { key: "maintenance", label: "Maintenance Visit", minutes: 120 },
  { key: "other", label: "Other", minutes: 60 },
] as const;

export type ServiceType = (typeof SERVICE_TYPES)[number]["key"];
export const SERVICE_TYPE_LABEL: Record<string, string> = Object.fromEntries(
  SERVICE_TYPES.map((s) => [s.key, s.label]),
);
export const serviceTypeMinutes = (key: string): number =>
  SERVICE_TYPES.find((s) => s.key === key)?.minutes ?? 60;

/** Job pipeline. `tone` maps to a `--color-svc-*` token, never a raw Tailwind palette. */
export type Tone = "slate" | "azure" | "violet" | "success" | "warn" | "danger";

export const JOB_STATUSES = [
  { key: "lead", label: "Lead", tone: "slate" as Tone },
  { key: "quoted", label: "Quoted", tone: "violet" as Tone },
  { key: "scheduled", label: "Scheduled", tone: "azure" as Tone },
  { key: "en_route", label: "En route", tone: "azure" as Tone },
  { key: "in_progress", label: "On site", tone: "warn" as Tone },
  { key: "on_hold", label: "On hold", tone: "slate" as Tone },
  { key: "completed", label: "Completed", tone: "success" as Tone },
  { key: "invoiced", label: "Invoiced", tone: "violet" as Tone },
  { key: "paid", label: "Paid", tone: "success" as Tone },
  { key: "cancelled", label: "Cancelled", tone: "danger" as Tone },
] as const;

export const JOB_STATUS_LABEL: Record<string, string> = Object.fromEntries(
  JOB_STATUSES.map((s) => [s.key, s.label]),
);
export const JOB_STATUS_TONE: Record<string, Tone> = Object.fromEntries(
  JOB_STATUSES.map((s) => [s.key, s.tone]),
);
/** Statuses that still need attention — everything else is closed out. */
export const OPEN_JOB_STATUSES = ["lead", "quoted", "scheduled", "en_route", "in_progress", "on_hold"];
export const CLOSED_JOB_STATUSES = ["completed", "invoiced", "paid", "cancelled"];
/** Work that was actually done (closed, but not cancelled). */
export const COMPLETED_JOB_STATUSES = ["completed", "invoiced", "paid"];

export const ITEM_KINDS = [
  { key: "service", label: "Service" },
  { key: "part", label: "Part / Material" },
  { key: "fee", label: "Fee" },
  { key: "discount", label: "Discount" },
] as const;

export const TIME_KINDS = [
  { key: "travel", label: "Travel" },
  { key: "work", label: "On site" },
  { key: "break", label: "Break" },
] as const;
export const TIME_KIND_LABEL: Record<string, string> = Object.fromEntries(
  TIME_KINDS.map((k) => [k.key, k.label]),
);

export const PAYMENT_METHODS = [
  { key: "cash", label: "Cash" },
  { key: "gcash", label: "GCash" },
  { key: "maya", label: "Maya" },
  { key: "bank_transfer", label: "Bank transfer" },
  { key: "card", label: "Card" },
  { key: "check", label: "Check" },
  { key: "other", label: "Other" },
] as const;
export const PAYMENT_METHOD_LABEL: Record<string, string> = Object.fromEntries(
  PAYMENT_METHODS.map((m) => [m.key, m.label]),
);

export const EXPENSE_CATEGORIES = [
  { key: "fuel", label: "Fuel" },
  { key: "transport", label: "Transport / Fare" },
  { key: "materials", label: "Materials" },
  { key: "parts", label: "Parts" },
  { key: "subcontractor", label: "Subcontractor" },
  { key: "meals", label: "Meals" },
  { key: "tools", label: "Tools & Equipment" },
  { key: "marketing", label: "Marketing" },
  { key: "rent", label: "Rent & Utilities" },
  { key: "other", label: "Other" },
] as const;
export const EXPENSE_CATEGORY_LABEL: Record<string, string> = Object.fromEntries(
  EXPENSE_CATEGORIES.map((c) => [c.key, c.label]),
);

export const PIANO_TYPES = ["Grand", "Upright", "Digital", "Organ"] as const;

export const CUSTOMER_SOURCES = [
  { key: "referral", label: "Referral" },
  { key: "repeat", label: "Repeat client" },
  { key: "website", label: "Website" },
  { key: "facebook", label: "Facebook" },
  { key: "walk_in", label: "Walk-in" },
  { key: "other", label: "Other" },
] as const;
export const CUSTOMER_SOURCE_LABEL: Record<string, string> = Object.fromEntries(
  CUSTOMER_SOURCES.map((s) => [s.key, s.label]),
);

export const INVOICE_STATUSES = [
  { key: "draft", label: "Draft", tone: "slate" as Tone },
  { key: "sent", label: "Sent", tone: "azure" as Tone },
  { key: "partial", label: "Part paid", tone: "warn" as Tone },
  { key: "paid", label: "Paid", tone: "success" as Tone },
  { key: "overdue", label: "Overdue", tone: "danger" as Tone },
  { key: "void", label: "Void", tone: "slate" as Tone },
] as const;
export const INVOICE_STATUS_LABEL: Record<string, string> = Object.fromEntries(
  INVOICE_STATUSES.map((s) => [s.key, s.label]),
);
export const INVOICE_STATUS_TONE: Record<string, Tone> = Object.fromEntries(
  INVOICE_STATUSES.map((s) => [s.key, s.tone]),
);

/* ============================================================
 * Codes
 * ============================================================ */

const pad = (n: number, width = 4) => String(Math.max(0, n)).padStart(width, "0");

/** `WO-2026-0012`. The year comes from the record's own date, not "now". */
export function jobCode(prefix: string, jobNumber: number, date: Date | string | null | undefined): string {
  const year = date ? new Date(date).getUTCFullYear() : new Date().getUTCFullYear();
  return `${prefix}-${year}-${pad(jobNumber)}`;
}

export function invoiceCode(
  prefix: string,
  invoiceNumber: number,
  date: Date | string | null | undefined,
): string {
  const year = date ? new Date(date).getUTCFullYear() : new Date().getUTCFullYear();
  return `${prefix}-${year}-${pad(invoiceNumber)}`;
}

/* ============================================================
 * Money
 * ============================================================ */

export type PricedLine = {
  qty: number;
  unitPriceCents: number;
  taxable?: boolean | null;
  kind?: string | null;
};

export const lineTotalCents = (l: PricedLine): number => Math.round((l.qty ?? 0) * (l.unitPriceCents ?? 0));

export type Totals = {
  subtotalCents: number;
  discountCents: number;
  taxableCents: number;
  taxCents: number;
  totalCents: number;
};

/**
 * Single source of truth for quote/invoice arithmetic.
 * `taxCents` is computed on the taxable base only; discounts are negative lines.
 * `vatEnabled: false` forces tax to zero regardless of `taxRateBps` (default true).
 */
export function computeTotals(
  lines: PricedLine[],
  opts: { discountCents?: number; taxRateBps?: number; vatEnabled?: boolean } = {},
): Totals {
  const subtotalCents = lines.reduce((sum, l) => sum + lineTotalCents(l), 0);
  const discountCents = Math.max(0, Math.round(opts.discountCents ?? 0));
  const taxableCents = lines.reduce(
    (sum, l) => (l.taxable === false ? sum : sum + lineTotalCents(l)),
    0,
  );
  const taxRateBps = opts.vatEnabled === false ? 0 : Math.max(0, Math.round(opts.taxRateBps ?? 0));
  const taxCents = Math.round((Math.max(0, taxableCents - discountCents) * taxRateBps) / 10_000);
  return {
    subtotalCents,
    discountCents,
    taxableCents,
    taxCents,
    totalCents: subtotalCents - discountCents + taxCents,
  };
}

/** "12%", "12.5%" — basis points to a trimmed percent string. */
export const fmtRatePct = (bps: number): string => `${Number((Math.max(0, bps) / 100).toFixed(2))}%`;

/**
 * Tax line label that shows the rate exactly once. The settings label usually already
 * carries a rate ("VAT (12%)"); that trailing "(n%)" is dropped and the *document's own*
 * saved rate is appended, so an old invoice never shows today's rate.
 */
export function taxLineLabel(label: string | null | undefined, taxRateBps: number): string {
  const base = (label ?? "").replace(/\s*\(\s*\d+(?:\.\d+)?\s*%\s*\)\s*$/, "").trim() || "VAT";
  return `${base} (${fmtRatePct(taxRateBps)})`;
}

export type InvoiceLike = {
  status: string;
  totalCents: number;
  amountPaidCents: number;
  dueDate?: Date | string | null;
  sentAt?: Date | string | null;
  voidedAt?: Date | string | null;
};

export const balanceCents = (inv: InvoiceLike): number =>
  Math.max(0, (inv.totalCents ?? 0) - (inv.amountPaidCents ?? 0));

/** Days past due (Manila day boundaries). Zero when not yet due. */
export function daysOverdue(inv: InvoiceLike, now: Date = new Date()): number {
  if (!inv.dueDate) return 0;
  const d = dayDiff(new Date(inv.dueDate as Date), now);
  return d > 0 ? d : 0;
}

/** A draft (never sent, nothing paid) is not a receivable, so it can never be "overdue". */
const isDraftLike = (inv: InvoiceLike): boolean => !inv.sentAt && (inv.amountPaidCents ?? 0) <= 0;

export const isOverdue = (inv: InvoiceLike, now: Date = new Date()): boolean =>
  !inv.voidedAt && !isDraftLike(inv) && balanceCents(inv) > 0 && daysOverdue(inv, now) > 0;

/**
 * Status is *derived* from money + dates rather than trusted from the stored column,
 * so a payment recorded anywhere immediately settles the invoice everywhere.
 */
export function invoiceStatus(inv: InvoiceLike, now: Date = new Date()): string {
  if (inv.voidedAt) return "void";
  const balance = balanceCents(inv);
  if (balance <= 0 && (inv.totalCents ?? 0) > 0) return "paid";
  if ((inv.amountPaidCents ?? 0) > 0) return "partial";
  if (isOverdue(inv, now)) return "overdue";
  return inv.sentAt ? "sent" : "draft";
}

export const AGING_BUCKETS = [
  { key: "current", label: "Current", max: 0 },
  { key: "1_30", label: "1–30 days", max: 30 },
  { key: "31_60", label: "31–60 days", max: 60 },
  { key: "61_90", label: "61–90 days", max: 90 },
  { key: "90_plus", label: "90+ days", max: Infinity },
] as const;

export type AgingKey = (typeof AGING_BUCKETS)[number]["key"];

export function agingBucket(inv: InvoiceLike, now: Date = new Date()): AgingKey {
  const days = daysOverdue(inv, now);
  if (days <= 0) return "current";
  if (days <= 30) return "1_30";
  if (days <= 60) return "31_60";
  if (days <= 90) return "61_90";
  return "90_plus";
}

export type AgingSummary = {
  buckets: { key: AgingKey; label: string; amountCents: number; count: number }[];
  totalOutstandingCents: number;
  overdueCents: number;
};

export function agingSummary(invoices: InvoiceLike[], now: Date = new Date()): AgingSummary {
  const totals = new Map<AgingKey, { amountCents: number; count: number }>(
    AGING_BUCKETS.map((b) => [b.key, { amountCents: 0, count: 0 }]),
  );
  let totalOutstandingCents = 0;
  for (const inv of invoices) {
    if (inv.voidedAt) continue;
    const bal = balanceCents(inv);
    if (bal <= 0) continue;
    totalOutstandingCents += bal;
    const bucket = totals.get(agingBucket(inv, now))!;
    bucket.amountCents += bal;
    bucket.count += 1;
  }
  const overdueCents = AGING_BUCKETS.filter((b) => b.key !== "current").reduce(
    (sum, b) => sum + totals.get(b.key)!.amountCents,
    0,
  );
  return {
    buckets: AGING_BUCKETS.map((b) => ({
      key: b.key,
      label: b.label,
      amountCents: totals.get(b.key)!.amountCents,
      count: totals.get(b.key)!.count,
    })),
    totalOutstandingCents,
    overdueCents,
  };
}

export type JobCosts = {
  laborCostCents: number;
  partsCostCents: number;
  expenseCents: number;
  /** Sum of non-void invoice totals (VAT included). */
  invoicedCents: number;
  /** Sum of the *saved* taxCents on those same non-void invoices. Defaults to 0. */
  taxCents?: number;
};

export type MarginOptions = {
  /** Profit is measured on revenue before VAT (VAT is owed to the government). Default true. */
  marginExcludesVat?: boolean;
  /** Count recorded crew labor as a job cost. Default true. */
  includeLaborCost?: boolean;
};

export type JobMargin = {
  costCents: number;
  profitCents: number;
  marginPct: number;
  /** The revenue base profit is measured against (invoiced, or invoiced − VAT). */
  revenueCents: number;
};

/**
 * Job profitability: revenue minus parts, job-linked expenses, and (optionally) labor.
 * Pure reporting — it never changes the recorded labor/invoice amounts it is given.
 */
export function jobMargin(costs: JobCosts, opts: MarginOptions = {}): JobMargin {
  const excludeVat = opts.marginExcludesVat !== false;
  const includeLabor = opts.includeLaborCost !== false;
  const revenueCents = costs.invoicedCents - (excludeVat ? Math.max(0, costs.taxCents ?? 0) : 0);
  const costCents = (includeLabor ? costs.laborCostCents : 0) + costs.partsCostCents + costs.expenseCents;
  const profitCents = revenueCents - costCents;
  return {
    costCents,
    profitCents,
    marginPct: revenueCents > 0 ? Math.round((profitCents / revenueCents) * 100) : 0,
    revenueCents,
  };
}

/** How the Finance "average invoice" KPI divides invoiced revenue. */
export const AVG_INVOICE_BASES = ["invoice", "job"] as const;
export type AvgInvoiceBasis = (typeof AVG_INVOICE_BASES)[number];

export const SETTINGS_TOGGLES = [
  "vatEnabled", "marginExcludesVat", "includeLaborCost", "showFinance", "showJobMargins",
] as const;
export type SettingsToggle = (typeof SETTINGS_TOGGLES)[number];
export type ReportSettingsPatch = Partial<Record<SettingsToggle, boolean>> & { avgInvoiceBasis?: AvgInvoiceBasis };

/**
 * Strict validation for the owner's money/report/visibility options. An omitted field is
 * left out (unchanged), an explicit `false` is kept, and anything malformed is an error —
 * never silently coerced (e.g. the string "false" is rejected, not read as true).
 */
export function validateReportSettings(
  patch: Record<string, unknown>,
): { ok: true; value: ReportSettingsPatch } | { ok: false; error: string } {
  const value: ReportSettingsPatch = {};
  for (const key of SETTINGS_TOGGLES) {
    const v = patch[key];
    if (v === undefined) continue;
    if (typeof v !== "boolean") return { ok: false, error: `Invalid value for ${key}: expected true or false.` };
    value[key] = v;
  }
  const basis = patch.avgInvoiceBasis;
  if (basis !== undefined) {
    if (typeof basis !== "string" || !(AVG_INVOICE_BASES as readonly string[]).includes(basis)) {
      return { ok: false, error: `Invalid average invoice basis: expected ${AVG_INVOICE_BASES.join(" or ")}.` };
    }
    value.avgInvoiceBasis = basis as AvgInvoiceBasis;
  }
  return { ok: true, value };
}

/** Average of `invoicedCents` over `count`; 0 when there is nothing to divide by. */
export function avgInvoiceCents(invoicedCents: number, count: number): number {
  return count > 0 ? Math.round(invoicedCents / count) : 0;
}

/* ============================================================
 * Time
 * ============================================================ */

export const toMinutes = (ms: number): number => Math.max(0, Math.round(ms / 60_000));

/** Minutes between two instants; a running log (null end) is measured against `now`. */
export function elapsedMinutes(start: Date | string, end?: Date | string | null, now: Date = new Date()): number {
  const from = new Date(start).getTime();
  const to = end ? new Date(end).getTime() : now.getTime();
  return to > from ? Math.round((to - from) / 60_000) : 0;
}

export function fmtMinutes(mins: number | null | undefined): string {
  const m = Math.max(0, Math.round(mins ?? 0));
  if (m === 0) return "0m";
  const h = Math.floor(m / 60);
  const rest = m % 60;
  if (!h) return `${rest}m`;
  return rest ? `${h}h ${rest}m` : `${h}h`;
}

/** Clock label for a minute-of-day value, e.g. 540 → "9:00 AM". */
export function fmtMinuteOfDay(min: number, format: "12h" | "24h" = "12h"): string {
  const h24 = Math.floor(min / 60) % 24;
  const m = Math.round(min % 60);
  if (format === "24h") return `${String(h24).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  const suffix = h24 >= 12 ? "PM" : "AM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${suffix}`;
}

/** Compact hour label for axes: 9 AM, 12 PM, 4:30 PM (minutes only when not on the hour). */
export function fmtHourShort(min: number): string {
  const h24 = Math.floor(min / 60) % 24;
  const m = Math.round(min % 60);
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}${m ? `:${String(m).padStart(2, "0")}` : ""} ${h24 >= 12 ? "PM" : "AM"}`;
}

export function utilizationPct(billableMinutes: number, windowMinutes: number): number {
  if (windowMinutes <= 0) return 0;
  return Math.min(100, Math.round((billableMinutes / windowMinutes) * 100));
}

/** Group consecutive time logs into a readable day summary. */
export function sumMinutes<T extends { kind: string; minutes: number | null }>(
  logs: T[],
  kind?: string,
): number {
  return logs.reduce((sum, l) => (kind && l.kind !== kind ? sum : sum + (l.minutes ?? 0)), 0);
}

/* ============================================================
 * Input guards
 * ============================================================
 * Server Actions receive untyped FormData objects. These keep parsing uniform and
 * shallow-fail instead of writing garbage into Postgres.
 */

export function str(value: unknown, max = 2_000): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

export function strOr(value: unknown, fallback = ""): string {
  return str(value) ?? fallback;
}

/** Accepts "1234.50" or "1,234.50"; returns integer centavos. */
export function moneyToCents(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return Math.round(value * 100);
  const cleaned = String(value ?? "").replace(/[^0-9.-]/g, "");
  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0;
}

export function intOr(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? Math.round(parsed) : fallback;
}

export function boolOr(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") return value;
  if (value === "on" || value === "true" || value === "1") return true;
  if (value === "off" || value === "false" || value === "0") return false;
  return fallback;
}

/** Parses a datetime-local string ("2026-09-23T09:30") as Manila wall-clock → UTC instant. */
export function parseLocal(value: unknown): Date | null {
  const raw = str(value);
  if (!raw) return null;
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
  if (!m) {
    const fallback = new Date(raw);
    return Number.isNaN(fallback.getTime()) ? null : fallback;
  }
  const [, y, mo, d, h = "0", mi = "0"] = m;
  // The business timezone is UTC+8 with no DST, so a fixed offset is exact.
  return new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h) - 8, Number(mi)));
}

export function optionalDate(value: unknown): Date | null {
  if (value === null || value === undefined || value === "") return null;
  return parseLocal(value);
}

export function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return (typeof value === "string" && (allowed as readonly string[]).includes(value))
    ? (value as T)
    : fallback;
}
