/**
 * Status = time. A job's status events are the record of what happened and when; travel and on-site time entries
 * are *derived* from them (so tapping Start travel / Arrived / Complete is all anyone has to do). Pure — no DB.
 *
 *   en_route      starts a travel segment
 *   in_progress   starts an on-site (work) segment, ending any travel segment
 *   anything else (completed, on_hold, cancelled, scheduled, …) ends whatever segment is open
 */

export type StatusEvent = { id: string; status: string | null; at: Date };
export type SegmentKind = "travel" | "work";

export type Segment = {
  kind: SegmentKind;
  startEventId: string;
  endEventId: string | null;
  startedAt: Date;
  /** null = still running. */
  endedAt: Date | null;
};

const STARTS: Record<string, SegmentKind> = { en_route: "travel", in_progress: "work" };

/** Walks the status events in time order and returns the travel / on-site segments they describe. */
export function deriveSegments(events: StatusEvent[]): Segment[] {
  const ordered = events
    .map((e, i) => ({ e, i }))
    .filter(({ e }) => !!e.status)
    .sort((a, b) => a.e.at.getTime() - b.e.at.getTime() || a.i - b.i)
    .map(({ e }) => e);

  const out: Segment[] = [];
  let open: Segment | null = null;
  for (const ev of ordered) {
    const startsKind = STARTS[ev.status!];
    // Repeating the status the job is already in (a double tap) never restarts the clock.
    if (open && startsKind && open.kind === startsKind) continue;
    if (open) {
      open.endedAt = ev.at;
      open.endEventId = ev.id;
      out.push(open);
      open = null;
    }
    if (startsKind) open = { kind: startsKind, startEventId: ev.id, endEventId: null, startedAt: ev.at, endedAt: null };
  }
  if (open) out.push(open);
  return out;
}

/** Minutes in a closed segment (rounded, never negative); null while it is still running. */
export function segmentMinutes(s: Pick<Segment, "startedAt" | "endedAt">): number | null {
  if (!s.endedAt) return null;
  return Math.max(0, Math.round((s.endedAt.getTime() - s.startedAt.getTime()) / 60_000));
}

export type ExistingTimeLog = { id: string; startEventId: string | null; source: string; startedAt: Date; endedAt: Date | null; kind: string };

/**
 * What to write so the stored time entries match the segments:
 * - a segment with no entry yet -> insert
 * - an entry still owned by status events (source "event") whose times changed -> update
 * - an entry someone edited or stopped by hand (any other source) -> left alone, never overwritten
 */
export function planTimeSync(segments: Segment[], existing: ExistingTimeLog[]): {
  inserts: Segment[];
  updates: { id: string; kind: SegmentKind; startedAt: Date; endedAt: Date | null; minutes: number | null }[];
} {
  const byStart = new Map(existing.filter((l) => l.startEventId).map((l) => [l.startEventId!, l]));
  const inserts: Segment[] = [];
  const updates: { id: string; kind: SegmentKind; startedAt: Date; endedAt: Date | null; minutes: number | null }[] = [];
  for (const seg of segments) {
    const log = byStart.get(seg.startEventId);
    if (!log) { inserts.push(seg); continue; }
    if (log.source !== "event") continue;
    const sameEnd = (log.endedAt?.getTime() ?? null) === (seg.endedAt?.getTime() ?? null);
    if (sameEnd && log.startedAt.getTime() === seg.startedAt.getTime() && log.kind === seg.kind) continue;
    updates.push({ id: log.id, kind: seg.kind, startedAt: seg.startedAt, endedAt: seg.endedAt, minutes: segmentMinutes(seg) });
  }
  return { inserts, updates };
}

export const TIME_SOURCE_LABEL = { event: "From status", manual: "Manual", timer: "Timer" } as const;

/** Label for a stored entry: an event-derived one that was later stopped or edited by hand reads "Edited". */
export function timeSourceLabel(log: { source: string; startEventId: string | null }): string {
  if (log.source === "event") return TIME_SOURCE_LABEL.event;
  if (log.source === "manual" && log.startEventId) return "Edited";
  if (log.source === "manual") return TIME_SOURCE_LABEL.manual;
  return TIME_SOURCE_LABEL.timer;
}
