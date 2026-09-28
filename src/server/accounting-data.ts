/**
 * Owner Accounting **reads** — grouped by page. Writes live in `accounting.ts` /
 * `accounting-billing.ts`; posting core in `accounting-post.ts`; the bridge runs lazily
 * from here so accounting pages are always current without touching the Service module.
 *
 * Aggregation rule: voided entries stay in sums (every void carries a reversal entry, so
 * pairs net to zero and cleared-statement history stays intact).
 */

import { and, asc, desc, eq, gte, inArray, isNull, isNotNull, lt, lte, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  accAccounts, accExceptions, accJournal, accJournalLines, accPeriodLocks, accReconciliations,
  payments, pianoCostEntries, pianoPayments, pianoSales, pianos, projectCosts, projectItems,
  projectPayments, projects, serviceCustomers, serviceInvoices, tasks, timeEntries, workers,
  accSettings as accSettingsTable,
  type AccAccount, type AccSettings, type User,
} from "@/db/schema";
import {
  accountBalanceCents, equityStatement, lastMonthKeys, monthKeyManila, netFromInclusiveCents,
  reconMath, safeToWithdraw, signedCents, startOfManilaMonthUTC, vatExclusiveCents, vatInclusiveCents,
  type EquityStatement, type SafeToWithdraw,
} from "@/lib/accounting";
import { agingSummary, balanceCents, daysOverdue, type AgingSummary } from "@/lib/service";
import { getAccountingContext, type AccContext } from "@/server/accounting-post";
import { runAccountingBridge } from "@/server/accounting-bridge";

/* ============================================================
 * Shared helpers
 * ============================================================ */

type Agg = { debitCents: number; creditCents: number };

async function accountAggregates(): Promise<Map<string, Agg>> {
  const rows = await db
    .select({
      accountId: accJournalLines.accountId,
      debit: sql<number>`coalesce(sum(${accJournalLines.debitCents}), 0)::int`,
      credit: sql<number>`coalesce(sum(${accJournalLines.creditCents}), 0)::int`,
    })
    .from(accJournalLines)
    .groupBy(accJournalLines.accountId);
  return new Map(rows.map((r) => [r.accountId, { debitCents: r.debit, creditCents: r.credit }]));
}

const balanceOf = (a: AccAccount, agg: Agg | undefined): number =>
  accountBalanceCents(a.type, a.openingBalanceCents, agg?.debitCents ?? 0, agg?.creditCents ?? 0);

type ActivityRow = {
  journalId: string; entryNumber: number; occurredAt: Date; kind: string; stream: string;
  memo: string | null; voidedAt: Date | null; reversalOfId: string | null;
  accountId: string; accountType: string; accountName: string; isWallet: boolean;
  debitCents: number; creditCents: number;
};

async function activitySince(since: Date): Promise<ActivityRow[]> {
  return db
    .select({
      journalId: accJournal.id, entryNumber: accJournal.entryNumber, occurredAt: accJournal.occurredAt,
      kind: accJournal.kind, stream: accJournal.stream, memo: accJournal.memo,
      voidedAt: accJournal.voidedAt, reversalOfId: accJournal.reversalOfId,
      accountId: accJournalLines.accountId, accountType: accAccounts.type, accountName: accAccounts.name,
      isWallet: accAccounts.isWallet, debitCents: accJournalLines.debitCents, creditCents: accJournalLines.creditCents,
    })
    .from(accJournalLines)
    .innerJoin(accJournal, eq(accJournal.id, accJournalLines.journalId))
    .innerJoin(accAccounts, eq(accAccounts.id, accJournalLines.accountId))
    .where(gte(accJournal.occurredAt, since))
    .orderBy(asc(accJournal.occurredAt), asc(accJournal.entryNumber));
}

/** Month range as UTC instants for a "YYYY-MM" Manila month key. */
function monthRange(key: string): { start: Date; end: Date } {
  const start = new Date(`${key}-01T00:00:00+08:00`);
  const [y, m] = key.split("-").map(Number);
  const end = new Date(Date.UTC(y!, m!, 1) - 8 * 3_600_000); // 1st of next month, Manila
  return { start, end };
}

export type JournalFeedItem = {
  id: string; code: string; occurredAt: string; kind: string; stream: string; memo: string | null;
  voided: boolean; voidReason: string | null; isCorrection: boolean;
  walletInCents: number; walletOutCents: number;
  sourceType: string | null; sourceId: string | null;
  legs: { accountId: string; accountName: string; type: string; debitCents: number; creditCents: number }[];
};

function toFeedItems(
  entries: (typeof accJournal.$inferSelect)[],
  lines: (typeof accJournalLines.$inferSelect)[],
  accountsById: Map<string, AccAccount>,
): JournalFeedItem[] {
  const byJournal = new Map<string, typeof lines>();
  for (const l of lines) {
    const list = byJournal.get(l.journalId) ?? [];
    list.push(l);
    byJournal.set(l.journalId, list);
  }
  return entries.map((e) => {
    const eLines = byJournal.get(e.id) ?? [];
    const legs = eLines.map((l) => {
      const acc = accountsById.get(l.accountId);
      return { accountId: l.accountId, accountName: acc?.name ?? "?", type: acc?.type ?? "asset", debitCents: l.debitCents, creditCents: l.creditCents };
    });
    const walletInCents = eLines.reduce((s, l) => (accountsById.get(l.accountId)?.isWallet ? s + l.debitCents : s), 0);
    const walletOutCents = eLines.reduce((s, l) => (accountsById.get(l.accountId)?.isWallet ? s + l.creditCents : s), 0);
    return {
      id: e.id,
      code: `JE-${e.occurredAt.getUTCFullYear()}-${String(e.entryNumber).padStart(4, "0")}`,
      occurredAt: e.occurredAt.toISOString(),
      kind: e.kind, stream: e.stream, memo: e.memo,
      voided: !!e.voidedAt, voidReason: e.voidReason, isCorrection: !!e.reversalOfId,
      walletInCents, walletOutCents, sourceType: e.sourceType, sourceId: e.sourceId,
      legs,
    };
  });
}

async function journalFeed(opts: {
  limit?: number; accountId?: string; kinds?: string[]; stream?: string; monthKey?: string; q?: string;
  since?: Date;
}): Promise<JournalFeedItem[]> {
  const clauses = [];
  if (opts.kinds?.length) clauses.push(inArray(accJournal.kind, opts.kinds));
  if (opts.stream) clauses.push(eq(accJournal.stream, opts.stream));
  if (opts.monthKey) {
    const { start, end } = monthRange(opts.monthKey);
    clauses.push(gte(accJournal.occurredAt, start), lt(accJournal.occurredAt, end));
  } else if (opts.since) {
    clauses.push(gte(accJournal.occurredAt, opts.since));
  }
  if (opts.q) clauses.push(sql`(${accJournal.memo} ilike ${`%${opts.q}%`} or ${accJournal.kind} ilike ${`%${opts.q}%`})`);
  const entries = await db
    .select()
    .from(accJournal)
    .where(clauses.length ? and(...clauses) : undefined)
    .orderBy(desc(accJournal.occurredAt), desc(accJournal.entryNumber))
    .limit(opts.limit ?? 100);
  if (!entries.length) return [];
  const [lines, accounts] = await Promise.all([
    db.select().from(accJournalLines).where(inArray(accJournalLines.journalId, entries.map((e) => e.id))),
    db.select().from(accAccounts),
  ]);
  return toFeedItems(entries, lines, new Map(accounts.map((a) => [a.id, a])));
}

/* ============================================================
 * Receivables / deposits / wages (operational sub-ledgers)
 * ============================================================ */

export type ServiceArRow = {
  invoiceId: string; number: number; customerName: string; totalCents: number; paidCents: number;
  balanceCents: number; dueDate: string | null; daysOverdue: number; status: string;
};

async function serviceReceivables(now: Date): Promise<{ rows: ServiceArRow[]; aging: AgingSummary }> {
  const rows = await db
    .select({
      inv: serviceInvoices, customerName: serviceCustomers.name,
    })
    .from(serviceInvoices)
    .innerJoin(serviceCustomers, eq(serviceCustomers.id, serviceInvoices.customerId))
    .where(isNull(serviceInvoices.voidedAt));
  const arRows: ServiceArRow[] = rows
    .map(({ inv, customerName }) => {
      const bal = balanceCents(inv);
      return {
        invoiceId: inv.id, number: inv.invoiceNumber, customerName,
        totalCents: inv.totalCents, paidCents: inv.amountPaidCents, balanceCents: bal,
        dueDate: inv.dueDate ? inv.dueDate.toISOString() : null,
        daysOverdue: daysOverdue(inv, now), status: inv.sentAt ? "sent" : "draft",
      };
    })
    .filter((r) => r.balanceCents > 0);
  return { rows: arRows, aging: agingSummary(rows.map((r) => r.inv), now) };
}

export type ProjectArRow = {
  projectId: string; label: string; contractCents: number; paidCents: number; balanceCents: number;
  finalized: boolean; status: string;
};

async function projectReceivables(): Promise<ProjectArRow[]> {
  const [rows, payRows] = await Promise.all([
    db.select().from(projects).where(ne(projects.status, "cancelled")),
    db
      .select({ projectId: projectPayments.projectId, paid: sql<number>`coalesce(sum(${projectPayments.amountCents}), 0)::int` })
      .from(projectPayments)
      .where(isNull(projectPayments.voidedAt))
      .groupBy(projectPayments.projectId),
  ]);
  const paidMap = new Map(payRows.map((r) => [r.projectId, r.paid]));
  return rows
    .map((p) => {
      const base = p.billingFinalizedAt ? (p.billedCents ?? p.quotedCents) : p.quotedCents;
      const contract = base + vatExclusiveCents(base, p.taxRateBps);
      const paid = paidMap.get(p.id) ?? 0;
      return {
        projectId: p.id,
        label: `${p.pianoBrand} ${p.pianoModel} — ${p.clientName}`,
        contractCents: contract, paidCents: paid, balanceCents: Math.max(0, contract - paid),
        finalized: !!p.billingFinalizedAt, status: p.status,
      };
    })
    .filter((r) => r.balanceCents > 0 || !r.finalized);
}

export type PianoArRow = {
  saleId: string; pianoId: string; label: string; priceCents: number; paidCents: number;
  balanceCents: number; status: string; buyerName: string | null;
};

async function pianoReceivables(): Promise<PianoArRow[]> {
  const rows = await db
    .select({ sale: pianoSales, brand: pianos.brand, model: pianos.model })
    .from(pianoSales)
    .innerJoin(pianos, eq(pianos.id, pianoSales.pianoId))
    .where(ne(pianoSales.status, "cancelled"));
  const saleIds = rows.map((r) => r.sale.id);
  const payRows = saleIds.length
    ? await db
        .select({ saleId: pianoPayments.saleId, paid: sql<number>`coalesce(sum(${pianoPayments.amountCents}), 0)::int` })
        .from(pianoPayments)
        .where(isNull(pianoPayments.voidedAt))
        .groupBy(pianoPayments.saleId)
    : [];
  const paidMap = new Map(payRows.map((r) => [r.saleId, r.paid]));
  return rows.map(({ sale, brand, model }) => {
    const paid = paidMap.get(sale.id) ?? 0;
    return {
      saleId: sale.id, pianoId: sale.pianoId,
      label: `${brand} ${model}`, priceCents: sale.priceCents, paidCents: paid,
      balanceCents: Math.max(0, sale.priceCents - paid), status: sale.status, buyerName: sale.buyerName,
    };
  });
}

export type DepositRow = { source: "project" | "piano"; label: string; amountCents: number; date: string };

async function depositsHeld(): Promise<DepositRow[]> {
  const [projRows, pianoRows] = await Promise.all([
    db
      .select({
        amount: sql<number>`coalesce(sum(${projectPayments.amountCents}), 0)::int`,
        clientName: projects.clientName, brand: projects.pianoBrand, model: projects.pianoModel,
        last: sql<string>`max(${projectPayments.receivedAt})`,
      })
      .from(projectPayments)
      .innerJoin(projects, eq(projects.id, projectPayments.projectId))
      .where(and(isNull(projectPayments.voidedAt), isNull(projects.billingFinalizedAt)))
      .groupBy(projects.id, projects.clientName, projects.pianoBrand, projects.pianoModel),
    db
      .select({
        amount: sql<number>`coalesce(sum(${pianoPayments.amountCents}), 0)::int`,
        brand: pianos.brand, model: pianos.model, buyer: pianoSales.buyerName,
        last: sql<string>`max(${pianoPayments.receivedAt})`,
      })
      .from(pianoPayments)
      .innerJoin(pianoSales, eq(pianoSales.id, pianoPayments.saleId))
      .innerJoin(pianos, eq(pianos.id, pianoSales.pianoId))
      .where(and(isNull(pianoPayments.voidedAt), eq(pianoSales.status, "reserved")))
      .groupBy(pianoSales.id, pianos.brand, pianos.model, pianoSales.buyerName),
  ]);
  return [
    ...projRows.map((r) => ({ source: "project" as const, label: `${r.brand} ${r.model} — ${r.clientName}`, amountCents: r.amount, date: new Date(r.last!).toISOString() })),
    ...pianoRows.map((r) => ({ source: "piano" as const, label: `${r.brand} ${r.model}${r.buyer ? ` — ${r.buyer}` : ""}`, amountCents: r.amount, date: new Date(r.last!).toISOString() })),
  ].filter((r) => r.amountCents > 0);
}

/** Earned-but-unpaid shop wages from closed shifts (advisory liability for the owner). */
async function unpaidWagesCents(): Promise<number> {
  const rows = await db
    .select({
      clockIn: timeEntries.clockIn, clockOut: timeEntries.clockOut, breakMinutes: timeEntries.breakMinutes,
      rate: timeEntries.rateAtClockInCents, paidCents: timeEntries.paidCents,
    })
    .from(timeEntries)
    .where(isNotNull(timeEntries.clockOut));
  let total = 0;
  for (const r of rows) {
    const hours = Math.max(0, (r.clockOut!.getTime() - r.clockIn.getTime()) / 3_600_000 - r.breakMinutes / 60);
    const earned = Math.round(hours * r.rate);
    total += Math.max(0, earned - r.paidCents);
  }
  return total;
}

/* ============================================================
 * P&L / cash cuts (pure assembly over activity rows)
 * ============================================================ */

type PnlCut = {
  revenueCents: number; expenseCents: number; netCents: number;
  revenueByStream: Record<string, number>; expenseByStream: Record<string, number>;
};

function pnlCut(rows: ActivityRow[]): PnlCut {
  const cut: PnlCut = { revenueCents: 0, expenseCents: 0, netCents: 0, revenueByStream: {}, expenseByStream: {} };
  for (const r of rows) {
    const signed = signedCents(r.accountType, r.debitCents, r.creditCents);
    if (r.accountType === "revenue") {
      cut.revenueCents += signed;
      cut.revenueByStream[r.stream] = (cut.revenueByStream[r.stream] ?? 0) + signed;
    } else if (r.accountType === "expense") {
      cut.expenseCents += signed;
      cut.expenseByStream[r.stream] = (cut.expenseByStream[r.stream] ?? 0) + signed;
    }
  }
  cut.netCents = cut.revenueCents - cut.expenseCents;
  return cut;
}

type CashCut = { inCents: number; outCents: number; netCents: number; byStream: Record<string, { inCents: number; outCents: number }> };

function cashCut(rows: ActivityRow[]): CashCut {
  const cut: CashCut = { inCents: 0, outCents: 0, netCents: 0, byStream: {} };
  for (const r of rows) {
    if (!r.isWallet) continue;
    const bucket = (cut.byStream[r.stream] ??= { inCents: 0, outCents: 0 });
    bucket.inCents += r.debitCents;
    bucket.outCents += r.creditCents;
    cut.inCents += r.debitCents;
    cut.outCents += r.creditCents;
  }
  cut.netCents = cut.inCents - cut.outCents;
  return cut;
}

/* ============================================================
 * Overview
 * ============================================================ */

export type WalletSummary = {
  id: string; name: string; walletKind: string | null; active: boolean; balanceCents: number;
  lastReconciledAt: string | null; lastDifferenceCents: number | null; hasOpenRecon: boolean;
};

export type OverviewBundle = {
  booksStart: string;
  wallets: WalletSummary[];
  totalCashCents: number;
  month: { key: string; label: string; cash: CashCut; pnl: PnlCut };
  booksToDate: PnlCut;
  equity: EquityStatement;
  safeToWithdraw: SafeToWithdraw;
  serviceAr: { outstandingCents: number; overdueCents: number; count: number };
  projectArCents: number;
  pianoArCents: number;
  depositsHeldCents: number;
  depositsList: DepositRow[];
  unpaidWagesCents: number;
  recent: JournalFeedItem[];
  openExceptions: number;
};

export async function getOverview(user: User): Promise<OverviewBundle> {
  await runAccountingBridge(user.id, user.name);
  const ctx = await getAccountingContext(user.id);
  const now = new Date();
  const monthStart = startOfManilaMonthUTC(now);

  const [aggs, activity, reconRows, exceptionsCount] = await Promise.all([
    accountAggregates(),
    activitySince(ctx.settings.booksStartDate),
    db.select().from(accReconciliations),
    db.select({ n: sql<number>`count(*)::int` }).from(accExceptions).where(eq(accExceptions.status, "open")),
  ]);

  const walletIds = new Set(ctx.wallets.map((w) => w.id));
  const wallets: WalletSummary[] = ctx.wallets.map((w) => {
    const recons = reconRows
      .filter((r) => r.accountId === w.id)
      .sort((a, b) => b.statementDate.getTime() - a.statementDate.getTime());
    const lastDone = recons.find((r) => r.status === "completed");
    return {
      id: w.id, name: w.name, walletKind: w.walletKind, active: w.active,
      balanceCents: balanceOf(w, aggs.get(w.id)),
      lastReconciledAt: lastDone?.statementDate.toISOString() ?? null,
      lastDifferenceCents: lastDone?.differenceCents ?? null,
      hasOpenRecon: recons.some((r) => r.status === "open"),
    };
  });

  const monthRows = activity.filter((r) => r.occurredAt.getTime() >= monthStart.getTime());
  const pnl = pnlCut(activity);
  const [svcAr, projAr, pianoAr, depList, wages] = await Promise.all([
    serviceReceivables(now), projectReceivables(), pianoReceivables(), depositsHeld(), unpaidWagesCents(),
  ]);

  const systemBalance = (key: string): number => {
    const acc = ctx.byKey.get(key);
    return acc ? balanceOf(acc, aggs.get(acc.id)) : 0;
  };
  // Draws/personal are equity accounts that grow by debit — report their magnitude.
  const magnitude = (key: string): number => {
    const acc = ctx.byKey.get(key);
    if (!acc) return 0;
    const agg = aggs.get(acc.id);
    return (agg?.debitCents ?? 0) - (agg?.creditCents ?? 0);
  };

  const equity = equityStatement({
    openingCents: systemBalance("opening_equity"),
    capitalCents: systemBalance("capital"),
    retainedProfitCents: pnl.netCents,
    drawsCents: magnitude("owner_draws"),
    personalCents: magnitude("personal"),
  });
  const depositsCents = Math.max(0, systemBalance("deposits_held"));

  return {
    booksStart: ctx.settings.booksStartDate.toISOString(),
    wallets,
    totalCashCents: wallets.reduce((s, w) => s + (w.active ? w.balanceCents : 0), 0),
    month: {
      key: monthKeyManila(now),
      label: new Date().toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "Asia/Manila" }),
      cash: cashCut(monthRows),
      pnl: pnlCut(monthRows),
    },
    booksToDate: pnl,
    equity,
    safeToWithdraw: safeToWithdraw({
      retainedProfitCents: pnl.netCents,
      drawsCents: magnitude("owner_draws"),
      personalCents: magnitude("personal"),
      apCents: Math.max(0, systemBalance("ap")),
      vatPayableCents: Math.max(0, systemBalance("vat_payable")),
      depositsHeldCents: depositsCents,
      unpaidWagesCents: wages,
    }),
    serviceAr: {
      outstandingCents: svcAr.aging.totalOutstandingCents,
      overdueCents: svcAr.aging.overdueCents,
      count: svcAr.rows.length,
    },
    projectArCents: projAr.reduce((s, r) => s + r.balanceCents, 0),
    pianoArCents: pianoAr.reduce((s, r) => s + r.balanceCents, 0),
    depositsHeldCents: depositsCents,
    depositsList: depList,
    unpaidWagesCents: wages,
    recent: await journalFeed({ limit: 12 }),
    openExceptions: exceptionsCount[0]?.n ?? 0,
  };
}

/* ============================================================
 * Accounts + account detail (+ reconciliation)
 * ============================================================ */

export type AccountRow = {
  id: string; name: string; type: string; isWallet: boolean; walletKind: string | null;
  systemKey: string | null; active: boolean; balanceCents: number; openingBalanceCents: number;
  openingAsOf: string | null; hasLines: boolean;
};

export async function getAccountsPage(): Promise<{ accounts: AccountRow[] }> {
  const [accounts, aggs, lineCounts] = await Promise.all([
    db.select().from(accAccounts).orderBy(asc(accAccounts.position), asc(accAccounts.name)),
    accountAggregates(),
    db
      .select({ accountId: accJournalLines.accountId, n: sql<number>`count(*)::int` })
      .from(accJournalLines)
      .groupBy(accJournalLines.accountId),
  ]);
  const countMap = new Map(lineCounts.map((r) => [r.accountId, r.n]));
  return {
    accounts: accounts.map((a) => ({
      id: a.id, name: a.name, type: a.type, isWallet: a.isWallet, walletKind: a.walletKind,
      systemKey: a.systemKey, active: a.active, balanceCents: balanceOf(a, aggs.get(a.id)),
      openingBalanceCents: a.openingBalanceCents,
      openingAsOf: a.openingAsOf ? a.openingAsOf.toISOString() : null,
      hasLines: (countMap.get(a.id) ?? 0) > 0,
    })),
  };
}

/** Live reconciliation math for one account up to a statement date (shared by the detail
 *  page and the complete action). Cleared lines include everything cleared in past
 *  reconciliations; uncleared display totals skip voided-entry lines (they pair to zero). */
export async function computeReconState(
  accountId: string,
  statementDate: Date,
  statementEndingCents: number,
): Promise<{
  clearedBalanceCents: number; bookBalanceCents: number; differenceCents: number;
  unclearedInCents: number; unclearedOutCents: number; reconciled: boolean;
} | null> {
  const [account] = await db.select().from(accAccounts).where(eq(accAccounts.id, accountId)).limit(1);
  if (!account) return null;
  const rows = await db
    .select({ debit: accJournalLines.debitCents, credit: accJournalLines.creditCents,
             clearedAt: accJournalLines.clearedAt, voidedAt: accJournal.voidedAt })
    .from(accJournalLines)
    .innerJoin(accJournal, eq(accJournal.id, accJournalLines.journalId))
    .where(and(eq(accJournalLines.accountId, accountId), lte(accJournal.occurredAt, statementDate)));
  const math = reconMath({
    type: account.type,
    openingCents: account.openingBalanceCents,
    statementEndingCents,
    clearedDebitCents: rows.filter((r) => r.clearedAt).reduce((s, r) => s + r.debit, 0),
    clearedCreditCents: rows.filter((r) => r.clearedAt).reduce((s, r) => s + r.credit, 0),
    unclearedDebitCents: rows.filter((r) => !r.clearedAt && !r.voidedAt).reduce((s, r) => s + r.debit, 0),
    unclearedCreditCents: rows.filter((r) => !r.clearedAt && !r.voidedAt).reduce((s, r) => s + r.credit, 0),
  });
  return {
    clearedBalanceCents: math.clearedBalanceCents,
    bookBalanceCents: accountBalanceCents(
      account.type, account.openingBalanceCents,
      rows.reduce((s, r) => s + r.debit, 0), rows.reduce((s, r) => s + r.credit, 0),
    ),
    differenceCents: math.differenceCents,
    unclearedInCents: math.unclearedInCents,
    unclearedOutCents: math.unclearedOutCents,
    reconciled: math.reconciled,
  };
}

export type AccountLineRow = {
  lineId: string; journalId: string; code: string; occurredAt: string; kind: string; memo: string | null;
  voided: boolean; debitCents: number; creditCents: number; signedCents: number; runningBalanceCents: number;
  clearedAt: string | null; reconciliationId: string | null; sourceType: string | null; sourceId: string | null;
};

export type AccountDetailBundle = {
  account: AccountRow;
  lines: AccountLineRow[];
  balanceCents: number;
  reconciliations: (typeof accReconciliations.$inferSelect)[];
  openRecon: typeof accReconciliations.$inferSelect | null;
  /** Present when a reconciliation is open — the live math + the clearable line list. */
  recon: {
    statementDate: string;
    statementEndingCents: number;
    clearedBalanceCents: number;
    bookBalanceCents: number;
    differenceCents: number;
    unclearedInCents: number;
    unclearedOutCents: number;
    reconciled: boolean;
    lines: AccountLineRow[]; // ≤ statement date, uncleared first
  } | null;
};

export async function getAccountDetail(accountId: string): Promise<AccountDetailBundle | null> {
  const [account] = await db.select().from(accAccounts).where(eq(accAccounts.id, accountId)).limit(1);
  if (!account) return null;
  const [aggs, rawLines, recons] = await Promise.all([
    accountAggregates(),
    db
      .select({ line: accJournalLines, journal: accJournal })
      .from(accJournalLines)
      .innerJoin(accJournal, eq(accJournal.id, accJournalLines.journalId))
      .where(eq(accJournalLines.accountId, accountId))
      .orderBy(desc(accJournal.occurredAt), desc(accJournal.entryNumber))
      .limit(300),
    db
      .select()
      .from(accReconciliations)
      .where(eq(accReconciliations.accountId, accountId))
      .orderBy(desc(accReconciliations.statementDate)),
  ]);
  const total = balanceOf(account, aggs.get(accountId));

  let running = total;
  const lines: AccountLineRow[] = rawLines.map(({ line, journal }) => {
    const signed = signedCents(account.type, line.debitCents, line.creditCents);
    const row: AccountLineRow = {
      lineId: line.id, journalId: journal.id,
      code: `JE-${journal.occurredAt.getUTCFullYear()}-${String(journal.entryNumber).padStart(4, "0")}`,
      occurredAt: journal.occurredAt.toISOString(), kind: journal.kind, memo: journal.memo,
      voided: !!journal.voidedAt, debitCents: line.debitCents, creditCents: line.creditCents,
      signedCents: signed, runningBalanceCents: running,
      clearedAt: line.clearedAt ? line.clearedAt.toISOString() : null,
      reconciliationId: line.reconciliationId, sourceType: journal.sourceType, sourceId: journal.sourceId,
    };
    running -= signed;
    return row;
  });

  const openRecon = recons.find((r) => r.status === "open") ?? null;
  let recon: AccountDetailBundle["recon"] = null;
  if (openRecon) {
    const through = openRecon.statementDate;
    const inWindow = lines.filter((l) => new Date(l.occurredAt).getTime() <= through.getTime());
    // Clearable checklist: everything not yet cleared, INCLUDING voided-entry lines —
    // a voided pair (original + reversal) often appears on the statement, and the
    // cleared-balance math must be able to account for both sides. The line keeps its
    // voided flag so the UI can mark it; the uncleared in/out advisory skips voided lines.
    const uncleared = inWindow.filter((l) => !l.clearedAt);
    const state = await computeReconState(accountId, through, openRecon.statementEndingCents);
    if (state) {
      recon = {
        statementDate: through.toISOString(),
        statementEndingCents: openRecon.statementEndingCents,
        clearedBalanceCents: state.clearedBalanceCents,
        bookBalanceCents: state.bookBalanceCents,
        differenceCents: state.differenceCents,
        unclearedInCents: state.unclearedInCents,
        unclearedOutCents: state.unclearedOutCents,
        reconciled: state.reconciled,
        lines: [...uncleared, ...inWindow.filter((l) => l.clearedAt)],
      };
    }
  }

  return {
    account: {
      id: account.id, name: account.name, type: account.type, isWallet: account.isWallet,
      walletKind: account.walletKind, systemKey: account.systemKey, active: account.active,
      balanceCents: total, openingBalanceCents: account.openingBalanceCents,
      openingAsOf: account.openingAsOf ? account.openingAsOf.toISOString() : null,
      hasLines: rawLines.length > 0,
    },
    lines, balanceCents: total, reconciliations: recons, openRecon, recon,
  };
}

/* ============================================================
 * Transactions page
 * ============================================================ */

export async function getJournalPage(filter: {
  accountId?: string; kind?: string; stream?: string; monthKey?: string; q?: string;
}): Promise<{
  items: JournalFeedItem[];
  wallets: { id: string; name: string }[];
  months: string[];
}> {
  const accounts = await db.select().from(accAccounts);
  const entries = await db
    .select()
    .from(accJournal)
    .where(
      and(
        filter.accountId ? inArray(accJournal.id, db.select({ id: accJournalLines.journalId }).from(accJournalLines).where(eq(accJournalLines.accountId, filter.accountId))) : undefined,
        filter.kind ? eq(accJournal.kind, filter.kind) : undefined,
        filter.stream ? eq(accJournal.stream, filter.stream) : undefined,
        filter.monthKey ? gte(accJournal.occurredAt, monthRange(filter.monthKey).start) : undefined,
        filter.monthKey ? lt(accJournal.occurredAt, monthRange(filter.monthKey).end) : undefined,
        filter.q ? sql`${accJournal.memo} ilike ${`%${filter.q}%`}` : undefined,
      ),
    )
    .orderBy(desc(accJournal.occurredAt), desc(accJournal.entryNumber))
    .limit(150);
  const lines = entries.length
    ? await db.select().from(accJournalLines).where(inArray(accJournalLines.journalId, entries.map((e) => e.id)))
    : [];
  return {
    items: toFeedItems(entries, lines, new Map(accounts.map((a) => [a.id, a]))),
    wallets: accounts.filter((a) => a.isWallet && a.active).map((a) => ({ id: a.id, name: a.name })),
    months: lastMonthKeys(new Date(), 18),
  };
}

/* ============================================================
 * Receivables page
 * ============================================================ */

export type ReceivablesBundle = {
  service: { rows: ServiceArRow[]; aging: AgingSummary };
  projects: ProjectArRow[];
  pianos: PianoArRow[];
  deposits: DepositRow[];
  depositsTotalCents: number;
};

export async function getReceivables(): Promise<ReceivablesBundle> {
  const [svc, proj, piano, deps] = await Promise.all([
    serviceReceivables(new Date()), projectReceivables(), pianoReceivables(), depositsHeld(),
  ]);
  return {
    service: svc, projects: proj, pianos: piano,
    deposits: deps, depositsTotalCents: deps.reduce((s, d) => s + d.amountCents, 0),
  };
}

/* ============================================================
 * Project Billing page (/admin/projects/[id])
 * ============================================================ */

export type ProjectBillingBundle = {
  projectId: string;
  clientName: string;
  pianoLabel: string;
  status: string;
  /** ISO strings — client props must be serializable. */
  billingFinalizedAt: string | null;
  quotedCents: number;
  billedCents: number | null;
  taxRateBps: number;
  contractCents: number; // billed/quoted + VAT
  paidCents: number;
  balanceCents: number;
  laborByWorker: { worker: string; cents: number }[];
  laborTotalCents: number;
  items: {
    id: string; kind: string; description: string; qty: number; unitPriceCents: number;
    totalCents: number; updatedAt: string;
  }[];
  payments: {
    id: string; kind: string; amountCents: number; method: string; reference: string | null;
    receivedAt: string; note: string | null; voidedAt: string | null;
  }[];
  costs: {
    id: string; category: string; description: string; amountCents: number; vendor: string | null;
    spentAt: string; paid: boolean; voidedAt: string | null;
  }[];
  wallets: { id: string; name: string }[];
};

export async function getProjectBilling(projectId: string): Promise<ProjectBillingBundle | null> {
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!project) return null;
  const [itemRows, payRows, costRows, laborRows, walletRows] = await Promise.all([
    db.select().from(projectItems).where(eq(projectItems.projectId, projectId)).orderBy(asc(projectItems.position)),
    db.select().from(projectPayments).where(eq(projectPayments.projectId, projectId)).orderBy(desc(projectPayments.receivedAt), desc(projectPayments.createdAt)),
    db.select().from(projectCosts).where(eq(projectCosts.projectId, projectId)).orderBy(desc(projectCosts.spentAt)),
    db
      .select({
        worker: workers.name,
        cents: sql<number>`coalesce(sum(floor(greatest(0, (extract(epoch from (${timeEntries.clockOut} - ${timeEntries.clockIn})) / 3600.0 - ${timeEntries.breakMinutes} / 60.0)) * ${timeEntries.rateAtClockInCents})), 0)::int`,
      })
      .from(timeEntries)
      .innerJoin(tasks, eq(tasks.id, timeEntries.taskId))
      .innerJoin(workers, eq(workers.id, timeEntries.workerId))
      .where(and(eq(tasks.projectId, projectId), isNotNull(timeEntries.clockOut)))
      .groupBy(workers.name),
    db.select({ id: accAccounts.id, name: accAccounts.name }).from(accAccounts).where(and(eq(accAccounts.isWallet, true), eq(accAccounts.active, true))).orderBy(asc(accAccounts.position)),
  ]);
  const base = project.billingFinalizedAt ? (project.billedCents ?? project.quotedCents) : project.quotedCents;
  const paid = payRows.filter((p) => !p.voidedAt).reduce((s, p) => s + p.amountCents, 0);
  const contract = base + vatExclusiveCents(base, project.taxRateBps);
  return {
    projectId: project.id,
    clientName: project.clientName,
    pianoLabel: `${project.pianoBrand} ${project.pianoModel}`,
    status: project.status,
    billingFinalizedAt: project.billingFinalizedAt?.toISOString() ?? null,
    quotedCents: project.quotedCents,
    billedCents: project.billedCents,
    taxRateBps: project.taxRateBps,
    contractCents: contract,
    paidCents: paid,
    balanceCents: Math.max(0, contract - paid),
    laborByWorker: laborRows.map((r) => ({ worker: r.worker, cents: r.cents })).sort((a, b) => b.cents - a.cents),
    laborTotalCents: laborRows.reduce((s, r) => s + r.cents, 0),
    items: itemRows.map((i) => ({
      id: i.id, kind: i.kind, description: i.description, qty: i.qty,
      unitPriceCents: i.unitPriceCents, totalCents: i.qty * i.unitPriceCents,
      updatedAt: i.updatedAt.toISOString(),
    })),
    payments: payRows.map((p) => ({
      id: p.id, kind: p.kind, amountCents: p.amountCents, method: p.method, reference: p.reference,
      receivedAt: p.receivedAt.toISOString(), note: p.note, voidedAt: p.voidedAt?.toISOString() ?? null,
    })),
    costs: costRows.map((c) => ({
      id: c.id, category: c.category, description: c.description, amountCents: c.amountCents,
      vendor: c.vendor, spentAt: c.spentAt.toISOString(), paid: !!c.paidAccountId, voidedAt: c.voidedAt?.toISOString() ?? null,
    })),
    wallets: walletRows,
  };
}

/* ============================================================
 * Owner Money page
 * ============================================================ */

export type OwnerMoneyBundle = {
  equity: EquityStatement;
  safeToWithdraw: SafeToWithdraw;
  wallets: { id: string; name: string; balanceCents: number }[];
  history: JournalFeedItem[];
  totalCashCents: number;
};

export async function getOwnerMoney(user: User): Promise<OwnerMoneyBundle> {
  const overview = await getOverview(user);
  return {
    equity: overview.equity,
    safeToWithdraw: overview.safeToWithdraw,
    wallets: overview.wallets.filter((w) => w.active).map((w) => ({ id: w.id, name: w.name, balanceCents: w.balanceCents })),
    history: await journalFeed({ kinds: ["owner_draw", "owner_contribution", "personal_expense"], limit: 100 }),
    totalCashCents: overview.totalCashCents,
  };
}

/* ============================================================
 * Settings page
 * ============================================================ */

export type SettingsBundle = {
  settings: AccSettings;
  wallets: AccountRow[];
  expenseAccounts: AccountRow[];
  allAccounts: AccountRow[];
  methodMap: { key: string; accountId: string | null; accountName: string | null }[];
  locks: (typeof accPeriodLocks.$inferSelect)[];
  exceptions: (typeof accExceptions.$inferSelect)[];
};

export async function getAccountingSettings(ownerId: string): Promise<SettingsBundle> {
  const [accounts, aggs, locks, exceptions] = await Promise.all([
    db.select().from(accAccounts).orderBy(asc(accAccounts.position), asc(accAccounts.name)),
    accountAggregates(),
    db.select().from(accPeriodLocks).orderBy(desc(accPeriodLocks.year), desc(accPeriodLocks.month)),
    db.select().from(accExceptions).orderBy(desc(accExceptions.createdAt)).limit(50),
  ]);
  const [settingsRow] = await db.select().from(accSettingsTable).where(eq(accSettingsTable.ownerId, ownerId)).limit(1);
  const toRow = (a: typeof accounts[number]): AccountRow => ({
    id: a.id, name: a.name, type: a.type, isWallet: a.isWallet, walletKind: a.walletKind,
    systemKey: a.systemKey, active: a.active, balanceCents: balanceOf(a, aggs.get(a.id)),
    openingBalanceCents: a.openingBalanceCents,
    openingAsOf: a.openingAsOf ? a.openingAsOf.toISOString() : null,
    hasLines: (aggs.get(a.id)?.debitCents ?? 0) + (aggs.get(a.id)?.creditCents ?? 0) > 0,
  });
  return {
    settings: settingsRow!,
    wallets: accounts.filter((a) => a.isWallet).map(toRow),
    expenseAccounts: accounts.filter((a) => a.type === "expense").map(toRow),
    allAccounts: accounts.map(toRow),
    methodMap: Object.keys(settingsRow?.methodMap ?? {}).map((k) => ({
      key: k,
      accountId: settingsRow!.methodMap[k] ?? null,
      accountName: accounts.find((a) => a.id === settingsRow!.methodMap[k])?.name ?? null,
    })),
    locks, exceptions,
  };
}

/* ============================================================
 * Reports
 * ============================================================ */

export type ReportsBundle = {
  months: string[];
  booksStart: string;
  pnlByMonth: { key: string; revenueCents: number; expenseCents: number; netCents: number }[];
  pnlByStream: { stream: string; revenueCents: number; expenseCents: number; netCents: number }[];
  pnlByAccount: { name: string; type: string; amountCents: number }[];
  cashByMonth: { key: string; inCents: number; outCents: number; netCents: number }[];
  cashByStream: { stream: string; inCents: number; outCents: number; netCents: number }[];
  cashFlowByAccount: { name: string; byMonth: Record<string, { inCents: number; outCents: number }> }[];
  projectProfit: ProjectProfitRow[];
  salesRegister: SalesRegisterRow[];
  payrollRegister: { month: string; worker: string; paidCents: number }[];
  payrollTotals: { worker: string; paidCents: number }[];
  equity: EquityStatement;
  vatByQuarter: { quarter: string; outputCents: number; paidCents: number }[];
  vatPayableCents: number;
  balanceSheet: {
    assets: { name: string; amountCents: number }[]; liabilities: { name: string; amountCents: number }[];
    equity: { name: string; amountCents: number }[];
    totalAssetsCents: number; totalLiabilitiesCents: number; totalEquityCents: number; balanced: boolean;
  };
};

export type ProjectProfitRow = {
  projectId: string; label: string; status: string; contractCents: number; paidCents: number;
  laborCents: number; costsCents: number; revenueCents: number; profitCents: number; marginPct: number;
  finalized: boolean;
};

export type SalesRegisterRow = {
  saleId: string; pianoId: string; label: string; status: string; buyerName: string | null;
  soldAt: string | null; priceCents: number; taxCents: number; netRevenueCents: number;
  costCents: number; profitCents: number; marginPct: number; paidCents: number; balanceCents: number;
};

async function projectProfitability(): Promise<ProjectProfitRow[]> {
  const [rows, payRows, costRows, laborRows] = await Promise.all([
    db.select().from(projects).where(ne(projects.status, "cancelled")).orderBy(desc(projects.updatedAt)),
    db
      .select({ projectId: projectPayments.projectId, paid: sql<number>`coalesce(sum(${projectPayments.amountCents}), 0)::int` })
      .from(projectPayments).where(isNull(projectPayments.voidedAt)).groupBy(projectPayments.projectId),
    db
      .select({ projectId: projectCosts.projectId, costs: sql<number>`coalesce(sum(${projectCosts.amountCents}), 0)::int` })
      .from(projectCosts).where(isNull(projectCosts.voidedAt)).groupBy(projectCosts.projectId),
    db
      .select({
        projectId: tasks.projectId,
        labor: sql<number>`coalesce(sum(floor(greatest(0, (extract(epoch from (${timeEntries.clockOut} - ${timeEntries.clockIn})) / 3600.0 - ${timeEntries.breakMinutes} / 60.0)) * ${timeEntries.rateAtClockInCents})), 0)::int`,
      })
      .from(timeEntries)
      .innerJoin(tasks, eq(tasks.id, timeEntries.taskId))
      .where(and(isNotNull(timeEntries.clockOut), isNotNull(tasks.projectId)))
      .groupBy(tasks.projectId),
  ]);
  const paidMap = new Map(payRows.map((r) => [r.projectId, r.paid]));
  const costMap = new Map(costRows.map((r) => [r.projectId, r.costs]));
  const laborMap = new Map(laborRows.map((r) => [r.projectId!, r.labor]));
  return rows.map((p) => {
    const base = p.billingFinalizedAt ? (p.billedCents ?? p.quotedCents) : p.quotedCents;
    const contract = base + vatExclusiveCents(base, p.taxRateBps);
    const paid = paidMap.get(p.id) ?? 0;
    const labor = laborMap.get(p.id) ?? 0;
    const costs = costMap.get(p.id) ?? 0;
    const revenue = p.billingFinalizedAt ? base : 0;
    const profit = revenue - labor - costs;
    return {
      projectId: p.id, label: `${p.pianoBrand} ${p.pianoModel} — ${p.clientName}`, status: p.status,
      contractCents: contract, paidCents: paid, laborCents: labor, costsCents: costs,
      revenueCents: revenue, profitCents: profit,
      marginPct: revenue > 0 ? Math.round((profit / revenue) * 100) : 0,
      finalized: !!p.billingFinalizedAt,
    };
  });
}

async function salesRegisterRows(): Promise<SalesRegisterRow[]> {
  const rows = await db
    .select({ sale: pianoSales, brand: pianos.brand, model: pianos.model })
    .from(pianoSales)
    .innerJoin(pianos, eq(pianos.id, pianoSales.pianoId))
    .orderBy(desc(pianoSales.updatedAt));
  const saleIds = rows.map((r) => r.sale.id);
  const payRows = saleIds.length
    ? await db
        .select({ saleId: pianoPayments.saleId, paid: sql<number>`coalesce(sum(${pianoPayments.amountCents}), 0)::int` })
        .from(pianoPayments).where(isNull(pianoPayments.voidedAt)).groupBy(pianoPayments.saleId)
    : [];
  const paidMap = new Map(payRows.map((r) => [r.saleId, r.paid]));
  return rows.map(({ sale, brand, model }) => {
    const cost = sale.costSnapshotCents ?? 0;
    const net = netFromInclusiveCents(sale.priceCents, sale.taxRateBps);
    const profit = net - cost;
    return {
      saleId: sale.id, pianoId: sale.pianoId, label: `${brand} ${model}`, status: sale.status,
      buyerName: sale.buyerName, soldAt: sale.soldAt ? sale.soldAt.toISOString() : null,
      priceCents: sale.priceCents, taxCents: vatInclusiveCents(sale.priceCents, sale.taxRateBps),
      netRevenueCents: net, costCents: cost, profitCents: profit,
      marginPct: net > 0 ? Math.round((profit / net) * 100) : 0,
      paidCents: paidMap.get(sale.id) ?? 0,
      balanceCents: Math.max(0, sale.priceCents - (paidMap.get(sale.id) ?? 0)),
    };
  });
}

export async function getReports(user: User, months = 12): Promise<ReportsBundle> {
  await runAccountingBridge(user.id, user.name);
  const ctx = await getAccountingContext(user.id);
  const booksStart = ctx.settings.booksStartDate;
  const [aggs, activity, projProfit, salesRows, payrollRows] = await Promise.all([
    accountAggregates(),
    activitySince(booksStart),
    projectProfitability(),
    salesRegisterRows(),
    db
      .select({
        paidAt: payments.paidAt, amountCents: payments.amountCents, workerName: workers.name,
      })
      .from(payments)
      .innerJoin(timeEntries, eq(timeEntries.id, payments.timeEntryId))
      .innerJoin(workers, eq(workers.id, timeEntries.workerId))
      .orderBy(desc(payments.paidAt)),
  ]);

  const booksKey = monthKeyManila(booksStart);
  const monthKeys = lastMonthKeys(new Date(), months).filter((k) => k >= booksKey);

  const pnlByMonth = monthKeys.map((key) => {
    const { start, end } = monthRange(key);
    const cut = pnlCut(activity.filter((r) => r.occurredAt >= start && r.occurredAt < end));
    return { key, revenueCents: cut.revenueCents, expenseCents: cut.expenseCents, netCents: cut.netCents };
  });
  const cashByMonth = monthKeys.map((key) => {
    const { start, end } = monthRange(key);
    const cut = cashCut(activity.filter((r) => r.occurredAt >= start && r.occurredAt < end));
    return { key, inCents: cut.inCents, outCents: cut.outCents, netCents: cut.netCents };
  });

  const streamMap = new Map<string, { revenueCents: number; expenseCents: number }>();
  for (const r of activity) {
    if (r.accountType !== "revenue" && r.accountType !== "expense") continue;
    const b = streamMap.get(r.stream) ?? { revenueCents: 0, expenseCents: 0 };
    const signed = signedCents(r.accountType, r.debitCents, r.creditCents);
    if (r.accountType === "revenue") b.revenueCents += signed;
    else b.expenseCents += signed;
    streamMap.set(r.stream, b);
  }
  const cashMap = new Map<string, { inCents: number; outCents: number }>();
  for (const r of activity) {
    if (!r.isWallet) continue;
    const b = cashMap.get(r.stream) ?? { inCents: 0, outCents: 0 };
    b.inCents += r.debitCents;
    b.outCents += r.creditCents;
    cashMap.set(r.stream, b);
  }

  // P&L lines by account (detailed table)
  const accountMap = new Map<string, { name: string; type: string; amountCents: number }>();
  for (const r of activity) {
    if (r.accountType !== "revenue" && r.accountType !== "expense") continue;
    const b = accountMap.get(r.accountName) ?? { name: r.accountName, type: r.accountType, amountCents: 0 };
    b.amountCents += signedCents(r.accountType, r.debitCents, r.creditCents);
    accountMap.set(r.accountName, b);
  }

  // Cash flow per wallet per month
  const cashFlowByAccount = ctx.wallets.map((w) => {
    const byMonth: Record<string, { inCents: number; outCents: number }> = {};
    for (const key of monthKeys) byMonth[key] = { inCents: 0, outCents: 0 };
    for (const r of activity) {
      if (r.accountId !== w.id) continue;
      const key = monthKeyManila(r.occurredAt);
      if (!byMonth[key]) continue;
      byMonth[key].inCents += r.debitCents;
      byMonth[key].outCents += r.creditCents;
    }
    return { name: w.name, byMonth };
  });

  // Payroll register by Manila month + worker
  const payrollByMonth = new Map<string, { month: string; worker: string; paidCents: number }>();
  const payrollByWorker = new Map<string, number>();
  for (const r of payrollRows) {
    if (r.paidAt.getTime() < booksStart.getTime()) continue;
    const key = monthKeyManila(r.paidAt);
    const id = `${key}|${r.workerName}`;
    const row = payrollByMonth.get(id) ?? { month: key, worker: r.workerName, paidCents: 0 };
    row.paidCents += r.amountCents;
    payrollByMonth.set(id, row);
    payrollByWorker.set(r.workerName, (payrollByWorker.get(r.workerName) ?? 0) + r.amountCents);
  }

  // VAT by quarter (output = credits to VAT payable, paid = debits)
  const vatByQuarterMap = new Map<string, { outputCents: number; paidCents: number }>();
  const vatAccount = ctx.byKey.get("vat_payable");
  if (vatAccount) {
    for (const r of activity) {
      if (r.accountId !== vatAccount.id) continue;
      const m = Number(monthKeyManila(r.occurredAt).slice(5));
      const quarter = `${monthKeyManila(r.occurredAt).slice(0, 4)}-Q${Math.floor((m - 1) / 3) + 1}`;
      const b = vatByQuarterMap.get(quarter) ?? { outputCents: 0, paidCents: 0 };
      b.outputCents += r.creditCents;
      b.paidCents += r.debitCents;
      vatByQuarterMap.set(quarter, b);
    }
  }

  // Equity + balance sheet from all-time aggregates
  const pnlAll = pnlCut(activity);
  const systemBalance = (key: string): number => {
    const acc = ctx.byKey.get(key);
    return acc ? balanceOf(acc, aggs.get(acc.id)) : 0;
  };
  const magnitude = (key: string): number => {
    const acc = ctx.byKey.get(key);
    if (!acc) return 0;
    const agg = aggs.get(acc.id);
    return (agg?.debitCents ?? 0) - (agg?.creditCents ?? 0);
  };
  const equity = equityStatement({
    openingCents: systemBalance("opening_equity"),
    capitalCents: systemBalance("capital"),
    retainedProfitCents: pnlAll.netCents,
    drawsCents: magnitude("owner_draws"),
    personalCents: magnitude("personal"),
  });

  const bsRows = (type: string) =>
    ctx.accounts
      .filter((a) => a.type === type)
      .map((a) => ({ name: a.name, amountCents: balanceOf(a, aggs.get(a.id)) }))
      .filter((r) => r.amountCents !== 0);
  const assets = bsRows("asset");
  const liabilities = bsRows("liability");
  const equityRows = [
    ...bsRows("equity"),
    { name: "Retained profit (books to date)", amountCents: pnlAll.netCents },
  ];
  const totalAssetsCents = assets.reduce((s, r) => s + r.amountCents, 0);
  const totalLiabilitiesCents = liabilities.reduce((s, r) => s + r.amountCents, 0);
  const totalEquityCents = equityRows.reduce((s, r) => s + r.amountCents, 0);

  return {
    months: monthKeys,
    booksStart: booksStart.toISOString(),
    pnlByMonth,
    pnlByStream: [...streamMap.entries()].map(([stream, v]) => ({ stream, revenueCents: v.revenueCents, expenseCents: v.expenseCents, netCents: v.revenueCents - v.expenseCents })),
    pnlByAccount: [...accountMap.values()].sort((a, b) => b.amountCents - a.amountCents),
    cashByMonth,
    cashByStream: [...cashMap.entries()].map(([stream, v]) => ({ stream, inCents: v.inCents, outCents: v.outCents, netCents: v.inCents - v.outCents })),
    cashFlowByAccount,
    projectProfit: projProfit,
    salesRegister: salesRows,
    payrollRegister: [...payrollByMonth.values()].sort((a, b) => (a.month < b.month ? 1 : a.month > b.month ? -1 : a.worker.localeCompare(b.worker))),
    payrollTotals: [...payrollByWorker.entries()].map(([worker, paidCents]) => ({ worker, paidCents })).sort((a, b) => b.paidCents - a.paidCents),
    equity,
    vatByQuarter: [...vatByQuarterMap.entries()].map(([quarter, v]) => ({ quarter, ...v })).sort((a, b) => (a.quarter < b.quarter ? 1 : -1)),
    vatPayableCents: vatAccount ? balanceOf(vatAccount, aggs.get(vatAccount.id)) : 0,
    balanceSheet: {
      assets, liabilities, equity: equityRows,
      totalAssetsCents, totalLiabilitiesCents, totalEquityCents,
      balanced: totalAssetsCents === totalLiabilitiesCents + totalEquityCents,
    },
  };
}

/* ============================================================
 * Billing surfaces (Projects / Showroom)
 * ============================================================ */

export async function getPianoSale(pianoId: string): Promise<{
  sale: typeof pianoSales.$inferSelect | null;
  payments: (typeof pianoPayments.$inferSelect)[];
  costEntries: (typeof pianoCostEntries.$inferSelect)[];
  wallets: { id: string; name: string }[];
  carryingCents: number;
} | null> {
  const [sale] = await db.select().from(pianoSales).where(eq(pianoSales.pianoId, pianoId)).limit(1);
  const [payments, costEntries, walletRows] = await Promise.all([
    sale
      ? db.select().from(pianoPayments).where(eq(pianoPayments.saleId, sale.id)).orderBy(desc(pianoPayments.receivedAt))
      : Promise.resolve([] as (typeof pianoPayments.$inferSelect)[]),
    db.select().from(pianoCostEntries).where(eq(pianoCostEntries.pianoId, pianoId)).orderBy(desc(pianoCostEntries.spentAt)),
    db.select({ id: accAccounts.id, name: accAccounts.name }).from(accAccounts).where(and(eq(accAccounts.isWallet, true), eq(accAccounts.active, true))).orderBy(asc(accAccounts.position)),
  ]);
  return {
    sale: sale ?? null,
    payments,
    costEntries,
    wallets: walletRows,
    carryingCents: costEntries.filter((c) => !c.voidedAt).reduce((s, c) => s + c.amountCents, 0),
  };
}
