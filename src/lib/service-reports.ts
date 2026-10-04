/**
 * Home-service reporting rules — pure, no DB. One place decides what counts as money owed,
 * what a date range means, and what a "past-due" job is, so every screen agrees.
 *
 * Rules (confirmed with the owner):
 *  - Draft and void invoices are NOT receivables: excluded from outstanding, unpaid, AR aging,
 *    "invoiced", customer "billed" and collection rate. Drafts are reported on their own.
 *  - Range (month / 90d / year / all) drives invoiced (issue date), collected (payment date),
 *    expenses (spent date), net, the series and the category breakdown. Outstanding / AR is the
 *    balance *as of today* and never depends on the range.
 *  - All day / month boundaries are Asia/Manila (UTC+8), never the server's timezone.
 */

import { startOfManilaDayUTC } from "@/lib/dates";
import {
  agingSummary, balanceCents, invoiceStatus, SERVICE_TYPE_LABEL,
  type AgingSummary, type InvoiceLike,
} from "@/lib/service";

const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 86_400_000;

/* ---------------------------------------------------------------- invoices */

/** A real receivable: sent (or part/fully paid) and not void. Drafts never count. */
export function isCountable(inv: InvoiceLike, now: Date = new Date()): boolean {
  const s = invoiceStatus(inv, now);
  return s !== "draft" && s !== "void";
}

export const countable = <T extends InvoiceLike>(invoices: T[], now: Date = new Date()): T[] =>
  invoices.filter((i) => isCountable(i, now));

/** Outstanding + AR aging over countable invoices only (as of `now`). */
export function receivables(invoices: InvoiceLike[], now: Date = new Date()): AgingSummary {
  return agingSummary(countable(invoices, now), now);
}

/** Invoices that exist but were never sent: "N drafts · ₱X not yet sent". */
export function draftSummary(invoices: InvoiceLike[], now: Date = new Date()): { count: number; totalCents: number } {
  const drafts = invoices.filter((i) => invoiceStatus(i, now) === "draft");
  return { count: drafts.length, totalCents: drafts.reduce((s, i) => s + (i.totalCents ?? 0), 0) };
}

/** Total of countable invoices (what has actually been billed). */
export const billedCents = (invoices: InvoiceLike[], now: Date = new Date()): number =>
  countable(invoices, now).reduce((s, i) => s + (i.totalCents ?? 0), 0);

/** Sent, still unpaid, and past due — the "follow up" list. Oldest first. */
export function needsFollowUp<T extends InvoiceLike>(invoices: T[], now: Date = new Date()): T[] {
  return countable(invoices, now)
    .filter((i) => balanceCents(i) > 0)
    .sort((a, b) => new Date(a.dueDate ?? 0).getTime() - new Date(b.dueDate ?? 0).getTime());
}

/* ------------------------------------------------------------------- range */

export const RANGES = [
  { key: "month", label: "This month" },
  { key: "90d", label: "Last 90 days" },
  { key: "year", label: "This year" },
  { key: "all", label: "All time" },
] as const;
export type RangeKey = (typeof RANGES)[number]["key"];
export const DEFAULT_RANGE: RangeKey = "90d";
export const parseRange = (v: unknown): RangeKey =>
  RANGES.some((r) => r.key === v) ? (v as RangeKey) : DEFAULT_RANGE;

export type ResolvedRange = { key: RangeKey; label: string; from: Date | null; to: Date };

const manilaYMD = (d: Date) => {
  const s = new Date(d.getTime() + MANILA_OFFSET_MS);
  return { y: s.getUTCFullYear(), m: s.getUTCMonth(), d: s.getUTCDate() };
};
const manilaMidnightUTC = (y: number, m: number, d = 1) => new Date(Date.UTC(y, m, d) - MANILA_OFFSET_MS);

/** `to` is exclusive (start of tomorrow, Manila). `from` null = no lower bound. */
export function resolveRange(key: RangeKey, now: Date = new Date()): ResolvedRange {
  const today = startOfManilaDayUTC(now);
  const to = new Date(today.getTime() + DAY_MS);
  const { y, m } = manilaYMD(now);
  const label = RANGES.find((r) => r.key === key)!.label;
  if (key === "month") return { key, label, from: manilaMidnightUTC(y, m), to };
  if (key === "year") return { key, label, from: manilaMidnightUTC(y, 0), to };
  if (key === "90d") return { key, label, from: new Date(today.getTime() - 89 * DAY_MS), to };
  return { key, label, from: null, to };
}

export function inRange(date: Date | string | null | undefined, range: ResolvedRange): boolean {
  if (!date) return false;
  const t = new Date(date).getTime();
  return (range.from === null || t >= range.from.getTime()) && t < range.to.getTime();
}

/* ------------------------------------------------------------ finance rollup */

export type FinInvoice = InvoiceLike & { issueDate: Date | string };
export type FinPayment = { receivedAt: Date | string; amountCents: number };
export type FinExpense = { spentAt: Date | string; amountCents: number; category: string };

export type SeriesPoint = { key: string; label: string; invoicedCents: number; collectedCents: number; expenseCents: number };

export type FinanceRollup = {
  range: ResolvedRange;
  invoicedCents: number;
  invoiceCount: number;
  collectedCents: number;
  expenseCents: number;
  netCents: number;
  /** Share of what was invoiced in the range that has been paid so far (cohort-based, 0 when nothing invoiced). */
  collectionRatePct: number;
  /** As of `now` — NOT range-dependent. */
  aging: AgingSummary;
  drafts: { count: number; totalCents: number };
  series: SeriesPoint[];
  granularity: "day" | "month";
  expenseByCategory: { category: string; amountCents: number; count: number }[];
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MAX_ALL_TIME_MONTHS = 24;

function bucketKey(date: Date, gran: "day" | "month"): string {
  const { y, m, d } = manilaYMD(date);
  const mm = String(m + 1).padStart(2, "0");
  return gran === "day" ? `${y}-${mm}-${String(d).padStart(2, "0")}` : `${y}-${mm}`;
}

function buckets(range: ResolvedRange, now: Date, earliest: Date | null): { key: string; label: string }[] {
  const out: { key: string; label: string }[] = [];
  if (range.key === "month") {
    const { y, m } = manilaYMD(now);
    const today = manilaYMD(now).d;
    for (let d = 1; d <= today; d++) {
      out.push({ key: `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`, label: `${MONTHS[m]} ${d}` });
    }
    return out;
  }
  const cur = manilaYMD(now);
  let start = range.from ? manilaYMD(range.from) : earliest ? manilaYMD(earliest) : { y: cur.y, m: cur.m, d: 1 };
  if (range.key === "all") {
    // Never plot more than the last two years — keeps labels readable.
    const floor = new Date(Date.UTC(cur.y, cur.m - (MAX_ALL_TIME_MONTHS - 1), 1));
    if (Date.UTC(start.y, start.m, 1) < floor.getTime()) start = { y: floor.getUTCFullYear(), m: floor.getUTCMonth(), d: 1 };
  }
  let y = start.y;
  let m = start.m;
  while (y < cur.y || (y === cur.y && m <= cur.m)) {
    out.push({ key: `${y}-${String(m + 1).padStart(2, "0")}`, label: `${MONTHS[m]} ${String(y).slice(2)}` });
    m++;
    if (m > 11) { m = 0; y++; }
  }
  return out;
}

export function financeRollup(
  input: { invoices: FinInvoice[]; payments: FinPayment[]; expenses: FinExpense[] },
  rangeKey: RangeKey,
  now: Date = new Date(),
): FinanceRollup {
  const range = resolveRange(rangeKey, now);
  const gran: "day" | "month" = rangeKey === "month" ? "day" : "month";

  const liveInRange = countable(input.invoices, now).filter((i) => inRange(i.issueDate, range));
  const paymentsInRange = input.payments.filter((p) => inRange(p.receivedAt, range));
  const expensesInRange = input.expenses.filter((e) => inRange(e.spentAt, range));

  const invoicedCents = liveInRange.reduce((s, i) => s + (i.totalCents ?? 0), 0);
  const paidOnThose = liveInRange.reduce((s, i) => s + Math.min(i.amountPaidCents ?? 0, i.totalCents ?? 0), 0);
  const collectedCents = paymentsInRange.reduce((s, p) => s + p.amountCents, 0);
  const expenseCents = expensesInRange.reduce((s, e) => s + e.amountCents, 0);

  const earliestDates = [
    ...input.invoices.map((i) => new Date(i.issueDate)),
    ...input.payments.map((p) => new Date(p.receivedAt)),
    ...input.expenses.map((e) => new Date(e.spentAt)),
  ];
  const earliest = earliestDates.length ? new Date(Math.min(...earliestDates.map((d) => d.getTime()))) : null;
  const slots = buckets(range, now, earliest);
  const byKey = new Map<string, SeriesPoint>(
    slots.map((s) => [s.key, { key: s.key, label: s.label, invoicedCents: 0, collectedCents: 0, expenseCents: 0 }]),
  );
  for (const i of liveInRange) { const p = byKey.get(bucketKey(new Date(i.issueDate), gran)); if (p) p.invoicedCents += i.totalCents ?? 0; }
  for (const x of paymentsInRange) { const p = byKey.get(bucketKey(new Date(x.receivedAt), gran)); if (p) p.collectedCents += x.amountCents; }
  for (const e of expensesInRange) { const p = byKey.get(bucketKey(new Date(e.spentAt), gran)); if (p) p.expenseCents += e.amountCents; }

  const cats = new Map<string, { amountCents: number; count: number }>();
  for (const e of expensesInRange) {
    const c = cats.get(e.category) ?? { amountCents: 0, count: 0 };
    c.amountCents += e.amountCents; c.count += 1; cats.set(e.category, c);
  }

  return {
    range,
    invoicedCents,
    invoiceCount: liveInRange.length,
    collectedCents,
    expenseCents,
    netCents: collectedCents - expenseCents,
    collectionRatePct: invoicedCents > 0 ? Math.round((paidOnThose / invoicedCents) * 100) : 0,
    aging: receivables(input.invoices, now),
    drafts: draftSummary(input.invoices, now),
    series: slots.map((s) => byKey.get(s.key)!),
    granularity: gran,
    expenseByCategory: [...cats.entries()]
      .map(([category, v]) => ({ category, ...v }))
      .sort((a, b) => b.amountCents - a.amountCents),
  };
}

/* -------------------------------------------------------------------- jobs */

const NEEDS_CLOSING_STATUSES = ["scheduled", "en_route", "in_progress"];

/** The visit date has passed (before today, Manila) but the job was never closed out. */
export function needsClosing(job: { status: string; scheduledStart: Date | string | null }, now: Date = new Date()): boolean {
  if (!job.scheduledStart || !NEEDS_CLOSING_STATUSES.includes(job.status)) return false;
  return new Date(job.scheduledStart).getTime() < startOfManilaDayUTC(now).getTime();
}

export const hasQuote = (quotedCents: number | null | undefined): boolean => (quotedCents ?? 0) > 0;

/** Short / ALL-CAPS titles ("TNG", "RGLT 2x") read as abbreviations, not names. */
export function looksAbbreviated(title: string | null | undefined): boolean {
  const t = (title ?? "").trim();
  if (!t) return true;
  if (Object.values(SERVICE_TYPE_LABEL).some((l) => l.toLowerCase() === t.toLowerCase())) return false;
  if (!/\s/.test(t) && t.length <= 5) return true;
  return t.length <= 8 && /[A-Z]/.test(t) && t === t.toUpperCase() && /^[A-Z0-9 .\/&+-]+$/.test(t);
}

/** Display-only: heading is the job type when the title is an abbreviation; the original stays as a sub-line. */
export function jobHeading(title: string | null | undefined, serviceType: string): { heading: string; sub: string | null } {
  const t = (title ?? "").trim();
  const type = SERVICE_TYPE_LABEL[serviceType];
  if (type && looksAbbreviated(t)) return { heading: type, sub: t && t.toLowerCase() !== type.toLowerCase() ? t : null };
  return { heading: t || type || "Job", sub: null };
}

/* ---------------------------------------------------------------- customers */

export const BATCH_TAG = "type:batch";
export const isBatchCustomer = (tags: unknown): boolean => Array.isArray(tags) && tags.includes(BATCH_TAG);

const HONORIFICS: Record<string, string> = {
  dr: "Dr.", atty: "Atty.", engr: "Engr.", mr: "Mr.", mrs: "Mrs.", ms: "Ms.", fr: "Fr.", sr: "Sr.", jr: "Jr.", st: "St.", sto: "Sto.", sta: "Sta.",
};

/** Common acronyms (banks, schools, suffixes) that must stay upper-case inside an all-caps name. */
const ACRONYMS = new Set(["BDO", "BPI", "PNB", "SM", "UP", "USC", "UST", "USEP", "ADMU", "DLSU", "NGO", "LLC", "INC", "PH", "USA", "CDO", "GMA"]);

/**
 * Title Case only when the name is entirely lower- or UPPER-case. Mixed-case names
 * ("McDonald", "dela Cruz", "BDO Bank") are left exactly as typed. Known acronyms and short
 * consonant-only all-caps words ("BDO", "PNB", "SM") are kept in capitals.
 */
export function titleCaseName(name: string | null | undefined): string {
  const raw = (name ?? "").trim().replace(/\s+/g, " ");
  if (!raw) return "";
  const letters = raw.replace(/[^A-Za-z]/g, "");
  if (!letters || (raw !== raw.toLowerCase() && raw !== raw.toUpperCase())) return raw;
  const wasUpper = raw === raw.toUpperCase() && raw !== raw.toLowerCase();
  return raw
    .split(" ")
    .map((word) => {
      const bare = word.replace(/\.$/, "").toLowerCase();
      if (HONORIFICS[bare]) return HONORIFICS[bare];
      if (wasUpper && (ACRONYMS.has(word) || (/^[A-Z]{2,3}$/.test(word) && !/[AEIOU]/.test(word)))) return word;
      return word.toLowerCase().replace(/(^|[-'’/])([a-z])/g, (_, sep: string, ch: string) => sep + ch.toUpperCase());
    })
    .join(" ");
}

/* ------------------------------------------------------------------- chart */

/** Short peso label for chart axes: ₱0, ₱850, ₱12.5k, ₱1.2M. Input in centavos. */
export function compactPeso(cents: number): string {
  const pesos = Math.abs(cents) / 100;
  const sign = cents < 0 ? "−" : "";
  if (pesos >= 1_000_000) return `${sign}₱${+(pesos / 1_000_000).toFixed(1)}M`;
  if (pesos >= 1_000) return `${sign}₱${+(pesos / 1_000).toFixed(1)}k`;
  return `${sign}₱${Math.round(pesos)}`;
}

/** A "nice" axis for the tallest value: `ticks` run 0..max in equal steps (centavos). */
export function chartScale(maxCents: number, targetTicks = 4): { max: number; ticks: number[] } {
  const peak = Math.max(0, maxCents) / 100;
  if (peak <= 0) return { max: 100_00, ticks: [0, 2_500, 5_000, 7_500, 10_000].slice(0, targetTicks + 1) };
  const raw = peak / targetTicks;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw)!;
  const ticks = Array.from({ length: targetTicks + 1 }, (_, i) => Math.round(step * i * 100));
  return { max: ticks[ticks.length - 1], ticks };
}
