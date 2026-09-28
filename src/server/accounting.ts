"use server";

/**
 * Owner Accounting **writes** — money that has no operational home: owner draws,
 * contributions, personal expenses, business overhead, transfers, loans, tax payments,
 * payable payments, wallets/settings/locks/exceptions, reconciliation, and entry voids.
 * Project billing and piano sales live in `accounting-billing.ts`.
 *
 * Every action authenticates with `requireUser()`, validates input with the repo's
 * runtime guards, enforces period locks, posts through the balanced-journal core, and
 * leaves an audit trail.
 */

import { revalidatePath } from "next/cache";
import { and, asc, desc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  accAccounts, accExceptions, accJournal, accJournalLines, accPeriodLocks, accReconciliations, accSettings,
  type AccAccount,
} from "@/db/schema";
import { requireUser } from "@/lib/auth";
import {
  KIND_STREAM, loanPaymentLegs, twoLeg,
} from "@/lib/accounting";
import { boolOr, intOr, moneyToCents, oneOf, optionalDate, str } from "@/lib/service";
import {
  PeriodLockedError, audit, getAccountingContext, postJournalEntry, voidJournalEntry,
} from "@/server/accounting-post";
import { runAccountingBridge } from "@/server/accounting-bridge";
import { computeReconState } from "@/server/accounting-data";
import { peso } from "@/lib/format";

type Result<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };
const ok = <T>(data?: T): Result<T> => ({ ok: true, data });
const fail = (error: string): Result<never> => ({ ok: false, error });

function touch() {
  revalidatePath("/admin", "layout");
}

/** Run a posting, converting lock/unbalance errors into friendly action results. */
async function post(input: Parameters<typeof postJournalEntry>[0]): Promise<Result> {
  try {
    await postJournalEntry(input);
    return ok();
  } catch (err) {
    if (err instanceof PeriodLockedError) return fail(err.message);
    if (err instanceof Error && err.message.includes("Unbalanced")) return fail("Entry failed its balance check — nothing was saved.");
    return fail(err instanceof Error ? err.message : "Could not record the entry.");
  }
}

async function activeWallet(id: string | null | undefined): Promise<AccAccount | null> {
  if (!id) return null;
  const [a] = await db.select().from(accAccounts).where(eq(accAccounts.id, id)).limit(1);
  return a && a.isWallet && a.active ? a : null;
}

async function systemAccount(key: string): Promise<AccAccount | null> {
  const [a] = await db.select().from(accAccounts).where(eq(accAccounts.systemKey, key)).limit(1);
  return a ?? null;
}

/* ============================================================
 * Owner money
 * ============================================================ */

/** Wallet opening balances are pre-books facts. Mirror them into Opening Equity's own
 *  opening so the balance sheet balances without journal lines dated before books start
 *  (same principle as the piano legacy-cost opening). Only ever called while the wallet
 *  has no journal lines, so history can never be rewritten. */
async function offsetOpeningEquity(deltaCents: number, actor: string): Promise<void> {
  if (deltaCents === 0) return;
  const [equity] = await db.select().from(accAccounts).where(eq(accAccounts.systemKey, "opening_equity")).limit(1);
  if (!equity) return;
  await db
    .update(accAccounts)
    .set({ openingBalanceCents: equity.openingBalanceCents + deltaCents, updatedAt: new Date() })
    .where(eq(accAccounts.id, equity.id));
  await audit({
    tableName: "acc_accounts", rowId: equity.id, action: "update", actor,
    note: `Wallet opening balance offset ${deltaCents > 0 ? "+" : ""}${deltaCents}`,
  });
}

export async function recordOwnerDraw(input: {
  amount?: number; walletId?: string; date?: string | null; category?: string | null; note?: string | null;
}): Promise<Result> {
  const user = await requireUser();
  const cents = moneyToCents(input.amount);
  if (cents <= 0) return fail("Enter an amount above zero.");
  const wallet = await activeWallet(input.walletId);
  if (!wallet) return fail("Pick a wallet to withdraw from.");
  const date = optionalDate(input.date) ?? new Date();
  const draws = await systemAccount("owner_draws");
  if (!draws) return fail("Accounting is not initialized yet — open the Accounting page once first.");
  const category = str(input.category, 80) ?? "General";
  const res = await post({
    occurredAt: date,
    kind: "owner_draw",
    stream: "owner",
    memo: `Owner draw — ${category}${input.note ? ` · ${str(input.note, 200)}` : ""}`,
    postedBy: user.name,
    legs: twoLeg(draws.id, wallet.id, cents),
  });
  if (res.ok) touch();
  return res;
}

export async function recordOwnerContribution(input: {
  amount?: number; walletId?: string; date?: string | null; note?: string | null;
}): Promise<Result> {
  const user = await requireUser();
  const cents = moneyToCents(input.amount);
  if (cents <= 0) return fail("Enter an amount above zero.");
  const wallet = await activeWallet(input.walletId);
  if (!wallet) return fail("Pick a wallet the money went into.");
  const date = optionalDate(input.date) ?? new Date();
  const capital = await systemAccount("capital");
  if (!capital) return fail("Accounting is not initialized yet — open the Accounting page once first.");
  const res = await post({
    occurredAt: date,
    kind: "owner_contribution",
    stream: "owner",
    memo: `Owner contribution${input.note ? ` · ${str(input.note, 200)}` : ""}`,
    postedBy: user.name,
    legs: twoLeg(wallet.id, capital.id, cents),
  });
  if (res.ok) touch();
  return res;
}

export async function recordPersonalExpense(input: {
  amount?: number; walletId?: string; date?: string | null; description?: string | null; note?: string | null;
}): Promise<Result> {
  const user = await requireUser();
  const cents = moneyToCents(input.amount);
  if (cents <= 0) return fail("Enter an amount above zero.");
  const description = str(input.description, 160);
  if (!description) return fail("Describe what this was for.");
  const wallet = await activeWallet(input.walletId);
  if (!wallet) return fail("Pick the wallet it was paid from.");
  const date = optionalDate(input.date) ?? new Date();
  const personal = await systemAccount("personal");
  if (!personal) return fail("Accounting is not initialized yet — open the Accounting page once first.");
  const res = await post({
    occurredAt: date,
    kind: "personal_expense",
    stream: "owner",
    memo: `Personal — ${description}`,
    postedBy: user.name,
    legs: twoLeg(personal.id, wallet.id, cents),
  });
  if (res.ok) touch();
  return res;
}

/* ============================================================
 * Business money (overhead / income / transfers / loans / tax / payables)
 * ============================================================ */

export async function recordBusinessExpense(input: {
  amount?: number; categoryId?: string; walletId?: string | null; date?: string | null;
  vendor?: string | null; description?: string | null; receiptUrl?: string | null; note?: string | null;
}): Promise<Result> {
  const user = await requireUser();
  const cents = moneyToCents(input.amount);
  if (cents <= 0) return fail("Enter an amount above zero.");
  const description = str(input.description, 200);
  if (!description) return fail("Describe the expense.");
  const [category] = input.categoryId
    ? await db.select().from(accAccounts).where(eq(accAccounts.id, input.categoryId)).limit(1)
    : [undefined];
  if (!category || category.type !== "expense") return fail("Pick an expense category.");
  const date = optionalDate(input.date) ?? new Date();
  const ap = await systemAccount("ap");
  if (!ap) return fail("Accounting is not initialized yet — open the Accounting page once first.");

  const unpaid = input.walletId === "unpaid" || input.walletId === null || input.walletId === undefined;
  let wallet: AccAccount | null = null;
  if (!unpaid) {
    wallet = await activeWallet(input.walletId);
    if (!wallet) return fail("Pick a wallet, or choose “Not paid yet”.");
  }
  const res = await post({
    occurredAt: date,
    kind: "business_expense",
    stream: "overhead",
    memo: `${category.name} — ${description}${input.vendor ? ` (${str(input.vendor, 120)})` : ""}`,
    postedBy: user.name,
    legs: twoLeg(category.id, wallet ? wallet.id : ap.id, cents),
  });
  if (res.ok) touch();
  return res;
}

export async function recordBusinessIncome(input: {
  amount?: number; walletId?: string; date?: string | null; description?: string | null;
}): Promise<Result> {
  const user = await requireUser();
  const cents = moneyToCents(input.amount);
  if (cents <= 0) return fail("Enter an amount above zero.");
  const description = str(input.description, 160);
  if (!description) return fail("Describe the income.");
  const wallet = await activeWallet(input.walletId);
  if (!wallet) return fail("Pick a wallet.");
  const date = optionalDate(input.date) ?? new Date();
  const income = await systemAccount("other_income");
  if (!income) return fail("Accounting is not initialized yet — open the Accounting page once first.");
  const res = await post({
    occurredAt: date,
    kind: "business_income",
    stream: "overhead",
    memo: `Other income — ${description}`,
    postedBy: user.name,
    legs: twoLeg(wallet.id, income.id, cents),
  });
  if (res.ok) touch();
  return res;
}

export async function recordTransfer(input: {
  amount?: number; fromWalletId?: string; toWalletId?: string; date?: string | null; note?: string | null;
}): Promise<Result> {
  const user = await requireUser();
  const cents = moneyToCents(input.amount);
  if (cents <= 0) return fail("Enter an amount above zero.");
  const from = await activeWallet(input.fromWalletId);
  const to = await activeWallet(input.toWalletId);
  if (!from || !to) return fail("Pick both wallets.");
  if (from.id === to.id) return fail("Pick two different wallets.");
  const date = optionalDate(input.date) ?? new Date();
  const res = await post({
    occurredAt: date,
    kind: "transfer",
    stream: "operations",
    memo: `Transfer ${from.name} → ${to.name}${input.note ? ` · ${str(input.note, 160)}` : ""}`,
    postedBy: user.name,
    legs: twoLeg(to.id, from.id, cents),
  });
  if (res.ok) touch();
  return res;
}

export async function recordLoanReceived(input: {
  amount?: number; loanAccountId?: string; walletId?: string; date?: string | null; note?: string | null;
}): Promise<Result> {
  const user = await requireUser();
  const cents = moneyToCents(input.amount);
  if (cents <= 0) return fail("Enter an amount above zero.");
  const [loan] = input.loanAccountId
    ? await db.select().from(accAccounts).where(eq(accAccounts.id, input.loanAccountId)).limit(1)
    : [undefined];
  if (!loan || loan.type !== "liability" || loan.isWallet) return fail("Pick (or create) a loan account.");
  const wallet = await activeWallet(input.walletId);
  if (!wallet) return fail("Pick a wallet the loan went into.");
  const date = optionalDate(input.date) ?? new Date();
  const res = await post({
    occurredAt: date,
    kind: "loan_received",
    stream: "financing",
    memo: `Loan received — ${loan.name}`,
    postedBy: user.name,
    legs: twoLeg(wallet.id, loan.id, cents),
  });
  if (res.ok) touch();
  return res;
}

export async function recordLoanPayment(input: {
  amount?: number; interest?: number; loanAccountId?: string; walletId?: string; date?: string | null;
}): Promise<Result> {
  const user = await requireUser();
  const total = moneyToCents(input.amount);
  const interest = Math.max(0, moneyToCents(input.interest));
  if (total <= 0) return fail("Enter a payment amount above zero.");
  if (interest > total) return fail("Interest cannot be larger than the whole payment.");
  const [loan] = input.loanAccountId
    ? await db.select().from(accAccounts).where(eq(accAccounts.id, input.loanAccountId)).limit(1)
    : [undefined];
  if (!loan || loan.type !== "liability" || loan.isWallet) return fail("Pick the loan being repaid.");
  const wallet = await activeWallet(input.walletId);
  if (!wallet) return fail("Pick the wallet paid from.");
  const interestAccount = await systemAccount("exp_interest");
  if (!interestAccount) return fail("Accounting is not initialized yet — open the Accounting page once first.");
  const date = optionalDate(input.date) ?? new Date();
  const res = await post({
    occurredAt: date,
    kind: "loan_payment",
    stream: "financing",
    memo: `Loan payment — ${loan.name}`,
    postedBy: user.name,
    legs: loanPaymentLegs({
      loanId: loan.id, interestExpenseId: interestAccount.id, walletId: wallet.id,
      principalCents: total - interest, interestCents: interest,
    }),
  });
  if (res.ok) touch();
  return res;
}

export async function recordTaxPayment(input: {
  amount?: number; walletId?: string; date?: string | null; reference?: string | null;
}): Promise<Result> {
  const user = await requireUser();
  const cents = moneyToCents(input.amount);
  if (cents <= 0) return fail("Enter an amount above zero.");
  const wallet = await activeWallet(input.walletId);
  if (!wallet) return fail("Pick the wallet paid from.");
  const vat = await systemAccount("vat_payable");
  if (!vat) return fail("Accounting is not initialized yet — open the Accounting page once first.");
  const date = optionalDate(input.date) ?? new Date();
  const res = await post({
    occurredAt: date,
    kind: "tax_payment",
    stream: "tax",
    memo: `Tax payment${input.reference ? ` — ${str(input.reference, 80)}` : ""}`,
    postedBy: user.name,
    legs: twoLeg(vat.id, wallet.id, cents),
  });
  if (res.ok) touch();
  return res;
}

export async function recordPayablePayment(input: {
  amount?: number; walletId?: string; date?: string | null; note?: string | null;
}): Promise<Result> {
  const user = await requireUser();
  const cents = moneyToCents(input.amount);
  if (cents <= 0) return fail("Enter an amount above zero.");
  const wallet = await activeWallet(input.walletId);
  if (!wallet) return fail("Pick the wallet paid from.");
  const ap = await systemAccount("ap");
  if (!ap) return fail("Accounting is not initialized yet — open the Accounting page once first.");
  const date = optionalDate(input.date) ?? new Date();
  const res = await post({
    occurredAt: date,
    kind: "ap_payment",
    stream: "operations",
    memo: `Paid a payable${input.note ? ` — ${str(input.note, 160)}` : ""}`,
    postedBy: user.name,
    legs: twoLeg(ap.id, wallet.id, cents),
  });
  if (res.ok) touch();
  return res;
}

export async function voidEntry(id: string, reason: string): Promise<Result> {
  const user = await requireUser();
  const why = str(reason, 300);
  if (!why) return fail("Give a reason — the audit trail keeps it.");
  try {
    const done = await voidJournalEntry(id, why, user.name);
    if (!done) return fail("Entry not found or already voided.");
    touch();
    return ok();
  } catch (err) {
    if (err instanceof Error) return fail(err.message);
    return fail("Could not void the entry.");
  }
}

/* ============================================================
 * Wallets & categories
 * ============================================================ */

export async function createWallet(input: {
  name?: string; walletKind?: string; openingBalance?: number; openingAsOf?: string | null;
}): Promise<Result<{ id: string }>> {
  const user = await requireUser();
  const name = str(input.name, 80);
  if (!name) return fail("Name the wallet.");
  const opening = Math.round(moneyToCents(input.openingBalance));
  const [row] = await db
    .insert(accAccounts)
    .values({
      name,
      type: "asset",
      isWallet: true,
      walletKind: oneOf(input.walletKind, ["cash", "bank", "ewallet", "other"] as const, "bank"),
      openingBalanceCents: opening,
      openingAsOf: optionalDate(input.openingAsOf) ?? new Date(),
      position: 50,
    })
    .returning({ id: accAccounts.id });
  await offsetOpeningEquity(opening, user.name);
  await audit({ tableName: "acc_accounts", rowId: row!.id, action: "create", after: { name, kind: input.walletKind }, actor: user.name });
  touch();
  return ok({ id: row!.id });
}

export async function updateWallet(input: {
  id: string; name?: string; walletKind?: string; openingBalance?: number; openingAsOf?: string | null; active?: boolean;
}): Promise<Result> {
  const user = await requireUser();
  const [account] = await db.select().from(accAccounts).where(eq(accAccounts.id, input.id)).limit(1);
  if (!account || !account.isWallet) return fail("Wallet not found.");

  const lineCount = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(accJournalLines)
    .where(eq(accJournalLines.accountId, account.id));
  const hasLines = (lineCount[0]?.n ?? 0) > 0;
  if (input.openingBalance !== undefined && hasLines) {
    return fail("This wallet already has transactions — adjust its opening with a journal entry instead.");
  }
  const newOpening = input.openingBalance !== undefined ? Math.round(moneyToCents(input.openingBalance)) : null;
  if (newOpening !== null && newOpening !== account.openingBalanceCents) {
    await offsetOpeningEquity(newOpening - account.openingBalanceCents, user.name);
  }

  if (input.active === false) {
    const [settings] = await db.select().from(accSettings).limit(1);
    const inUse =
      settings?.payrollAccountId === account.id || Object.values(settings?.methodMap ?? {}).includes(account.id);
    if (inUse) return fail("This wallet is still used by the payment-method map or payroll — remap it first.");
  }

  await db
    .update(accAccounts)
    .set({
      name: input.name !== undefined ? str(input.name, 80) ?? account.name : undefined,
      walletKind: input.walletKind !== undefined ? oneOf(input.walletKind, ["cash", "bank", "ewallet", "other"] as const, "bank") : undefined,
      openingBalanceCents: input.openingBalance !== undefined ? Math.round(moneyToCents(input.openingBalance)) : undefined,
      openingAsOf: input.openingAsOf !== undefined ? optionalDate(input.openingAsOf) ?? account.openingAsOf : undefined,
      active: input.active !== undefined ? boolOr(input.active, account.active) : undefined,
      updatedAt: new Date(),
    })
    .where(eq(accAccounts.id, account.id));
  await audit({ tableName: "acc_accounts", rowId: account.id, action: "update", before: { name: account.name, active: account.active }, actor: user.name });
  touch();
  return ok();
}

export async function createLoanAccount(name: string): Promise<Result<{ id: string }>> {
  const user = await requireUser();
  const clean = str(name, 80);
  if (!clean) return fail("Name the loan (e.g. “Loan — BPI”).");
  const [row] = await db
    .insert(accAccounts)
    .values({ name: clean, type: "liability", position: 60 })
    .returning({ id: accAccounts.id });
  await audit({ tableName: "acc_accounts", rowId: row!.id, action: "create", after: { name: clean, type: "liability" }, actor: user.name });
  touch();
  return ok({ id: row!.id });
}

export async function createExpenseCategory(name: string): Promise<Result<{ id: string }>> {
  const user = await requireUser();
  const clean = str(name, 80);
  if (!clean) return fail("Name the category.");
  const [row] = await db
    .insert(accAccounts)
    .values({ name: clean, type: "expense", position: 200 })
    .returning({ id: accAccounts.id });
  await audit({ tableName: "acc_accounts", rowId: row!.id, action: "create", after: { name: clean, type: "expense" }, actor: user.name });
  touch();
  return ok({ id: row!.id });
}

export async function renameAccount(id: string, name: string): Promise<Result> {
  const user = await requireUser();
  const clean = str(name, 80);
  if (!clean) return fail("Name the account.");
  const [account] = await db.select().from(accAccounts).where(eq(accAccounts.id, id)).limit(1);
  if (!account) return fail("Account not found.");
  await db.update(accAccounts).set({ name: clean, updatedAt: new Date() }).where(eq(accAccounts.id, id));
  await audit({ tableName: "acc_accounts", rowId: id, action: "update", before: { name: account.name }, after: { name: clean }, actor: user.name });
  touch();
  return ok();
}

export async function setAccountActive(id: string, active: boolean): Promise<Result> {
  const user = await requireUser();
  const [account] = await db.select().from(accAccounts).where(eq(accAccounts.id, id)).limit(1);
  if (!account) return fail("Account not found.");
  if (account.systemKey && !account.isWallet) return fail("Built-in book accounts cannot be deactivated.");
  if (!active && account.isWallet) return updateWallet({ id, active: false });
  await db.update(accAccounts).set({ active, updatedAt: new Date() }).where(eq(accAccounts.id, id));
  await audit({ tableName: "acc_accounts", rowId: id, action: "update", before: { active: account.active }, after: { active }, actor: user.name });
  touch();
  return ok();
}

/* ============================================================
 * Settings, locks, exceptions, sync
 * ============================================================ */

export async function updateMethodMap(patch: Record<string, string>): Promise<Result> {
  const user = await requireUser();
  const entries = Object.entries(patch);
  for (const [method, accountId] of entries) {
    const wallet = await activeWallet(accountId);
    if (!wallet) return fail(`Pick an active wallet for “${method}”.`);
  }
  const [settings] = await db.select().from(accSettings).where(eq(accSettings.ownerId, user.id)).limit(1);
  if (!settings) return fail("Accounting is not initialized yet.");
  await db
    .update(accSettings)
    .set({ methodMap: { ...settings.methodMap, ...patch }, updatedAt: new Date() })
    .where(eq(accSettings.ownerId, user.id));
  await audit({ tableName: "acc_settings", rowId: user.id, action: "update", before: { methodMap: settings.methodMap }, after: { patch }, actor: user.name });
  touch();
  return ok();
}

export async function updatePayrollAccount(accountId: string): Promise<Result> {
  const user = await requireUser();
  const wallet = await activeWallet(accountId);
  if (!wallet) return fail("Pick an active wallet for payroll payouts.");
  await db
    .update(accSettings)
    .set({ payrollAccountId: wallet.id, updatedAt: new Date() })
    .where(eq(accSettings.ownerId, user.id));
  await audit({ tableName: "acc_settings", rowId: user.id, action: "update", after: { payrollAccountId: wallet.id }, actor: user.name });
  touch();
  return ok();
}

export async function updateBooksStartDate(dateLocal: string): Promise<Result> {
  const user = await requireUser();
  const date = optionalDate(dateLocal);
  if (!date) return fail("Pick a valid date.");
  const [settings] = await db.select().from(accSettings).where(eq(accSettings.ownerId, user.id)).limit(1);
  if (!settings) return fail("Accounting is not initialized yet.");
  await db
    .update(accSettings)
    .set({ booksStartDate: date, updatedAt: new Date() })
    .where(eq(accSettings.ownerId, user.id));
  await audit({
    tableName: "acc_settings", rowId: user.id, action: "update",
    before: { booksStartDate: settings.booksStartDate.toISOString() },
    after: { booksStartDate: date.toISOString() },
    actor: user.name,
    note: "Moving the start date changes which past events the bridge posts — re-check reports.",
  });
  touch();
  return ok();
}

export async function lockPeriod(year: number, month: number, note?: string): Promise<Result> {
  const user = await requireUser();
  const y = intOr(year, 0);
  const m = intOr(month, 0);
  if (y < 2020 || y > 2100 || m < 1 || m > 12) return fail("Pick a valid month.");
  const existing = await db
    .select({ id: accPeriodLocks.id })
    .from(accPeriodLocks)
    .where(and(eq(accPeriodLocks.year, y), eq(accPeriodLocks.month, m)))
    .limit(1);
  if (existing.length) return fail("That month is already locked.");
  const [row] = await db
    .insert(accPeriodLocks)
    .values({ year: y, month: m, lockedBy: user.name, note: str(note, 200) })
    .returning({ id: accPeriodLocks.id });
  await audit({ tableName: "acc_period_locks", rowId: row!.id, action: "lock", after: { year: y, month: m }, actor: user.name });
  touch();
  return ok();
}

export async function unlockPeriod(id: string): Promise<Result> {
  const user = await requireUser();
  const [lock] = await db.select().from(accPeriodLocks).where(eq(accPeriodLocks.id, id)).limit(1);
  if (!lock) return fail("Lock not found.");
  await db.delete(accPeriodLocks).where(eq(accPeriodLocks.id, id));
  await audit({
    tableName: "acc_period_locks", rowId: id, action: "unlock",
    before: { year: lock.year, month: lock.month }, actor: user.name,
    note: "Period unlocked — changes in this month are possible again.",
  });
  touch();
  return ok();
}

export async function resolveException(id: string): Promise<Result> {
  const user = await requireUser();
  await db
    .update(accExceptions)
    .set({ status: "resolved", resolvedAt: new Date() })
    .where(eq(accExceptions.id, id));
  await audit({ tableName: "acc_exceptions", rowId: id, action: "resolve", actor: user.name });
  touch();
  return ok();
}

export async function syncNow(): Promise<Result<{ posted: number; voided: number; exceptions: number }>> {
  const user = await requireUser();
  const res = await runAccountingBridge(user.id, user.name, true);
  touch();
  return ok({ posted: res.posted, voided: res.voided, exceptions: res.exceptions });
}

/* ============================================================
 * Reconciliation
 * ============================================================ */

export async function startReconciliation(input: {
  accountId?: string; statementDate?: string | null; statementEnding?: number;
}): Promise<Result<{ id: string }>> {
  const user = await requireUser();
  const [account] = input.accountId
    ? await db.select().from(accAccounts).where(eq(accAccounts.id, input.accountId)).limit(1)
    : [undefined];
  if (!account || !account.isWallet) return fail("Pick a wallet to reconcile.");
  const date = optionalDate(input.statementDate);
  if (!date) return fail("Pick the statement date.");
  const ending = moneyToCents(input.statementEnding);
  const open = await db
    .select({ id: accReconciliations.id })
    .from(accReconciliations)
    .where(and(eq(accReconciliations.accountId, account.id), eq(accReconciliations.status, "open")))
    .limit(1);
  if (open.length) return fail("Finish the open reconciliation for this wallet first.");
  const [row] = await db
    .insert(accReconciliations)
    .values({ accountId: account.id, statementDate: date, statementEndingCents: ending })
    .returning({ id: accReconciliations.id });
  await audit({
    tableName: "acc_reconciliations", rowId: row!.id, action: "create",
    after: { accountId: account.id, statementDate: date.toISOString(), statementEndingCents: ending }, actor: user.name,
  });
  touch();
  return ok({ id: row!.id });
}

export async function setLineCleared(lineId: string, cleared: boolean): Promise<Result> {
  await requireUser();
  const [line] = await db.select().from(accJournalLines).where(eq(accJournalLines.id, lineId)).limit(1);
  if (!line) return fail("Line not found.");
  // The line's account must have an open reconciliation.
  const [recon] = await db
    .select()
    .from(accReconciliations)
    .where(and(eq(accReconciliations.accountId, line.accountId), eq(accReconciliations.status, "open")))
    .limit(1);
  if (!recon) return fail("No open reconciliation for this account.");

  const [entry] = await db
    .select({ occurredAt: accJournal.occurredAt })
    .from(accJournal)
    .where(eq(accJournal.id, line.journalId))
    .limit(1);
  if (!entry || entry.occurredAt.getTime() > recon.statementDate.getTime()) {
    return fail("That line is after the statement date.");
  }

  if (cleared) {
    if (line.clearedAt && line.reconciliationId !== recon.id) return fail("Already cleared in an earlier reconciliation.");
    await db
      .update(accJournalLines)
      .set({ clearedAt: new Date(), reconciliationId: recon.id })
      .where(eq(accJournalLines.id, lineId));
  } else {
    if (line.reconciliationId && line.reconciliationId !== recon.id) {
      return fail("That line was cleared in a completed reconciliation — it can no longer be changed.");
    }
    await db
      .update(accJournalLines)
      .set({ clearedAt: null, reconciliationId: null })
      .where(eq(accJournalLines.id, lineId));
  }
  touch();
  return ok();
}

export async function completeReconciliation(id: string, note?: string): Promise<Result> {
  const user = await requireUser();
  const [recon] = await db.select().from(accReconciliations).where(eq(accReconciliations.id, id)).limit(1);
  if (!recon || recon.status !== "open") return fail("Open reconciliation not found.");
  const [account] = await db.select().from(accAccounts).where(eq(accAccounts.id, recon.accountId)).limit(1);
  if (!account) return fail("Account not found.");

  const state = await computeReconState(recon.accountId, recon.statementDate, recon.statementEndingCents);
  if (!state) return fail("Could not compute the reconciliation.");
  if (state.differenceCents !== 0) {
    const why = str(note, 300);
    if (!why || why.length < 10) {
      return fail(`Difference is ${peso(state.differenceCents)} — clear the remaining lines, or write a note (10+ characters) to close with the difference.`);
    }
  }

  await db
    .update(accReconciliations)
    .set({
      status: "completed",
      completedAt: new Date(),
      completedBy: user.name,
      notes: str(note, 300),
      bookBalanceCents: state.bookBalanceCents,
      clearedBalanceCents: state.clearedBalanceCents,
      differenceCents: state.differenceCents,
    })
    .where(eq(accReconciliations.id, id));
  await audit({
    tableName: "acc_reconciliations", rowId: id, action: "reconcile",
    after: { differenceCents: state.differenceCents, statementEndingCents: recon.statementEndingCents }, actor: user.name,
  });
  touch();
  return ok();
}

export async function cancelReconciliation(id: string): Promise<Result> {
  const user = await requireUser();
  const [recon] = await db.select().from(accReconciliations).where(eq(accReconciliations.id, id)).limit(1);
  if (!recon || recon.status !== "open") return fail("Open reconciliation not found.");
  await db
    .update(accJournalLines)
    .set({ clearedAt: null, reconciliationId: null })
    .where(eq(accJournalLines.reconciliationId, id));
  await db.delete(accReconciliations).where(eq(accReconciliations.id, id));
  await audit({ tableName: "acc_reconciliations", rowId: id, action: "delete", before: { status: "open" }, actor: user.name, note: "Reconciliation cancelled" });
  touch();
  return ok();
}
