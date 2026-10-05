/**
 * Pure helpers for the Today command center: Manila week bounds, the Messenger reminder text,
 * stale-quote detection, grouping the next 7 days, and the "All clear" rule. No DB, no React.
 */
import { startOfManilaDayUTC } from "@/lib/dates";

export const DAY_MS = 86_400_000;
const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000;

/** Manila has no DST, so a day is exactly 24h — plain millisecond maths is safe (and server-timezone independent). */
export const addManilaDays = (dayStartUTC: Date, n: number): Date => new Date(dayStartUTC.getTime() + n * DAY_MS);

/** Monday 00:00 Manila → next Monday 00:00 Manila, as UTC instants. */
export function manilaWeekBounds(now: Date = new Date()): { from: Date; to: Date } {
  const dayStart = startOfManilaDayUTC(now);
  const dow = new Date(dayStart.getTime() + MANILA_OFFSET_MS).getUTCDay(); // 0 = Sunday
  const sinceMonday = (dow + 6) % 7;
  const from = addManilaDays(dayStart, -sinceMonday);
  return { from, to: addManilaDays(from, 7) };
}

/** A quote that was sent and got no answer for more than `days` whole days. */
export function isStaleQuote(sentAt: Date | null, now: Date, days = 3): boolean {
  if (!sentAt) return false;
  return now.getTime() - sentAt.getTime() > days * DAY_MS;
}

export const daysSince = (at: Date, now: Date): number => Math.max(0, Math.floor((now.getTime() - at.getTime()) / DAY_MS));

const ORG_WORDS = /\b(chapel|church|parish|school|academy|college|university|hotel|inc|corp|co|foundation|center|centre|studio|conservatory|cathedral)\b/i;

/** "Lourdes Tan" → "Lourdes"; but "Fr. Santos", "Sta. Cecilia Chapel" keep the whole name (a first word of "Sta." or an organisation isn't a person's first name). */
const firstName = (name: string) => {
  const full = name.trim().replace(/\s+/g, " ");
  const first = full.split(" ")[0] ?? "";
  if (!first) return "there";
  return first.includes(".") || ORG_WORDS.test(full) ? full : first;
};

const pesoText = (cents: number) =>
  `₱${(cents / 100).toLocaleString("en-PH", { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;

const dueText = (d: Date) =>
  new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "Asia/Manila" }).format(d);

/** A friendly, copy-ready Messenger reminder. Tone softens when the invoice isn't overdue yet. */
export function reminderText(i: {
  customerName: string; code: string; balanceCents: number; dueDate: Date | null; daysOverdue: number; businessName: string;
}): string {
  const hi = `Hi ${firstName(i.customerName)}!`;
  const amount = pesoText(i.balanceCents);
  const body = i.daysOverdue > 0
    ? `This is a gentle reminder that invoice ${i.code} (${amount}) was due ${i.dueDate ? `on ${dueText(i.dueDate)}` : "already"} and is still open.`
    : i.dueDate
      ? `Just a friendly reminder that invoice ${i.code} (${amount}) is due on ${dueText(i.dueDate)}.`
      : `Just a friendly reminder about invoice ${i.code} (${amount}).`;
  return `${hi} ${body} Please let me know once it's sent or if you have any questions. Thank you! — ${i.businessName}`;
}

/** Next-7-days grouping: items bucketed by Manila day, in order, empty days skipped. */
export function groupByManilaDay<T>(items: T[], at: (t: T) => Date, dayStartUTC: Date): { dayStart: Date; items: T[] }[] {
  const buckets = new Map<number, T[]>();
  for (const it of items) {
    const idx = Math.floor((at(it).getTime() - dayStartUTC.getTime()) / DAY_MS);
    buckets.set(idx, [...(buckets.get(idx) ?? []), it]);
  }
  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([idx, list]) => ({ dayStart: addManilaDays(dayStartUTC, idx), items: list }));
}

/** "All clear" is shown only when every command-center section is empty. */
export function isAllClear(counts: Record<string, number>): boolean {
  return Object.values(counts).every((n) => n === 0);
}
