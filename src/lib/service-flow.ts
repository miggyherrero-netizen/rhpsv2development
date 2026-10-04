/**
 * Home-service workflow rules — pure, no DB. The job "next step" machine, type-to-confirm,
 * due dates, quote numbering, money-input parsing and the finance access check live here so the UI
 * and the Server Actions agree and the rules can be tested.
 */

import { startOfManilaDayUTC } from "@/lib/dates";
import { peso } from "@/lib/format";

/* ------------------------------------------------------------- job next step */

export type StepKey =
  | "send_quote" | "accept_quote" | "schedule" | "start_travel" | "arrive" | "complete"
  | "create_invoice" | "view_invoice" | "resume" | "reopen";

export type NextStep = { key: StepKey; label: string; hint: string };

export type StepContext = { hasLineItems: boolean; hasInvoice: boolean; hasSchedule: boolean };

/** The single primary button in a job header. `null` = nothing left to do (paid). */
export function nextJobStep(status: string, ctx: StepContext): NextStep | null {
  switch (status) {
    case "lead":
      return ctx.hasLineItems
        ? { key: "send_quote", label: "Send quote", hint: "Marks the job as quoted and opens the quote to share" }
        : { key: "schedule", label: "Schedule visit", hint: "Pick a date and time" };
    case "quoted":
      return { key: "accept_quote", label: "Mark quote accepted", hint: "The customer said yes" };
    case "scheduled":
      return ctx.hasSchedule
        ? { key: "start_travel", label: "Start travel", hint: "Starts the travel timer" }
        : { key: "schedule", label: "Schedule visit", hint: "Pick a date and time" };
    case "en_route":
      return { key: "arrive", label: "Arrived", hint: "Stops travel, starts the on-site timer" };
    case "in_progress":
      return { key: "complete", label: "Complete job", hint: "Stops the timers and closes the visit" };
    case "on_hold":
      return { key: "resume", label: "Resume", hint: "Back to scheduled" };
    case "completed":
      return ctx.hasInvoice
        ? { key: "view_invoice", label: "View invoice", hint: "Open the invoice for this job" }
        : { key: "create_invoice", label: "Create invoice", hint: "Bill this job" };
    case "invoiced":
      return { key: "view_invoice", label: "View invoice", hint: "Record payment on the invoice" };
    case "cancelled":
      return { key: "reopen", label: "Reopen job", hint: "Back to lead" };
    default:
      return null; // paid
  }
}

/** What a step changes. The server performs `status`, then `timers`, then logs `event`. */
export type StepEffect = {
  status: string;
  /** Running timers of this job to stop before anything starts. */
  stopTimers: boolean;
  /** Timer to start after stopping, if any. */
  startTimer: "travel" | "work" | null;
  event: { type: string; message: string };
};

export function stepEffect(key: StepKey): StepEffect | null {
  switch (key) {
    case "send_quote": return { status: "quoted", stopTimers: false, startTimer: null, event: { type: "quoted", message: "Quote sent" } };
    case "accept_quote": return { status: "scheduled", stopTimers: false, startTimer: null, event: { type: "quote_accepted", message: "Quote accepted" } };
    case "start_travel": return { status: "en_route", stopTimers: true, startTimer: "travel", event: { type: "en_route", message: "Travel started" } };
    case "arrive": return { status: "in_progress", stopTimers: true, startTimer: "work", event: { type: "started", message: "Arrived — work started" } };
    case "complete": return { status: "completed", stopTimers: true, startTimer: null, event: { type: "completed", message: "Job completed" } };
    case "resume": return { status: "scheduled", stopTimers: false, startTimer: null, event: { type: "scheduled", message: "Resumed" } };
    case "reopen": return { status: "lead", stopTimers: false, startTimer: null, event: { type: "created", message: "Job reopened" } };
    default: return null; // schedule / create_invoice / view_invoice are navigation, not state changes
  }
}

/* ---------------------------------------------------------- dangerous actions */

/** Type-to-confirm: the typed text must equal the record's code (case-insensitive, ignoring surrounding space). */
export function confirmMatches(typed: string, code: string): boolean {
  const t = typed.trim().toLowerCase();
  return t.length > 0 && t === code.trim().toLowerCase();
}

export const DEMO_PHRASE = "LOAD DEMO";

/** Loading sample data into a database that already holds real records needs the typed phrase. */
export function demoLoadAllowed(hasRealData: boolean, typed: string): boolean {
  return !hasRealData || typed.trim().toUpperCase() === DEMO_PHRASE;
}

/* --------------------------------------------------------------- quotes / dates */

/** WO-2026-0012 → QT-2026-0012 (a quote shares its job's number, so they can't drift apart). */
export function quoteCode(jobCodeValue: string): string {
  return jobCodeValue.replace(/^[A-Za-z]+/, "QT");
}

/** yyyy-mm-dd for `today + termsDays`, on the Manila calendar (what an `<input type=date>` expects). */
export function defaultDueDate(now: Date, termsDays: number): string {
  const start = startOfManilaDayUTC(now).getTime() + Math.max(0, Math.round(termsDays)) * 86_400_000;
  const manila = new Date(start + 8 * 3_600_000);
  return `${manila.getUTCFullYear()}-${String(manila.getUTCMonth() + 1).padStart(2, "0")}-${String(manila.getUTCDate()).padStart(2, "0")}`;
}

/** yyyy-mm-ddTHH:mm in Manila — the "now" default for datetime-local inputs. */
export function manilaDateTimeLocal(now: Date): string {
  const m = new Date(now.getTime() + 8 * 3_600_000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${m.getUTCFullYear()}-${p(m.getUTCMonth() + 1)}-${p(m.getUTCDate())}T${p(m.getUTCHours())}:${p(m.getUTCMinutes())}`;
}

/* ------------------------------------------------------------------- money input */

/** "₱2,500.50", "2,500", " 2500 " → 2500.5 / 2500 / 2500. Anything unreadable → null. */
export function parsePesoInput(text: string): number | null {
  const cleaned = text.replace(/[₱\s,]/g, "");
  if (!cleaned || !/^\d*\.?\d+$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** Customer card / page headline: "4 jobs · ₱254,000 billed". */
export function billedHeadline(jobCount: number, billedCents: number): string {
  return `${jobCount} job${jobCount === 1 ? "" : "s"} · ${peso(billedCents)} billed`;
}

/* ----------------------------------------------------------------------- access */

/**
 * Finance, margins and money-moving actions are owner-only. Only the owner role exists today; a future
 * crew/technician login is denied by default because anything other than "owner" returns false.
 */
export function canViewFinance(user: { role?: string | null } | null | undefined): boolean {
  return user?.role === "owner";
}

/* ---------------------------------------------------------------- messenger */

const MESSENGER_PREFIX = "messenger:";

/** "m.me/herrero.pianos", "https://facebook.com/herrero.pianos?ref=x", "@herrero.pianos" → "herrero.pianos"; junk → null. */
export function parseMessengerHandle(input: string): string | null {
  const raw = input.trim();
  const KNOWN = /^(?:https?:\/\/)?(?:www\.)?(?:m\.me|facebook\.com|fb\.com|messenger\.com\/t)\//i;
  // A pasted link to any other website is not a Messenger handle.
  if (/^https?:\/\//i.test(raw) && !KNOWN.test(raw)) return null;
  const h = (raw.replace(KNOWN, "").replace(/^@/, "").split(/[/?#]/)[0]) ?? "";
  return /^[A-Za-z0-9._-]{3,60}$/.test(h) ? h : null;
}

/** Stored in the existing `tags` column (no schema change). */
export const messengerHandle = (tags: unknown): string | null => {
  const t = (Array.isArray(tags) ? tags : []).find((x) => typeof x === "string" && x.startsWith(MESSENGER_PREFIX));
  return t ? (t as string).slice(MESSENGER_PREFIX.length) : null;
};

export function withMessenger(tags: unknown, handle: string | null): string[] {
  const rest = (Array.isArray(tags) ? tags : []).filter((x): x is string => typeof x === "string" && !x.startsWith(MESSENGER_PREFIX));
  return handle ? [...rest, `${MESSENGER_PREFIX}${handle}`] : rest;
}

/* -------------------------------------------------------------------- quotes */

export type QuoteStatus = "draft" | "sent" | "accepted" | "converted";

/** A quote is derived from its job: no separate record, so it can never disagree with the job it prices. */
export function quoteStatus(jobStatus: string, events: { type: string }[]): QuoteStatus {
  if (jobStatus === "invoiced" || jobStatus === "paid") return "converted";
  if (events.some((e) => e.type === "quote_accepted")) return "accepted";
  if (jobStatus === "quoted") return "sent";
  return "draft";
}

export const QUOTE_STATUS_LABEL: Record<QuoteStatus, string> = { draft: "Draft", sent: "Sent", accepted: "Accepted", converted: "Converted to invoice" };

type QuoteItem = { id?: string; kind?: string; description: string; qty: number; unitPriceCents: number; taxable: boolean };

/**
 * Lines shown on a quote — exactly what "Create invoice" will bill: the job's items, plus the call-out fee
 * only when the job doesn't already carry a fee line (so the travel charge is never counted twice).
 */
export function quoteLines(items: QuoteItem[], travelFeeCents: number): QuoteItem[] {
  const hasFee = items.some((i) => i.kind === "fee");
  return travelFeeCents > 0 && !hasFee
    ? [...items, { description: "Travel / service call", qty: 1, unitPriceCents: travelFeeCents, taxable: true, kind: "fee" }]
    : items;
}
