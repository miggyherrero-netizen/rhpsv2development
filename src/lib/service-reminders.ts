/**
 * Client follow-up reminders — pure date logic (no React, no DB). A reminder is due on a whole Manila day:
 * `dueAt` is that day's 00:00 Manila, and it counts as due from then until it is marked done or snoozed.
 */
import { startOfManilaDayUTC } from "@/lib/dates";
import { addManilaDays } from "@/lib/service-today";

const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000;

export const NOTE_MAX = 300;

/** Quick choices in the "Remind me" box; "custom" is a typed date. */
export const PRESETS = [
  { key: "tomorrow", label: "Tomorrow", days: 1 },
  { key: "3days", label: "In 3 days", days: 3 },
  { key: "week", label: "Next week", days: 7 },
] as const;
export type PresetKey = (typeof PRESETS)[number]["key"];

export const SNOOZE_CHOICES = [
  { label: "Tomorrow", days: 1 },
  { label: "3 days", days: 3 },
  { label: "1 week", days: 7 },
] as const;

/** The reminder day for a quick choice, counted from today (Manila). */
export function presetDate(key: PresetKey, now: Date): Date {
  const p = PRESETS.find((x) => x.key === key) ?? PRESETS[0];
  return addManilaDays(startOfManilaDayUTC(now), p.days);
}

/** "2026-10-18" (a date box) → that day's 00:00 Manila; null if it is not a real date. */
export function parseDayInput(v: string | null | undefined): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((v ?? "").trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const utc = new Date(Date.UTC(y, mo - 1, d));
  if (utc.getUTCFullYear() !== y || utc.getUTCMonth() !== mo - 1 || utc.getUTCDate() !== d) return null; // 31 Feb etc.
  return new Date(utc.getTime() - MANILA_OFFSET_MS);
}

/** Date-box value ("YYYY-MM-DD", Manila) for an instant. */
export function toDayInput(d: Date): string {
  return new Date(d.getTime() + MANILA_OFFSET_MS).toISOString().slice(0, 10);
}

/** A reminder can be set for today or later, not for a day that is already over. */
export const isTodayOrLater = (due: Date, now: Date): boolean => due.getTime() >= startOfManilaDayUTC(now).getTime();

export type ReminderState = "overdue" | "today" | "upcoming";

/** Whole Manila days from today to the due day (negative = days overdue). */
export function daysUntil(due: Date, now: Date): number {
  return Math.round((startOfManilaDayUTC(due).getTime() - startOfManilaDayUTC(now).getTime()) / 86_400_000);
}

export function reminderState(due: Date, now: Date): ReminderState {
  const n = daysUntil(due, now);
  return n < 0 ? "overdue" : n === 0 ? "today" : "upcoming";
}

/** Due today or earlier — what Today shows. */
export const isDueNow = (due: Date, now: Date): boolean => daysUntil(due, now) <= 0;

/** Snooze counts from today, not from the old due date, so snoozing an old reminder never lands in the past. */
export const snoozedTo = (days: number, now: Date): Date => addManilaDays(startOfManilaDayUTC(now), Math.max(1, Math.round(days)));

/** Short label: "Today", "Tomorrow", "3d overdue", or null for later dates (the caller prints the date). */
export function reminderLabel(due: Date, now: Date): string | null {
  const n = daysUntil(due, now);
  if (n < 0) return `${Math.abs(n)}d overdue`;
  if (n === 0) return "Today";
  if (n === 1) return "Tomorrow";
  return null;
}

type WithDue = { dueAt: Date };

/** Most overdue first, then by due day; ties keep the order they were made in. */
export const sortByDue = <T extends WithDue & { createdAt?: Date }>(list: T[]): T[] =>
  [...list].sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime() || (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0));

/** Clean the note: trimmed, capped, blank -> null. */
export function cleanNote(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim().slice(0, NOTE_MAX) : "";
  return s || null;
}

export type ReminderGroups<T> = { overdue: T[]; today: T[]; upcoming: T[] };

/** Splits reminders into the three groups the Reminders page shows, each in due order. */
export function groupReminders<T extends WithDue & { createdAt?: Date }>(list: T[], now: Date): ReminderGroups<T> {
  const groups: ReminderGroups<T> = { overdue: [], today: [], upcoming: [] };
  for (const r of sortByDue(list)) groups[reminderState(r.dueAt, now)].push(r);
  return groups;
}

/**
 * Notes typed in ALL CAPS (pasted from Facebook, an old sheet…) shout over the client's name. For display only:
 * a note that is mostly capitals is shown in sentence case. Normal notes (and short ones like "SMS") are left as typed.
 */
export function softCaps(note: string): string {
  const letters = note.replace(/[^A-Za-z]/g, "");
  if (letters.length < 4) return note;
  const upper = letters.replace(/[^A-Z]/g, "").length;
  if (upper / letters.length < 0.8) return note;
  const lower = note.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}
