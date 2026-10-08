/**
 * Home Service Dashboard — one read that composes the existing Today board and Finance report
 * and adds only the few aggregates the dashboard needs (6-month series, job pipeline, recent
 * payments). Money is returned ONLY when `withFinance` is true (the same owner-only gate as
 * the Finance page), so a non-finance user never receives a peso figure from this loader.
 */
import { and, desc, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { serviceCustomers, serviceExpenses, serviceInvoices, serviceJobs, servicePayments } from "@/db/schema";
import { startOfManilaDayUTC } from "@/lib/dates";
import { effectiveKind } from "@/lib/service-finance-split";
import type { AgingSummary } from "@/lib/service";
import { titleCaseName } from "@/lib/service-reports";
import {
  buildMonthSeries, invoicedByKind, lastMonths, pipelineCounts, type DashboardMonth, type InvoicedByKind,
} from "@/lib/service-dashboard";
import {
  countUnreviewedExpenses, getFinanceReport, getReceivablesSnapshot, getRecalls, getServiceSettings, getTodayBoard,
  type TodayBoard,
} from "@/server/service-data";
import { getFinanceHealth } from "@/server/service-finance-audit-data";
import { OPEN_JOB_STATUSES } from "@/lib/service";

export type DashboardFinance = {
  /** "This month" figures straight from getFinanceReport("month") — identical to the Finance page. */
  month: {
    invoicedCents: number;
    collectedCents: number;
    expenseCents: number;
    /** Service + piano sales − overhead (the Finance page's "Net" in the profit split). */
    profitCents: number;
    /** Service collected + piano sale revenue: what the margin is measured against. */
    moneyInCents: number;
  };
  /** Same bucket rules as Finance, six Manila months, oldest first; the last one is this month. */
  series: DashboardMonth[];
  /** This month so far vs the same days last month, service vs piano sales. */
  invoicedByKind: InvoicedByKind;
  aging: AgingSummary;
  overdueCount: number;
  unreviewedExpenses: number;
  health: { errors: number; warnings: number } | null;
  recentPayments: { id: string; amountCents: number; receivedAt: Date; customerName: string; invoiceId: string }[];
};

export type DashboardBoard = {
  board: TodayBoard;
  /** Recalls due in the next 30 days or overdue (the board shows only the first 8). */
  recallsDue: number;
  pipeline: { status: string; count: number }[];
  /** Null when the viewer may not see finance. */
  finance: DashboardFinance | null;
};

export async function getDashboardBoard(ownerId: string, withFinance: boolean, now: Date = new Date()): Promise<DashboardBoard> {
  const [board, recalls, pipelineRows] = await Promise.all([
    getTodayBoard(ownerId, now),
    getRecalls(now),
    db
      .select({ status: serviceJobs.status, count: sql<number>`count(*)::int` })
      .from(serviceJobs)
      .where(inArray(serviceJobs.status, OPEN_JOB_STATUSES))
      .groupBy(serviceJobs.status),
  ]);
  const base = { board, recallsDue: recalls.length, pipeline: pipelineCounts(pipelineRows) };
  if (!withFinance) return { ...base, finance: null };

  const settings = await getServiceSettings(ownerId);
  const slots = lastMonths(now, 6);
  const from = slots[0]!.from;
  const to = new Date(startOfManilaDayUTC(now).getTime() + 86_400_000);

  const [report, snapshot, invoices, payments, expenses, unreviewed, health, recent] = await Promise.all([
    getFinanceReport(settings, "month", now),
    getReceivablesSnapshot(now),
    // Bounded: only invoices issued inside the six-month window.
    db
      .select({
        totalCents: serviceInvoices.totalCents, amountPaidCents: serviceInvoices.amountPaidCents, dueDate: serviceInvoices.dueDate,
        issueDate: serviceInvoices.issueDate, sentAt: serviceInvoices.sentAt, voidedAt: serviceInvoices.voidedAt, status: serviceInvoices.status, kind: serviceInvoices.kind,
      })
      .from(serviceInvoices)
      .where(and(gte(serviceInvoices.issueDate, from), lt(serviceInvoices.issueDate, to))),
    db
      .select({ receivedAt: servicePayments.receivedAt, amountCents: servicePayments.amountCents })
      .from(servicePayments)
      .where(and(gte(servicePayments.receivedAt, from), lt(servicePayments.receivedAt, to))),
    db
      .select({ spentAt: serviceExpenses.spentAt, amountCents: serviceExpenses.amountCents, category: serviceExpenses.category, kind: serviceExpenses.kind, pianoId: serviceExpenses.pianoId, jobId: serviceExpenses.jobId })
      .from(serviceExpenses)
      .where(and(gte(serviceExpenses.spentAt, from), lt(serviceExpenses.spentAt, to))),
    countUnreviewedExpenses(),
    // The health tile is a bonus: if the audit ever fails, the dashboard must still open.
    getFinanceHealth().catch((e) => { console.error("dashboard finance health failed", e); return null; }),
    db
      .select({ id: servicePayments.id, amountCents: servicePayments.amountCents, receivedAt: servicePayments.receivedAt, invoiceId: servicePayments.invoiceId, customerName: serviceCustomers.name })
      .from(servicePayments)
      .innerJoin(serviceInvoices, eq(serviceInvoices.id, servicePayments.invoiceId))
      .innerJoin(serviceCustomers, eq(serviceCustomers.id, serviceInvoices.customerId))
      .where(isNull(serviceInvoices.voidedAt))
      .orderBy(desc(servicePayments.receivedAt))
      .limit(5),
  ]);

  return {
    ...base,
    finance: {
      month: {
        invoicedCents: report.kpis.invoicedCents,
        collectedCents: report.kpis.collectedCents,
        expenseCents: report.kpis.expenseCents,
        profitCents: report.split.netCents,
        moneyInCents: report.split.service.collectedCents + report.split.sales.revenueCents,
      },
      series: buildMonthSeries(
        { invoices, payments, expenses: expenses.filter((e) => effectiveKind(e) !== "stock") },
        now,
        6,
      ),
      invoicedByKind: invoicedByKind(invoices, now),
      aging: snapshot.aging,
      overdueCount: snapshot.aging.buckets.filter((b) => b.key !== "current").reduce((n, b) => n + b.count, 0),
      unreviewedExpenses: unreviewed,
      health: health ? { errors: health.summary.errors, warnings: health.summary.warnings } : null,
      recentPayments: recent.map((r) => ({ ...r, customerName: titleCaseName(r.customerName) })),
    },
  };
}
