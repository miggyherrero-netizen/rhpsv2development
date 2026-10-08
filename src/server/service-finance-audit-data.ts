/**
 * Finance health check — read-only. Loads every money row once (one query per table, no N+1),
 * hands them to the pure `auditFinance`, and returns the findings. Owner-only, like Finance.
 */

import { sql } from "drizzle-orm";
import { db } from "@/db";
import {
  serviceJobs, serviceJobItems, serviceTimeLogs, serviceInvoices, serviceInvoiceItems,
  servicePayments, serviceExpenses,
} from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { canViewFinance } from "@/lib/service-flow";
import { invoiceCode, jobCode } from "@/lib/service";
import { auditFinance, type AuditSummary, type Finding } from "@/lib/service-finance-audit";
import { getServiceSettings } from "@/server/service-data";

export type FinanceHealth = { findings: Finding[]; summary: AuditSummary; checkedAt: string };

/** Runs the health check. Returns null when the signed-in user may not see finance. */
export async function getFinanceHealth(): Promise<FinanceHealth | null> {
  const user = await requireUser();
  if (!canViewFinance(user)) return null;
  const settings = await getServiceSettings(user.id);

  const [invoices, invoiceItems, payments, jobs, jobItems, timeLogs, expenses] = await Promise.all([
    db.select().from(serviceInvoices),
    db.select({
      invoiceId: serviceInvoiceItems.invoiceId, qty: serviceInvoiceItems.qty,
      unitPriceCents: serviceInvoiceItems.unitPriceCents, taxable: serviceInvoiceItems.taxable,
    }).from(serviceInvoiceItems),
    db.select({
      id: servicePayments.id, invoiceId: servicePayments.invoiceId,
      amountCents: servicePayments.amountCents, receivedAt: servicePayments.receivedAt,
    }).from(servicePayments),
    db.select({
      id: serviceJobs.id, jobNumber: serviceJobs.jobNumber, title: serviceJobs.title, createdAt: serviceJobs.createdAt,
      quotedCents: serviceJobs.quotedCents, partsCostCents: serviceJobs.partsCostCents, laborCostCents: serviceJobs.laborCostCents,
    }).from(serviceJobs),
    db.select({
      jobId: serviceJobItems.jobId, kind: serviceJobItems.kind, qty: serviceJobItems.qty,
      unitPriceCents: serviceJobItems.unitPriceCents, taxable: serviceJobItems.taxable, costCents: serviceJobItems.costCents,
    }).from(serviceJobItems),
    db.select({
      jobId: serviceTimeLogs.jobId, kind: serviceTimeLogs.kind, minutes: serviceTimeLogs.minutes,
      hourlyRateCents: serviceTimeLogs.hourlyRateCents, endedAt: serviceTimeLogs.endedAt,
    }).from(serviceTimeLogs),
    db.select({
      id: serviceExpenses.id, description: serviceExpenses.description, vendor: serviceExpenses.vendor,
      amountCents: serviceExpenses.amountCents, spentAt: serviceExpenses.spentAt, kind: serviceExpenses.kind,
      jobId: serviceExpenses.jobId, pianoId: serviceExpenses.pianoId, category: serviceExpenses.category,
      // Never ship the receipt image itself, only whether one exists.
      hasReceipt: sql<boolean>`${serviceExpenses.receiptUrl} IS NOT NULL`,
    }).from(serviceExpenses),
  ]);

  const result = auditFinance({
    invoices: invoices.map((i) => ({ ...i, label: invoiceCode(settings.invoicePrefix, i.invoiceNumber, i.issueDate) })),
    invoiceItems,
    payments,
    jobs: jobs.map((j) => ({ ...j, label: `${jobCode(settings.jobPrefix, j.jobNumber, j.createdAt)} · ${j.title}` })),
    jobItems,
    timeLogs,
    expenses,
  });
  return { ...result, checkedAt: new Date().toISOString() };
}
