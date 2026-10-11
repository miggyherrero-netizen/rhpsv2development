/**
 * Pure rules for the Home Service expense form (quick-add on the job page and the Expenses page) and the
 * matching server amount check. UI only: none of this changes how an expense is stored or how it feeds
 * job margins.
 */
import { EXPENSE_CATEGORIES } from "@/lib/service";
import { defaultKindForCategory } from "@/lib/service-finance-split";

/** Largest single expense accepted (₱20,000,000). The column is a 32-bit integer of centavos (about ₱21.4M). */
export const MAX_EXPENSE_PESOS = 20_000_000;
export const MAX_EXPENSE_CENTS = MAX_EXPENSE_PESOS * 100;

/** Label of a category key ("fuel" -> "Fuel"); unknown keys fall back to "Other". */
export function categoryLabel(category: string): string {
  return EXPENSE_CATEGORIES.find((c) => c.key === category)?.label ?? "Other";
}

/** What the expense is called when the owner leaves "What was it for?" blank: the category label. */
export function defaultDescription(category: string, typed: string): string {
  const t = typed.trim();
  return t || categoryLabel(category);
}

/**
 * Peso text -> number. Accepts "1,250", "₱ 99.5", ".5" and a trailing dot while typing ("1250.").
 * Rejects signs, exponents and anything else (null).
 */
export function parseExpenseAmount(text: string): number | null {
  const cleaned = text.replace(/[₱\s,]/g, "");
  if (!/^(\d+\.?\d*|\.\d+)$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

export type AmountState = "empty" | "invalid" | "zero" | "toolarge" | "ok";

export function amountState(amount: string): AmountState {
  if (amount.trim() === "") return "empty";
  const n = parseExpenseAmount(amount);
  if (n === null) return "invalid";
  if (Math.round(n * 100) <= 0) return "zero"; // "0", "0.00", "0.004" all save as PHP 0
  if (n > MAX_EXPENSE_PESOS) return "toolarge";
  return "ok";
}

/** The inline hint under the amount field ("" = nothing to say). Edit mode keeps old rows (PHP 0) editable. */
export function amountHint(amount: string, mode: "create" | "edit" = "create"): { text: string; tone: "muted" | "danger" } {
  switch (amountState(amount)) {
    case "invalid": return { text: "Use a number like 1,250.", tone: "danger" };
    case "toolarge": return { text: "Amount is too large", tone: "danger" };
    case "zero": return mode === "create" ? { text: "Enter an amount above ₱0", tone: "danger" } : { text: "", tone: "muted" };
    case "empty": return mode === "create" ? { text: "Enter an amount above ₱0", tone: "muted" } : { text: "", tone: "muted" };
    default: return { text: "", tone: "muted" };
  }
}

/**
 * Server-side amount rule. Create needs more than 0; an edit may keep an old PHP 0 row. Both refuse
 * negatives and anything above the ceiling.
 */
export function validateExpenseAmountCents(cents: number, opts: { allowZero?: boolean } = {}): { ok: true } | { ok: false; error: string } {
  if (!Number.isFinite(cents)) return { ok: false, error: "Enter a valid amount." };
  if (cents > MAX_EXPENSE_CENTS) return { ok: false, error: "Amount is too large." };
  if (cents < 0 || (cents === 0 && !opts.allowZero)) return { ok: false, error: "Enter an amount above ₱0." };
  return { ok: true };
}

export function effectiveExpenseKind(input: { kindPicked: string | null; fixedJobId?: string; jobId: string; category: string }): string {
  return input.kindPicked ?? (input.fixedJobId || input.jobId ? "job" : defaultKindForCategory(input.category));
}

/** A stock expense must name its piano (only checked where the piano list is offered). */
export function stockNeedsPiano(input: { kind: string; fixedJobId?: string; pianosOffered: boolean; pianoId: string }): boolean {
  return input.kind === "stock" && !input.fixedJobId && input.pianosOffered && !input.pianoId;
}

/** Why Save is disabled when the amount hint doesn't already say so ("" = no extra reason). */
export function saveBlockReason(input: { mode: "create" | "edit"; description: string; needsPiano: boolean; reading: boolean }): string {
  if (input.needsPiano) return "Choose a piano to save.";
  if (input.mode === "edit" && input.description.trim() === "") return "Add a description to save.";
  if (input.reading) return "Preparing the photo…";
  return "";
}

/**
 * Can the form be saved? Creating needs an amount above 0 (and within the ceiling) and falls back to the
 * category label for the purpose. Editing keeps today's rule (any valid amount, purpose required).
 */
export function canSaveExpense(input: {
  amount: string; description: string; category: string; mode?: "create" | "edit";
  /** Extra blockers: reading a photo, or a stock expense without a piano. */
  blocked?: boolean;
}): boolean {
  if (input.blocked) return false;
  const state = amountState(input.amount);
  if (input.mode === "edit") {
    if (state === "invalid" || state === "toolarge") return false;
    return input.description.trim() !== "";
  }
  return state === "ok" && defaultDescription(input.category, input.description) !== "";
}

/** Keep "More details" open when something inside it already holds the owner's input. */
export function shouldOpenMore(input: {
  vendor: string; receipt: string | null; method: string; reimbursable: boolean; dateChanged: boolean;
}): boolean {
  return input.vendor.trim() !== "" || !!input.receipt || input.method !== "cash" || input.reimbursable || input.dateChanged;
}

export type ExpensePayload = {
  category: string; description: string; amount: number; spentAt: string | null; vendor: string;
  method: string; reimbursable: boolean; jobId: string | null; receiptUrl: string | null;
  kind: string; pianoId: string | null;
};

/** The exact values the form submits. Hidden "More details" fields pass their defaults through unchanged. */
export function buildExpensePayload(f: {
  mode?: "create" | "edit"; category: string; description: string; amount: string; spentAt: string;
  vendor: string; method: string; reimbursable: boolean; jobId: string; fixedJobId?: string;
  receipt: string | null; kindPicked: string | null; pianoId: string;
}): ExpensePayload {
  const kind = effectiveExpenseKind(f);
  return {
    category: f.category,
    description: f.mode === "edit" ? f.description.trim() : defaultDescription(f.category, f.description),
    amount: parseExpenseAmount(f.amount) ?? 0,
    spentAt: f.spentAt || null,
    vendor: f.vendor, method: f.method, reimbursable: f.reimbursable,
    jobId: f.fixedJobId ?? (f.jobId || null),
    receiptUrl: f.receipt,
    kind,
    pianoId: kind === "stock" ? f.pianoId || null : null,
  };
}

/** Message when the submit call itself threw (as opposed to the server returning an error). */
export function thrownSubmitMessage(err: unknown, offline = false): string {
  const network = offline || err instanceof TypeError;
  return `${network ? "Connection problem. " : ""}It may have been saved. Check the list before trying again. Your entries are kept.`;
}

export const GENERIC_SAVE_ERROR = "Couldn't save. Your entries are kept — try again.";
