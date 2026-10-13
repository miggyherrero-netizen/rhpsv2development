/**
 * Roll a piano's service date / next-due date forward after a tuning-type visit. Plain module (NOT "use server").
 * Shared by job completion (`advanceRecall` in service.ts) and by a recorded payment (service-invoice-ops.ts), so the
 * rules live in one place. Never called from inside an invoice lock: the payment path runs it after the lock is released.
 */
import { and, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import { serviceJobs, servicePianos } from "@/db/schema";
import { countsAsTuning, isNewerServiceDate, jobIsFinished, pickServedAt, recallDueDate } from "@/lib/service-sale";
import { ensureRecallEntry } from "@/server/service-waitlist-core";

/**
 * Job completion (no `payment`): the piano's last service is the job's completion date (or now), as always.
 * From a payment: the date is picked by `pickServedAt` and is written ONLY when it is newer than what the piano
 * already has, so repeated payments (or a later completion on an older date) never move it backwards.
 * Returns whether the piano was updated.
 */
export async function rollPianoRecall(jobId: string, payment?: { paidAt: Date; firstPayment: boolean }): Promise<boolean> {
  const [job] = await db.select().from(serviceJobs).where(eq(serviceJobs.id, jobId)).limit(1);
  if (!job?.pianoId || job.jobType !== "service") return false;
  // Only a tuning-type visit counts as "last tuned"; a repair or assessment leaves the recall date alone.
  if (!countsAsTuning(job.serviceType)) return false;
  const [piano] = await db.select().from(servicePianos).where(eq(servicePianos.id, job.pianoId)).limit(1);
  if (!piano) return false;
  let servedAt: Date;
  const now = new Date();
  if (payment) {
    // Prepaying or paying a deposit on a booked / unfinished / cancelled job says nothing about a service: skip.
    if (!jobIsFinished(job)) return false;
    const picked = pickServedAt({ completedAt: job.completedAt, scheduledStart: job.scheduledStart, paidAt: payment.paidAt, firstPayment: payment.firstPayment, now });
    if (!picked || !isNewerServiceDate(piano.lastServiceAt, picked)) return false;
    // An old job paid late must not reopen a recall that is already overdue, nor override a newer tuning visit.
    if (recallDueDate(picked, piano.tuningIntervalMonths || 6)!.getTime() < now.getTime()) return false;
    const others = await db.select({ completedAt: serviceJobs.completedAt, status: serviceJobs.status, serviceType: serviceJobs.serviceType, cancelledAt: serviceJobs.cancelledAt })
      .from(serviceJobs).where(and(eq(serviceJobs.pianoId, piano.id), ne(serviceJobs.id, job.id), eq(serviceJobs.jobType, "service")));
    if (others.some((o) => countsAsTuning(o.serviceType) && jobIsFinished(o) && o.completedAt && o.completedAt.getTime() > picked.getTime())) return false;
    servedAt = picked;
  } else {
    servedAt = job.completedAt ?? now;
    // Completing an older visit never moves the piano's last service backwards.
    if (piano.lastServiceAt && piano.lastServiceAt.getTime() > servedAt.getTime()) return false;
  }
  const next = recallDueDate(servedAt, piano.tuningIntervalMonths || 6)!;
  await db
    .update(servicePianos)
    .set({ lastServiceAt: servedAt, nextServiceDueAt: next, updatedAt: new Date() })
    .where(eq(servicePianos.id, piano.id));
  // The recall also goes on the waitlist, due one tuning interval from the service (one open recall per piano).
  await ensureRecallEntry(jobId, payment ? servedAt : undefined);
  return true;
}
