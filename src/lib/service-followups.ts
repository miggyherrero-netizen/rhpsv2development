/**
 * One follow-up queue = manual reminders + waitlist follow-ups, merged as a pure VIEW (no new table, nothing synced).
 * Pure (no React, no DB). Both kinds are put on a Manila calendar day first: a reminder's `dueAt` is already a day start,
 * a waitlist entry's `nextFollowUpAt` is a datetime, so it is rounded down with `startOfManilaDayUTC`.
 *
 * Which waitlist entries are in the queue (same rule as Today's "Follow up today", `isFollowUpDue`):
 *  - waiting / messaged: yes, from now until `FOLLOW_UP_HORIZON_DAYS` ahead
 *  - not_now: only once its pause is over (due today or earlier)
 *  - confirmed / scheduled / done: never (the client already said yes or the work is booked or finished)
 * Recalls are waitlist entries (source "recall"), so they are in the queue once, as waitlist rows.
 */
import { startOfManilaDayUTC } from "@/lib/dates";
import { groupReminders, daysUntil, reminderState, type ReminderGroups } from "@/lib/service-reminders";

/** How far ahead waitlist follow-ups show under "Upcoming" (the same lead the recall list used). */
export const FOLLOW_UP_HORIZON_DAYS = 30;
/** Waitlist statuses that are still being chased. */
export const QUEUE_WAIT_STATUSES = ["waiting", "messaged", "not_now"] as const;

export type FollowUpKind = "reminder" | "waitlist";
export type FollowUpFilter = "all" | FollowUpKind;

type ReminderIn = { id: string; dueAt: Date; createdAt?: Date };
type EntryIn = { id: string; status: string; nextFollowUpAt: Date };

export type FollowUpItem<R extends ReminderIn = ReminderIn, W extends EntryIn = EntryIn> =
  | { kind: "reminder"; key: string; dueAt: Date; createdAt?: Date; reminder: R }
  | { kind: "waitlist"; key: string; dueAt: Date; createdAt?: Date; entry: W };

/** The Manila day a waitlist follow-up falls on (00:00 Manila). */
export const followUpDay = (at: Date): Date => startOfManilaDayUTC(at);

/** Should this waitlist entry be in the queue at all? */
export function entryInQueue(e: Pick<EntryIn, "status" | "nextFollowUpAt">, now: Date): boolean {
  if (!(QUEUE_WAIT_STATUSES as readonly string[]).includes(e.status)) return false;
  const n = daysUntil(followUpDay(e.nextFollowUpAt), now);
  if (e.status === "not_now") return n <= 0;
  return n <= FOLLOW_UP_HORIZON_DAYS;
}

/** Reminders + queue-worthy waitlist entries, one list sorted by due day (reminders first on the same day), each item once. */
export function mergeFollowUps<R extends ReminderIn, W extends EntryIn>(reminders: R[], entries: W[], now: Date): FollowUpItem<R, W>[] {
  const out = new Map<string, FollowUpItem<R, W>>();
  for (const r of reminders) out.set(`reminder:${r.id}`, { kind: "reminder", key: `reminder:${r.id}`, dueAt: startOfManilaDayUTC(r.dueAt), createdAt: r.createdAt, reminder: r });
  for (const e of entries) {
    if (!entryInQueue(e, now)) continue;
    out.set(`waitlist:${e.id}`, { kind: "waitlist", key: `waitlist:${e.id}`, dueAt: followUpDay(e.nextFollowUpAt), createdAt: e.nextFollowUpAt, entry: e });
  }
  const rank = (i: FollowUpItem<R, W>) => (i.kind === "reminder" ? 0 : 1);
  return [...out.values()].sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime() || rank(a) - rank(b) || (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0));
}

export const filterFollowUps = <T extends { kind: FollowUpKind }>(items: T[], filter: FollowUpFilter): T[] =>
  filter === "all" ? items : items.filter((i) => i.kind === filter);

/** Overdue / today / upcoming, each in due order. */
export const groupFollowUps = <T extends { dueAt: Date; createdAt?: Date }>(items: T[], now: Date): ReminderGroups<T> => groupReminders(items, now);

export type FollowUpCounts = { all: number; reminder: number; waitlist: number; overdue: number; today: number; upcoming: number; /** overdue + today: the number on badges and Today. */ due: number };

/** Every number the queue page, the sidebar badge and Today show, from the same merged list. */
export function followUpCounts(items: { kind: FollowUpKind; dueAt: Date }[], now: Date): FollowUpCounts {
  const c: FollowUpCounts = { all: items.length, reminder: 0, waitlist: 0, overdue: 0, today: 0, upcoming: 0, due: 0 };
  for (const i of items) {
    c[i.kind]++;
    c[reminderState(i.dueAt, now)]++;
  }
  c.due = c.overdue + c.today;
  return c;
}

/** The combined "due now" count straight from the two source lists (what the badge uses). */
export const dueFollowUpCount = (reminders: ReminderIn[], entries: EntryIn[], now: Date): number =>
  followUpCounts(mergeFollowUps(reminders, entries, now), now).due;

export type RecallEntry = { status: string; nextFollowUpAt: Date; serviceType: string; pianoId: string | null; jobId: string | null };

/**
 * Does this waitlist entry already "own" its piano's recall? The ONE rule behind the recall dedupe, built on `entryInQueue`
 * so the queue and the recall list cannot diverge. True only for a tuning entry on that piano that either
 *  - the queue actually shows (waiting / messaged, within the horizon; not_now only after its pause), or
 *  - is scheduled with a job booked.
 * Confirmed entries, paused not_now, entries beyond the horizon, other service types and entries without a piano do NOT own it,
 * so the recall stays visible on Today. (A piano-less tuning entry is a different follow-up: see docs/ARCHITECTURE.md.)
 */
export function entryOwnsRecall(e: RecallEntry, now: Date): boolean {
  if (e.serviceType !== "tuning" || !e.pianoId) return false;
  return entryInQueue(e, now) || (e.status === "scheduled" && !!e.jobId);
}

/** A recall prompt is dropped only when one of the piano's entries owns it (see `entryOwnsRecall`): it is then counted there once. */
export function untrackedRecalls<T extends { pianoId: string }>(recalls: T[], entries: RecallEntry[], now: Date): T[] {
  const owned = new Set<string>();
  for (const e of entries) if (entryOwnsRecall(e, now)) owned.add(e.pianoId!);
  return recalls.filter((r) => !owned.has(r.pianoId));
}

/** Runs a count for a badge and never throws: on failure it logs and shows 0, so the page around it still renders. */
export async function softCount(fn: () => Promise<number>, log: (...a: unknown[]) => void = console.error): Promise<number> {
  try { return await fn(); } catch (e) { log("follow-up badge failed", e); return 0; }
}
