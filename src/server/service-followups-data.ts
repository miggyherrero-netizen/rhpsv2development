/** The one follow-up queue (manual reminders + waitlist follow-ups) — reads. A pure view: nothing is written or synced. */
import { and, inArray, lt } from "drizzle-orm";
import { db } from "@/db";
import { serviceWaitlistEntries } from "@/db/schema";
import { getOpenReminders, getOpenReminderDueDates } from "@/server/service-reminders-data";
import { getQueueEntries } from "@/server/service-waitlist-data";
import { sweepNotNow } from "@/server/service-waitlist-core";
import { QUEUE_WAIT_STATUSES, dueFollowUpCount, softCount, mergeFollowUps, type FollowUpItem } from "@/lib/service-followups";
import { startOfManilaDayUTC } from "@/lib/dates";
import type { ReminderRow } from "@/server/service-reminders-data";
import type { WaitlistItem } from "@/server/service-waitlist-data";
import type { WaitStatus } from "@/lib/service-waitlist";

export type QueueItem = FollowUpItem<ReminderRow, WaitlistItem>;

/** Everything in the queue: both reads run in parallel, the merge is in memory. */
export async function getFollowUpQueue(now: Date = new Date()): Promise<QueueItem[]> {
  const [reminders, entries] = await Promise.all([getOpenReminders(), getQueueEntries(now)]);
  return mergeFollowUps(reminders, entries, now);
}

/**
 * Just the number for the sidebar badge: reminders + waitlist follow-ups due today or earlier, merged by the same
 * rules as the queue page (so the badge always equals the page's overdue + today). Light selects, no joins.
 */
export async function getFollowUpDueCount(now: Date = new Date()): Promise<number> {
  await sweepNotNow(now);
  const endOfToday = new Date(startOfManilaDayUTC(now).getTime() + 86_400_000);
  const [reminderDays, entries] = await Promise.all([
    getOpenReminderDueDates(endOfToday),
    db.select({ id: serviceWaitlistEntries.id, status: serviceWaitlistEntries.status, nextFollowUpAt: serviceWaitlistEntries.nextFollowUpAt })
      .from(serviceWaitlistEntries)
      .where(and(inArray(serviceWaitlistEntries.status, [...QUEUE_WAIT_STATUSES] as WaitStatus[]), lt(serviceWaitlistEntries.nextFollowUpAt, endOfToday))),
  ]);
  return dueFollowUpCount(reminderDays, entries, now);
}

/** The sidebar badge, fail-soft: a failing read must not take every /service page to the error boundary. */
export const getFollowUpDueCountSafe = (now: Date = new Date()): Promise<number> => softCount(() => getFollowUpDueCount(now));
