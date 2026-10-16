/**
 * Daily Operations Summary — READ-ONLY loader. Composes SELECT-only existing reads and hands them to the pure builder.
 * It never writes and never recomputes money (stored totals pass through).
 *
 * Deliberately NOT used here (they can write, found in review):
 *  - getServiceSettings / getTodayBoard / getDashboardBoard: getServiceSettings INSERTS a settings row on first access.
 *  - getFollowUpsDue / getWaitlist: they run sweepNotNow (a write).
 * The invoice prefix is therefore read with a plain SELECT and falls back to the schema default ("INV").
 * The caller must already have verified the owner (page and route do).
 */
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { serviceSettings } from "@/db/schema";
import { startOfManilaDayUTC } from "@/lib/dates";
import { addManilaDays } from "@/lib/service-today";
import { invoiceCode } from "@/lib/service";
import { getInvoices, getJobs, getReceivablesSnapshot, getUntrackedRecalls, type JobRow } from "@/server/service-data";
import { getRemindersDue } from "@/server/service-reminders-data";
import { getProjectRows, getTaskRows } from "@/server/data";
import { buildOpsSummary, type OpsJob, type OpsSummary } from "@/lib/ops-summary";

const toJob = (j: JobRow): OpsJob => ({
  id: j.id, title: j.title, serviceType: j.serviceType, status: j.status, scheduledStart: j.scheduledStart ?? null,
  customerName: j.customerName, area: j.area, pianoLabel: j.pianoLabel,
});

async function readInvoicePrefix(ownerId: string): Promise<string> {
  const [row] = await db.select({ prefix: serviceSettings.invoicePrefix }).from(serviceSettings).where(eq(serviceSettings.ownerId, ownerId)).limit(1);
  return row?.prefix || "INV";
}

export async function getOpsSummary(ownerId: string, now: Date = new Date()): Promise<OpsSummary> {
  const dayStart = startOfManilaDayUTC(now);
  const dayEnd = addManilaDays(dayStart, 1);
  const [jobsToday, pastDue, snapshot, recalls, reminders, tasks, projects, prefix] = await Promise.all([
    getJobs({ from: dayStart, to: dayEnd, limit: 200 }),
    getJobs({ statuses: ["scheduled", "en_route", "in_progress"], to: dayStart, limit: 200 }),
    getReceivablesSnapshot(now),
    getUntrackedRecalls(now),
    getRemindersDue(now),
    getTaskRows(false),
    getProjectRows(),
    readInvoicePrefix(ownerId),
  ]);
  const unpaid = snapshot.followUpIds.length ? await getInvoices({ ids: snapshot.followUpIds }, now) : [];
  const order = new Map(snapshot.followUpIds.map((id, i) => [id, i]));
  unpaid.sort((a, b) => order.get(a.id)! - order.get(b.id)!);

  return buildOpsSummary({
    now,
    jobsToday: jobsToday.filter((j) => j.status !== "cancelled").map(toJob),
    unfinishedJobs: pastDue.map(toJob),
    next7Count: 0,
    reminders: reminders.map((r) => ({ id: r.id, customerName: r.customerName, note: r.note, dueAt: r.dueAt })),
    recalls: recalls.map((r) => ({ pianoId: r.pianoId, pianoLabel: r.pianoLabel, customerName: r.customerName, nextServiceDueAt: r.nextServiceDueAt })),
    unpaid: unpaid.map((i) => ({
      id: i.id, code: invoiceCode(prefix, i.invoiceNumber, i.issueDate), customerName: i.customerName,
      balanceCents: i.balanceCents, dueDate: i.dueDate ?? null, daysOverdue: i.daysOverdue, status: i.status,
    })),
    draftInvoices: snapshot.drafts,
    outstandingCents: snapshot.aging.totalOutstandingCents,
    overdueCents: snapshot.aging.overdueCents,
    tasks: tasks.map((t) => ({
      id: t.id, title: t.title, status: t.status, priority: t.priority, dueDate: t.dueDate, waitingParts: t.waitingParts,
      assigneeNames: t.assigneeNames, projectName: t.projectName,
    })),
    projects: projects.map((p) => ({
      id: p.id, clientName: p.clientName, pianoName: `${p.pianoBrand} ${p.pianoModel}`, status: p.status, progress: p.progress,
      dueDate: p.dueDate, workerName: p.workerName, openTasks: p.openTasks,
    })),
  });
}
