/** Reminders follow-up badge — reads. Manual reminders only: the waitlist has its own page and its own counts. */
import { startOfManilaDayUTC } from "@/lib/dates";
import { getOpenReminderDueDates } from "@/server/service-reminders-data";
import { softCount } from "@/lib/service-followups";

/** The sidebar badge: open reminders due today or earlier (the same rule as the page's Overdue + Today groups). */
export async function getFollowUpDueCount(now: Date = new Date()): Promise<number> {
  const endOfToday = new Date(startOfManilaDayUTC(now).getTime() + 86_400_000);
  return (await getOpenReminderDueDates(endOfToday)).length;
}

/** The sidebar badge, fail-soft: a failing read must not take every /service page to the error boundary. */
export const getFollowUpDueCountSafe = (now: Date = new Date()): Promise<number> => softCount(() => getFollowUpDueCount(now));
