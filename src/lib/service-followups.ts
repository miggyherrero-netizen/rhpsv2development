/**
 * The recall dedupe between Today's "Recalls due" and the waitlist. The Follow-ups page is NOT part of this: it shows manual
 * reminders only (src/lib/service-reminders.ts). Pure (no React, no DB).
 */
import { isFollowUpDue } from "@/lib/service-waitlist";

export type RecallEntry = { status: string; nextFollowUpAt: Date; serviceType: string; pianoId: string | null; jobId: string | null };

/**
 * Does this waitlist entry already "own" its piano's recall? True only for a tuning entry on that piano that either
 *  - is due for a follow-up NOW (`isFollowUpDue`, the same rule as Today's "Follow up today" panel: waiting / messaged /
 *    paused-then-due, due today or earlier), so the recall is on that panel instead of twice, or
 *  - is scheduled with a job booked.
 * Anything else (a waiting entry still days away, confirmed, other service types, no piano) does NOT own it, so the recall stays
 * on Today's recall list: it is never in neither place. (A piano-less tuning entry is a different follow-up: see docs/ARCHITECTURE.md.)
 */
export function entryOwnsRecall(e: RecallEntry, now: Date): boolean {
  if (e.serviceType !== "tuning" || !e.pianoId) return false;
  return isFollowUpDue(e, now) || (e.status === "scheduled" && !!e.jobId);
}

/** A recall prompt is dropped only when one of the piano's entries owns it (see `entryOwnsRecall`): it is then on Today's "Follow up today" panel (or booked) instead of twice. */
export function untrackedRecalls<T extends { pianoId: string }>(recalls: T[], entries: RecallEntry[], now: Date): T[] {
  const owned = new Set<string>();
  for (const e of entries) if (entryOwnsRecall(e, now)) owned.add(e.pianoId!);
  return recalls.filter((r) => !owned.has(r.pianoId));
}

/** Runs a count for a badge and never throws: on failure it logs and shows 0, so the page around it still renders. */
export async function softCount(fn: () => Promise<number>, log: (...a: unknown[]) => void = console.error): Promise<number> {
  try { return await fn(); } catch (e) { log("follow-up badge failed", e); return 0; }
}
