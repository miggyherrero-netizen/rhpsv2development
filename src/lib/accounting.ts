/**
 * Owner Accounting domain logic — pure, dependency-light, safe to import from both
 * Server Components and client components (no database or Node-only APIs here).
 *
 * Model: a lightweight chart of accounts (`acc_accounts`) + an append-only legged
 * journal (`acc_journal` / `acc_journal_lines`). Every entry is built by one of the
 * posting builders below, is balanced by construction, and is validated again before
 * insert. The owner-facing UI never shows debits/credits.
 *
 * Money convention: integer centavos, matching `peso()` in `src/lib/format.ts`.
 * Month bucketing: Asia/Manila, never the container's UTC zone.
 */

import { ymd } from "@/lib/dates";
import { peso } from "@/lib/format";

/* ============================================================
 * Enums & labels
 * ============================================================ */

export const ACCOUNT_TYPES = ["asset", "liability", "equity", "revenue", "expense"] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const ACCOUNT_TYPE_LABEL: Record<string, string> = {
  asset: "Asset",
  liability: "Liability",
  equity: "Equity",
  revenue: "Revenue",
  expense: "Expense",
};

/** Account types whose natural balance is a debit (asset & expense). */
export const isDebitNatured = (type: string): boolean => type === "asset" || type === "expense";

export const WALLET_KINDS = [
  { key: "cash", label: "Cash" },
  { key: "bank", label: "Bank" },
  { key: "ewallet", label: "E-wallet" },
  { key: "other", label: "Other" },
] as const;
export type WalletKind = (typeof WALLET_KINDS)[number]["key"];
export const WALLET_KIND_LABEL: Record<string, string> = Object.fromEntries(
  WALLET_KINDS.map((w) => [w.key, w.label]),
);

/** Streams classify every journal entry for the "by stream" P&L cut. */
export const STREAMS = [
  { key: "service", label: "Home Service" },
  { key: "workshop", label: "Restoration" },
  { key: "sales", label: "Piano Sales" },
  { key: "payroll", label: "Payroll" },
  { key: "overhead", label: "Overhead" },
  { key: "owner", label: "Owner" },
  { key: "tax", label: "Taxes" },
  { key: "financing", label: "Financing" },
  { key: "operations", label: "Operations" },
] as const;
export type Stream = (typeof STREAMS)[number]["key"];
export const STREAM_LABEL: Record<string, string> = Object.fromEntries(
  STREAMS.map((s) => [s.key, s.label]),
);

/** Owner-facing entry kinds. The label is what the owner sees — never "Dr/Cr". */
export const JOURNAL_KINDS = [
  { key: "owner_draw", label: "Owner draw", stream: "owner", tone: "violet" },
  { key: "owner_contribution", label: "Owner contribution", stream: "owner", tone: "emerald" },
  { key: "personal_expense", label: "Personal expense", stream: "owner", tone: "rose" },
  { key: "transfer", label: "Transfer", stream: "operations", tone: "slate" },
  { key: "business_expense", label: "Business expense", stream: "overhead", tone: "amber" },
  { key: "business_income", label: "Other income", stream: "overhead", tone: "emerald" },
  { key: "loan_received", label: "Loan received", stream: "financing", tone: "sky" },
  { key: "loan_payment", label: "Loan payment", stream: "financing", tone: "amber" },
  { key: "tax_payment", label: "Tax payment", stream: "tax", tone: "amber" },
  { key: "ap_payment", label: "Payable payment", stream: "operations", tone: "slate" },
  { key: "payroll_wage", label: "Payroll payout", stream: "payroll", tone: "amber" },
  { key: "service_billing", label: "Service invoice", stream: "service", tone: "sky" },
  { key: "service_collection", label: "Service payment", stream: "service", tone: "emerald" },
  { key: "service_expense", label: "Field expense", stream: "service", tone: "amber" },
  { key: "prebooks_collection", label: "Pre-books collection", stream: "service", tone: "slate" },
  { key: "project_payment", label: "Project payment", stream: "workshop", tone: "emerald" },
  { key: "project_billing", label: "Project billing", stream: "workshop", tone: "sky" },
  { key: "project_cost", label: "Project cost", stream: "workshop", tone: "amber" },
  { key: "piano_payment", label: "Piano sale payment", stream: "sales", tone: "emerald" },
  { key: "piano_sale", label: "Piano sale", stream: "sales", tone: "sky" },
  { key: "piano_cost", label: "Piano cost", stream: "sales", tone: "amber" },
  { key: "correction", label: "Correction", stream: "operations", tone: "rose" },
] as const;
export type JournalKind = (typeof JOURNAL_KINDS)[number]["key"];

export const KIND_LABEL: Record<string, string> = Object.fromEntries(
  JOURNAL_KINDS.map((k) => [k.key, k.label]),
);
export const KIND_STREAM: Record<string, string> = Object.fromEntries(
  JOURNAL_KINDS.map((k) => [k.key, k.stream]),
);
export const KIND_TONE: Record<string, string> = Object.fromEntries(
  JOURNAL_KINDS.map((k) => [k.key, k.tone]),
);
export const JOURNAL_KIND_KEYS = JOURNAL_KINDS.map((k) => k.key);

/** Entry kinds that move money INTO a wallet (used for feed direction display). */
export const INCOME_KINDS = new Set([
  "owner_contribution", "business_income", "loan_received", "service_collection",
  "prebooks_collection", "project_payment", "piano_payment",
]);

/** Chip classes on the admin dark theme (no Personal-Workspace palette rules apply here). */
export const TONE_CLASS: Record<string, string> = {
  slate: "text-slate-300 bg-slate-400/10 border-slate-400/20",
  sky: "text-sky-300 bg-sky-400/10 border-sky-400/20",
  emerald: "text-emerald-300 bg-emerald-400/10 border-emerald-400/20",
  amber: "text-amber-300 bg-amber-400/10 border-amber-400/20",
  rose: "text-rose-300 bg-rose-400/10 border-rose-400/20",
  violet: "text-violet-300 bg-violet-400/10 border-violet-400/20",
};

/* ============================================================
 * Built-in accounts (idempotent initialization spec)
 * ============================================================ */

export type SystemAccountSpec = {
  systemKey: string;
  name: string;
  type: AccountType;
  isWallet?: boolean;
  walletKind?: WalletKind;
  note?: string;
};

/** Book accounts every posting rule needs. Renameable, never deletable. */
export const SYSTEM_ACCOUNTS: SystemAccountSpec[] = [
  { systemKey: "ar", name: "Accounts Receivable", type: "asset", note: "Billed but not yet collected" },
  { systemKey: "deposits_held", name: "Customer Deposits Held", type: "liability", note: "Unearned customer money" },
  { systemKey: "owner_draws", name: "Owner Draws", type: "equity", note: "Withdrawals — never an expense" },
  { systemKey: "personal", name: "Owner Personal", type: "equity", note: "Personal costs paid from business money" },
  { systemKey: "capital", name: "Owner Capital", type: "equity", note: "Money the owner puts in" },
  { systemKey: "opening_equity", name: "Opening Equity", type: "equity", note: "Balances before the books started" },
  { systemKey: "vat_payable", name: "VAT Payable", type: "liability", note: "Output VAT owed until paid" },
  { systemKey: "ap", name: "Accounts Payable", type: "liability", note: "Costs recorded but not yet paid" },
  { systemKey: "pianos_on_hand", name: "Pianos on Hand", type: "asset", note: "Acquisition + prep cost of sale stock" },
  { systemKey: "piano_cogs", name: "Piano Cost of Sales", type: "expense", note: "Carrying cost recognized at sale" },
  { systemKey: "wages", name: "Payroll Wages", type: "expense", note: "Shop crew payouts" },
  { systemKey: "service_revenue", name: "Service Revenue", type: "revenue" },
  { systemKey: "project_revenue", name: "Project Revenue", type: "revenue" },
  { systemKey: "piano_revenue", name: "Piano Sales Revenue", type: "revenue" },
  { systemKey: "other_income", name: "Other Income", type: "revenue" },
  { systemKey: "unmapped", name: "Unmapped Clearing", type: "asset", note: "Safety net — map payment methods in Settings" },
];

/** Starting wallets. Renameable; the owner adds any others (no hardcoded bank names). */
export const DEFAULT_WALLETS: SystemAccountSpec[] = [
  { systemKey: "wallet_cash", name: "Cash", type: "asset", isWallet: true, walletKind: "cash" },
  { systemKey: "wallet_bank", name: "Bank", type: "asset", isWallet: true, walletKind: "bank" },
  { systemKey: "wallet_gcash", name: "GCash", type: "asset", isWallet: true, walletKind: "ewallet" },
  { systemKey: "wallet_maya", name: "Maya", type: "asset", isWallet: true, walletKind: "ewallet" },
];

/**
 * Default expense categories. `expKey` mirrors the service module's EXPENSE_CATEGORIES
 * keys so the bridge maps field expenses onto the same-named account, plus two
 * accounting-only categories.
 */
export const DEFAULT_EXPENSE_CATEGORIES: { systemKey: string; name: string; expKey: string }[] = [
  { systemKey: "exp_fuel", name: "Fuel", expKey: "fuel" },
  { systemKey: "exp_transport", name: "Transport / Fare", expKey: "transport" },
  { systemKey: "exp_materials", name: "Materials", expKey: "materials" },
  { systemKey: "exp_parts", name: "Parts", expKey: "parts" },
  { systemKey: "exp_subcontractor", name: "Subcontractor", expKey: "subcontractor" },
  { systemKey: "exp_meals", name: "Meals", expKey: "meals" },
  { systemKey: "exp_tools", name: "Tools & Equipment", expKey: "tools" },
  { systemKey: "exp_marketing", name: "Marketing", expKey: "marketing" },
  { systemKey: "exp_rent", name: "Rent & Utilities", expKey: "rent" },
  { systemKey: "exp_interest", name: "Interest & Bank Fees", expKey: "interest" },
  { systemKey: "exp_other", name: "Other", expKey: "other" },
];

/** `exp_*` system key for a service expense category key. */
export const expenseAccountKey = (category: string): string => {
  const hit = DEFAULT_EXPENSE_CATEGORIES.find((c) => c.expKey === category);
  return hit ? hit.systemKey : "exp_other";
};

/* ============================================================
 * VAT
 * ============================================================ */

/** Service/project convention: VAT added on top of a subtotal. `round(sub × bps / 10000)`. */
export const vatExclusiveCents = (subtotalCents: number, taxRateBps: number): number =>
  Math.round((Math.max(0, subtotalCents) * Math.max(0, taxRateBps)) / 10_000);

/** Piano retail convention: the price is VAT-inclusive — extract the tax part of it. */
export const vatInclusiveCents = (totalCents: number, taxRateBps: number): number => {
  const bps = Math.max(0, taxRateBps);
  if (bps <= 0) return 0;
  return Math.round((Math.max(0, totalCents) * bps) / (10_000 + bps));
};

/** Net revenue inside a VAT-inclusive price. */
export const netFromInclusiveCents = (totalCents: number, taxRateBps: number): number =>
  Math.max(0, totalCents) - vatInclusiveCents(totalCents, taxRateBps);

/* ============================================================
 * Posting builders (pure — the server validates & inserts)
 * ============================================================ */

export type JournalLegDraft = {
  accountId: string;
  debitCents: number;
  creditCents: number;
  lineMemo?: string | null;
};

const leg = (accountId: string, debitCents: number, creditCents: number, lineMemo?: string | null): JournalLegDraft => ({
  accountId,
  debitCents: Math.max(0, Math.round(debitCents)),
  creditCents: Math.max(0, Math.round(creditCents)),
  lineMemo: lineMemo ?? null,
});

/** The workhorse: money moves from one account to another. */
export const twoLeg = (
  debitAccountId: string,
  creditAccountId: string,
  cents: number,
  lineMemo?: string | null,
): JournalLegDraft[] => [leg(debitAccountId, cents, 0, lineMemo), leg(creditAccountId, 0, cents, lineMemo)];

/**
 * Billing event: receivable is established and revenue recognized.
 * Dr AR (total) · Cr Revenue (net) · Cr VAT Payable (tax).
 */
export const billingLegs = (input: {
  arId: string; revenueId: string; vatId: string; totalCents: number; revenueCents: number; taxCents: number;
}): JournalLegDraft[] => [
  leg(input.arId, input.totalCents, 0),
  leg(input.revenueId, 0, input.revenueCents),
  leg(input.vatId, 0, input.taxCents),
];

/**
 * Sale/pproject completion with deposits already held: deposits + any unpaid balance
 * become revenue. Dr Deposits Held (Σ payments) · Dr AR (remaining) · Cr Revenue (net) ·
 * Cr VAT Payable (tax).
 */
export const completionLegs = (input: {
  depositsId: string; arId: string; revenueId: string; vatId: string;
  paidCents: number; totalCents: number; revenueCents: number; taxCents: number;
}): JournalLegDraft[] => [
  leg(input.depositsId, input.paidCents, 0),
  leg(input.arId, Math.max(0, input.totalCents - input.paidCents), 0),
  leg(input.revenueId, 0, input.revenueCents),
  leg(input.vatId, 0, input.taxCents),
];

/** Loan payment splits principal from interest: Dr Loan + Dr Interest · Cr Wallet. */
export const loanPaymentLegs = (input: {
  loanId: string; interestExpenseId: string; walletId: string; principalCents: number; interestCents: number;
}): JournalLegDraft[] => [
  leg(input.loanId, input.principalCents, 0),
  leg(input.interestExpenseId, input.interestCents, 0),
  leg(input.walletId, 0, input.principalCents + input.interestCents),
];

/** A correction is the same legs with debit and credit swapped. */
export const reversedLegs = (legs: JournalLegDraft[]): JournalLegDraft[] =>
  legs.map((l) => leg(l.accountId, l.creditCents, l.debitCents, l.lineMemo));

/** True when Σ debits = Σ credits, every amount is a non-negative integer, and there are ≥ 2 legs. */
export function isBalanced(legs: JournalLegDraft[]): boolean {
  if (legs.length < 2) return false;
  let dr = 0;
  let cr = 0;
  for (const l of legs) {
    if (!Number.isInteger(l.debitCents) || !Number.isInteger(l.creditCents)) return false;
    if (l.debitCents < 0 || l.creditCents < 0) return false;
    if (l.debitCents > 0 && l.creditCents > 0) return false;
    if (l.accountId == null) return false;
    dr += l.debitCents;
    cr += l.creditCents;
  }
  return dr === cr;
}

/* ============================================================
 * Balances & statements
 * ============================================================ */

/** Signed movement for one account over a set of lines, respecting the account's nature. */
export const signedCents = (type: string, debitCents: number, creditCents: number): number =>
  isDebitNatured(type) ? debitCents - creditCents : creditCents - debitCents;

/** Running balance of an account: opening + signed sum of its lines. */
export const accountBalanceCents = (
  type: string,
  openingCents: number,
  debitCents: number,
  creditCents: number,
): number => openingCents + signedCents(type, debitCents, creditCents);

export type EquityStatement = {
  openingCents: number;
  capitalCents: number;
  retainedProfitCents: number;
  drawsCents: number;
  personalCents: number;
  /** opening + capital + retained − draws − personal */
  totalCents: number;
};

/** Owner's equity = opening + contributions + retained profit − draws − personal. */
export function equityStatement(input: {
  openingCents: number; capitalCents: number; retainedProfitCents: number; drawsCents: number; personalCents: number;
}): EquityStatement {
  const totalCents =
    input.openingCents + input.capitalCents + input.retainedProfitCents - input.drawsCents - input.personalCents;
  return { ...input, totalCents };
}

export type SafeToWithdraw = {
  retainedProfitCents: number;
  deductionsCents: number;
  /** retained profit − deductions; advisory only — draws are never blocked. */
  amountCents: number;
  parts: { label: string; cents: number }[];
};

/**
 * "Safe to withdraw": retained profit minus money that already belongs to someone else
 * (suppliers, BIR, customers with deposits, unpaid crew). Purely advisory.
 */
export function safeToWithdraw(input: {
  retainedProfitCents: number;
  drawsCents: number;
  personalCents: number;
  apCents: number;
  vatPayableCents: number;
  depositsHeldCents: number;
  unpaidWagesCents: number;
}): SafeToWithdraw {
  const parts = [
    { label: "Owner draws to date", cents: input.drawsCents },
    { label: "Personal expenses to date", cents: input.personalCents },
    { label: "Unpaid payables", cents: input.apCents },
    { label: "VAT payable", cents: input.vatPayableCents },
    { label: "Customer deposits held", cents: input.depositsHeldCents },
    { label: "Unpaid wages", cents: input.unpaidWagesCents },
  ];
  const deductionsCents = parts.reduce((s, p) => s + p.cents, 0);
  return {
    retainedProfitCents: input.retainedProfitCents,
    deductionsCents,
    amountCents: input.retainedProfitCents - deductionsCents,
    parts,
  };
}

/* ============================================================
 * Reconciliation math
 * ============================================================ */

export type ReconMath = {
  /** opening + Σ cleared lines (signed by account nature). */
  clearedBalanceCents: number;
  /** statement ending − cleared balance. Zero when fully reconciled. */
  differenceCents: number;
  /** Uncleared money moving INTO the account (in-transit deposits). */
  unclearedInCents: number;
  /** Uncleared money moving OUT (outstanding payments). */
  unclearedOutCents: number;
  reconciled: boolean;
};

/**
 * Manual statement reconciliation. The identity being checked is:
 * `statement ending = opening + Σ cleared lines`, so the difference is exactly the
 * net of the uncleared items plus any true discrepancy.
 */
export function reconMath(input: {
  type: string;
  openingCents: number;
  statementEndingCents: number;
  clearedDebitCents: number;
  clearedCreditCents: number;
  unclearedDebitCents: number;
  unclearedCreditCents: number;
}): ReconMath {
  const clearedBalanceCents =
    input.openingCents + signedCents(input.type, input.clearedDebitCents, input.clearedCreditCents);
  const differenceCents = input.statementEndingCents - clearedBalanceCents;
  const unclearedInCents = isDebitNatured(input.type) ? input.unclearedDebitCents : input.unclearedCreditCents;
  const unclearedOutCents = isDebitNatured(input.type) ? input.unclearedCreditCents : input.unclearedDebitCents;
  return {
    clearedBalanceCents,
    differenceCents,
    unclearedInCents,
    unclearedOutCents,
    reconciled: differenceCents === 0,
  };
}

/* ============================================================
 * Codes & Manila month keys
 * ============================================================ */

const pad = (n: number, width = 4) => String(Math.max(0, n)).padStart(width, "0");

/** `JE-2026-0007`. The year comes from the entry's own date (Manila), not "now". */
export function jeCode(entryNumber: number, date: Date | string | null | undefined): string {
  const d = date ? new Date(date) : new Date();
  return `JE-${ymd(d).slice(0, 4)}-${pad(entryNumber)}`;
}

/**
 * `"2026-09"` for the Manila wall-clock month containing `d`. All accounting month
 * bucketing goes through here — never `to_char(col,'YYYY-MM')`, which renders in the
 * container's UTC zone and mis-buckets 00:00–08:00 Manila on the 1st.
 */
export const monthKeyManila = (d: Date | string): string => ymd(new Date(d)).slice(0, 7);

/** First day (Manila) of the month containing `d`, as a UTC instant. */
export function startOfManilaMonthUTC(d: Date | string = new Date()): Date {
  const key = monthKeyManila(d);
  return new Date(`${key}-01T00:00:00+08:00`);
}

/** Default books start: first day of the current Manila month. */
export const defaultBooksStart = (now: Date = new Date()): Date => startOfManilaMonthUTC(now);

/** `"Sep 26"` for a month key. */
export function monthKeyLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return new Date(Date.UTC(y!, (m ?? 1) - 1, 1)).toLocaleDateString("en-US", {
    month: "short", year: "2-digit", timeZone: "UTC",
  });
}

/** The `n` month keys ending with the month containing `now` (Manila), oldest first.
 *  Key-string arithmetic, never `Date.setMonth` — day-of-month overflow silently rolls months. */
export function lastMonthKeys(now: Date, n: number): string[] {
  const [y, m] = monthKeyManila(now).split("-").map(Number);
  const keys: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const total = y! * 12 + (m! - 1) - i;
    keys.push(`${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`);
  }
  return keys;
}

/* ============================================================
 * Display helpers
 * ============================================================ */

/** Signed peso string for feeds: `+₱1,250` / `−₱300`. */
export const signedPeso = (cents: number): string =>
  `${cents < 0 ? "−" : "+"}${peso(Math.abs(cents))}`;

/** Journal `stream` for a manual kind (posting rules set it for bridge kinds). */
export const streamForKind = (kind: string): string => KIND_STREAM[kind] ?? "operations";
