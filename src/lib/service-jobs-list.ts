/**
 * Pure helpers for the Home Service Jobs list: grouping into "Needs closing / Today / Upcoming /
 * Unscheduled / Earlier", relative date labels and filter counts. All day boundaries are Manila
 * (UTC+8), never the server's timezone. No DB, no React.
 */
import { startOfManilaDayUTC } from "@/lib/dates";
import { needsClosing } from "@/lib/service-reports";

const DAY_MS = 24 * 60 * 60 * 1000;
const MANILA = "Asia/Manila";

export const OPEN_JOB_STATUSES = ["lead", "quoted", "scheduled", "en_route", "in_progress", "on_hold"];

export type ListJob = {
  status: string;
  scheduledStart: Date | string | null;
  createdAt?: Date | string | null;
};

export type JobGroupKey = "closing" | "today" | "upcoming" | "unscheduled" | "earlier";

export type JobGroup<T> = {
  /** Stable id; month sub-groups of "Earlier" look like `earlier-2026-09`. */
  key: string;
  kind: JobGroupKey;
  label: string;
  count: number;
  items: T[];
};

/** Above this many earlier jobs, "Earlier" is split into one heading per month. */
export const EARLIER_MONTH_SPLIT = 10;

const ms = (d: Date | string | null | undefined): number => (d == null ? 0 : new Date(d).getTime());

const monthFmt = new Intl.DateTimeFormat("en-US", { month: "long", timeZone: MANILA });
const monthKeyFmt = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", timeZone: MANILA });
const yearFmt = new Intl.DateTimeFormat("en-US", { year: "numeric", timeZone: MANILA });
const dayFmt = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: MANILA });

const yearOf = (d: Date) => Number(yearFmt.format(d));

/** "Today" / "Tomorrow" / "Yesterday" / "Mon, Sep 28" (+ ", 2025" when not the current year). */
export function relativeDayLabel(when: Date | string, now: Date = new Date()): string {
  const d = new Date(when);
  const diff = Math.round((startOfManilaDayUTC(d).getTime() - startOfManilaDayUTC(now).getTime()) / DAY_MS);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  const base = dayFmt.format(d);
  return yearOf(d) === yearOf(now) ? base : `${base}, ${yearOf(d)}`;
}

/**
 * Split jobs into display groups, in order: Needs closing (oldest first), Today (by time),
 * Upcoming (soonest first), Unscheduled (newest created first), Earlier (newest first, by month
 * when long). Empty groups are omitted.
 */
export function groupJobs<T extends ListJob>(jobs: T[], now: Date = new Date()): JobGroup<T>[] {
  const todayStart = startOfManilaDayUTC(now).getTime();
  const tomorrowStart = todayStart + DAY_MS;
  const closing: T[] = [];
  const today: T[] = [];
  const upcoming: T[] = [];
  const unscheduled: T[] = [];
  const earlier: T[] = [];

  for (const j of jobs) {
    if (j.scheduledStart == null) unscheduled.push(j);
    else if (needsClosing(j, now)) closing.push(j);
    else {
      const t = ms(j.scheduledStart);
      if (t < todayStart) earlier.push(j);
      else if (t < tomorrowStart) today.push(j);
      else upcoming.push(j);
    }
  }

  closing.sort((a, b) => ms(a.scheduledStart) - ms(b.scheduledStart));
  today.sort((a, b) => ms(a.scheduledStart) - ms(b.scheduledStart));
  upcoming.sort((a, b) => ms(a.scheduledStart) - ms(b.scheduledStart));
  unscheduled.sort((a, b) => ms(b.createdAt) - ms(a.createdAt));
  earlier.sort((a, b) => ms(b.scheduledStart) - ms(a.scheduledStart));

  const out: JobGroup<T>[] = [];
  const push = (kind: JobGroupKey, label: string, items: T[], key: string = kind) => {
    if (items.length) out.push({ key, kind, label, count: items.length, items });
  };
  push("closing", "Needs closing", closing);
  push("today", "Today", today);
  push("upcoming", "Upcoming", upcoming);
  push("unscheduled", "Unscheduled", unscheduled);

  if (earlier.length <= EARLIER_MONTH_SPLIT) {
    push("earlier", "Earlier", earlier);
  } else {
    const byMonth = new Map<string, T[]>();
    for (const j of earlier) {
      const k = monthKeyFmt.format(new Date(j.scheduledStart as Date | string));
      byMonth.set(k, [...(byMonth.get(k) ?? []), j]);
    }
    for (const [k, items] of byMonth) {
      const first = new Date(items[0].scheduledStart as Date | string);
      const label = yearOf(first) === yearOf(now) ? monthFmt.format(first) : `${monthFmt.format(first)} ${yearOf(first)}`;
      push("earlier", `Earlier · ${label}`, items, `earlier-${k}`);
    }
  }
  return out;
}

/** Counts for the quick filter pills. Computed from the full list, ignoring search/type/crew. */
export function quickFilterCounts(jobs: ListJob[]): { open: number; scheduled: number; completed: number; all: number } {
  return {
    open: jobs.filter((j) => OPEN_JOB_STATUSES.includes(j.status)).length,
    scheduled: jobs.filter((j) => j.status === "scheduled").length,
    completed: jobs.filter((j) => j.status === "completed").length,
    all: jobs.length,
  };
}
