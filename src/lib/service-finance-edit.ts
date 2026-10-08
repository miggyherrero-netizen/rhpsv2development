/**
 * Finance edit rules (phase 3) — pure, no database, no React.
 *
 * ONE place decides: when an edit needs a reason, what an invoice's totals / status / paidAt are after
 * any edit, what may never be saved (overpayment, discount above subtotal), and how a linked job follows.
 * `recalcInvoice` (src/server/service-invoice-core.ts) calls `computeInvoiceState`, so the tests here
 * cover the exact function that writes the books. Money is whole centavos.
 */

import { computeTotals, type PricedLine } from "@/lib/service";
import { diffFields, type FinanceChanges } from "@/lib/service-finance-history";

/** Thrown inside a locked edit to refuse it: the transaction rolls back and `message` goes to the owner. */
export class EditRejected extends Error {
  constructor(message: string) { super(message); this.name = "EditRejected"; }
}

/* ------------------------------------------------------------------ reason */

export const REASON_MIN = 3;
export const REASON_MAX = 500;

export type ReasonResult = { ok: true; reason: string } | { ok: false; error: string };

/** Trims and checks the "why are you changing this?" note. */
export function validateReason(raw: unknown): ReasonResult {
  const reason = typeof raw === "string" ? raw.replace(/[\u200B-\u200D\u2060\uFEFF]/g, "").trim().replace(/\s+/g, " ") : "";
  if (!reason) return { ok: false, error: "Add a short reason for this change (at least 3 characters)." };
  if (!/[\p{L}\p{N}]/u.test(reason)) return { ok: false, error: "The reason needs some words or numbers, not just symbols." };
  if (reason.length < REASON_MIN) return { ok: false, error: "The reason is too short — write at least 3 characters." };
  if (reason.length > REASON_MAX) return { ok: false, error: `The reason is too long — keep it under ${REASON_MAX} characters.` };
  return { ok: true, reason };
}

export type ReasonProbe = { status: string; amountPaidCents: number };

/**
 * An edit needs a reason once real money is involved: any payment on the invoice, or a paid / partial
 * status. Draft or sent invoices with no payments stay free to edit, exactly as before.
 */
export function needsReason(inv: ReasonProbe): boolean {
  return (inv.amountPaidCents ?? 0) > 0 || inv.status === "paid" || inv.status === "partial";
}

/* ------------------------------------------------------------------ limits */

export const MAX_QTY = 9_999;
export const MAX_LINE_CENTS = 2_000_000_000; // Postgres integer columns hold up to 2,147,483,647
export const MAX_TAX_BPS = 10_000;
export const AMOUNT_TOO_LARGE = "Amount too large — keep each line under ₱20,000,000.";

export const clampQty = (qty: number): number => Math.min(MAX_QTY, Math.max(1, Math.round(Number.isFinite(qty) ? qty : 1)));
export const clampTaxBps = (bps: number): number => Math.min(MAX_TAX_BPS, Math.max(0, Math.round(Number.isFinite(bps) ? bps : 0)));

/** Error text when one line (qty x unit price) is too big for the database, otherwise null. */
export function lineLimitError(qty: number, unitPriceCents: number): string | null {
  if (!Number.isFinite(unitPriceCents) || Math.abs(unitPriceCents) > MAX_LINE_CENTS) return AMOUNT_TOO_LARGE;
  if (Math.abs(qty * unitPriceCents) > MAX_LINE_CENTS) return AMOUNT_TOO_LARGE;
  return null;
}

/** Postgres "numeric value out of range" (22003), including when wrapped by the driver. */
export function isNumericOverflow(e: unknown): boolean {
  const x = e as { code?: string; cause?: { code?: string } } | null;
  return (x?.code ?? x?.cause?.code) === "22003";
}

/* ------------------------------------------------------------------ amounts */

/** "₱1,234.50" for error messages. */
export function fmtPesoExact(cents: number): string {
  const neg = cents < 0;
  const abs = Math.abs(Math.round(cents));
  return `${neg ? "-" : ""}₱${Math.floor(abs / 100).toLocaleString("en-US")}.${String(abs % 100).padStart(2, "0")}`;
}

/** True when payments add up to more than the invoice total (the books would show money that is not owed). */
export const wouldOverpay = (totalCents: number, paidCents: number): boolean =>
  paidCents > 0 && paidCents > Math.max(0, totalCents);

/** How far payments are above what is owed (0 when sound). */
export const overpaidBy = (totalCents: number, paidCents: number): number =>
  paidCents > 0 ? Math.max(0, paidCents - Math.max(0, totalCents)) : 0;

/** True when the discount is bigger than the subtotal (the invoice total would go negative). */
export const discountTooLarge = (discountCents: number, subtotalCents: number): boolean => discountCents > subtotalCents;

export const overpaymentMessage = (totalCents: number, paidCents: number): string =>
  `Payments (${fmtPesoExact(paidCents)}) would be more than the invoice total (${fmtPesoExact(totalCents)}). Lower the payment first.`;

export const discountMessage = (discountCents: number, subtotalCents: number): string =>
  `The discount (${fmtPesoExact(discountCents)}) is more than the subtotal (${fmtPesoExact(subtotalCents)}). Lower the discount.`;

/**
 * Overpayment guard for an edit. An edit is refused when it leaves payments above the total — unless the
 * invoice was ALREADY overpaid before and the edit does not make it worse (so a legacy overpaid invoice can
 * still be corrected, or have its notes changed, but never get further out of balance).
 */
export function overpayError(
  before: { totalCents: number; paidCents: number } | null,
  after: { totalCents: number; paidCents: number },
): string | null {
  if (!wouldOverpay(after.totalCents, after.paidCents)) return null;
  if (before && wouldOverpay(before.totalCents, before.paidCents)) {
    if (overpaidBy(after.totalCents, after.paidCents) <= overpaidBy(before.totalCents, before.paidCents)) return null;
  }
  return overpaymentMessage(after.totalCents, after.paidCents);
}

/* ------------------------------------------------------------------ invoice state */

export type StateItem = PricedLine;
export type StatePayment = { amountCents: number; receivedAt: Date | string };
export type InvoiceStateInput = {
  items: StateItem[];
  payments: StatePayment[];
  discountCents: number;
  taxRateBps: number;
  sentAt?: Date | string | null;
  voidedAt?: Date | string | null;
  /** Only used if the invoice is paid but no payment row can supply a date (should not happen). */
  previousPaidAt?: Date | string | null;
};
export type InvoiceStatus = "draft" | "sent" | "partial" | "paid" | "void";
export type InvoiceState = {
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  amountPaidCents: number;
  /** Never negative (display value). */
  balanceCents: number;
  /** Payments above the total; 0 when the books are sound. */
  overpaidCents: number;
  status: InvoiceStatus;
  /** The day payments covered the total = latest payment date; null unless paid. */
  paidAt: Date | null;
};

/**
 * Totals, balance, status and paidAt from lines + payments. Arithmetic is `computeTotals` (unchanged);
 * the status rules are the ones recalcInvoice has always used: void > paid > partial > sent > draft.
 */
export function computeInvoiceState(input: InvoiceStateInput): InvoiceState {
  const totals = computeTotals(input.items, { discountCents: input.discountCents, taxRateBps: input.taxRateBps });
  const amountPaidCents = input.payments.reduce((s, p) => s + p.amountCents, 0);
  const balanceCents = Math.max(0, totals.totalCents - amountPaidCents);
  const status: InvoiceStatus = input.voidedAt
    ? "void"
    : totals.totalCents > 0 && balanceCents <= 0
      ? "paid"
      : amountPaidCents > 0
        ? "partial"
        : input.sentAt
          ? "sent"
          : "draft";

  let paidAt: Date | null = null;
  if (status === "paid") {
    const times = input.payments.map((p) => new Date(p.receivedAt).getTime()).filter((t) => Number.isFinite(t));
    if (times.length) paidAt = new Date(Math.max(...times));
    else if (input.previousPaidAt) paidAt = new Date(input.previousPaidAt);
  }
  return {
    subtotalCents: totals.subtotalCents,
    taxCents: totals.taxCents,
    totalCents: totals.totalCents,
    amountPaidCents,
    balanceCents,
    overpaidCents: overpaidBy(totals.totalCents, amountPaidCents),
    status,
    paidAt,
  };
}

/* ------------------------------------------------------------------ job follows invoice */

/**
 * invoiced -> paid when the invoice becomes paid (as before); paid -> invoiced when it stops being paid
 * (new). Any other job status is never touched. Returns the status the job should have.
 * `previousInvoiceStatus` (optional) makes the paid -> invoiced step happen only on the real transition
 * out of "paid", so a job someone marked paid by hand is not pulled back by an unrelated invoice edit.
 */
export function jobStatusAfterInvoice(input: { jobStatus: string; invoiceStatus: string; previousInvoiceStatus?: string }): string {
  if (input.jobStatus === "invoiced" && input.invoiceStatus === "paid") return "paid";
  if (
    input.jobStatus === "paid" && input.invoiceStatus !== "paid" &&
    (input.previousInvoiceStatus === undefined || input.previousInvoiceStatus === "paid")
  ) return "invoiced";
  return input.jobStatus;
}

/* ------------------------------------------------------------------ payment edit */

export const PAYMENT_EDIT_FIELDS = ["amountCents", "receivedAt", "method", "reference", "note"] as const;

/** What changed on a payment, as history `{ field: { from, to } }` (money in centavos, dates as ISO). */
export function paymentChanges(
  before: { amountCents: number; receivedAt: Date; method: string; reference: string | null; note: string | null },
  after: { amountCents: number; receivedAt: Date; method: string; reference: string | null; note: string | null },
): FinanceChanges {
  return diffFields(before, after, PAYMENT_EDIT_FIELDS);
}

/* ------------------------------------------------------------------ history row */

export type HistoryRowInput = {
  entityType: string; entityId: string; action: string; summary: string;
  changes?: FinanceChanges | null; invoiceId?: string | null; jobId?: string | null;
  reason?: string | null; actorName?: string | null;
};

/** The exact row stored for a history entry (shared by the best-effort and the strict writer). */
export function historyRowOf<T extends HistoryRowInput>(r: T) {
  return {
    entityType: r.entityType as T["entityType"], entityId: r.entityId, action: r.action as T["action"],
    summary: r.summary.slice(0, 500),
    changes: r.changes && Object.keys(r.changes).length ? r.changes : null,
    invoiceId: r.invoiceId ?? null, jobId: r.jobId ?? null,
    reason: r.reason ?? null, actorName: r.actorName ?? null,
  };
}

/** Plain-English line for the reason, shown under a history entry. */
export const describeReason = (reason: string | null | undefined): string | null =>
  reason && reason.trim() ? `Reason: ${reason.trim()}` : null;
