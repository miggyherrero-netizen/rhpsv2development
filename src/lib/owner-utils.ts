import type { OwnerTask, OwnerEvent, OwnerInboxItem, OwnerCategory, OwnerPreference } from "@/db/schema";
import { ymd, startOfDay } from "@/lib/dates";

export type { OwnerEvent };

export type CalItem = {
  key: string;
  kind: "event" | "focus" | "reminder" | "task-block" | "task-due";
  sourceId: string;
  title: string;
  start: Date;
  end: Date | null;
  allDay: boolean;
  color: string | null;
  categoryId: string | null;
  status: string;
  location: string | null;
  person: string | null;
  recurring: boolean;
  priority?: string;
};

export type SerializedCalItem = Omit<CalItem, 'start' | 'end'> & {
  start: string;
  end: string | null;
};

export type OwnerBundle = {
  categories: OwnerCategory[];
  prefs: OwnerPreference | null;
  items: CalItem[];
  tasks: OwnerTask[];
  events: OwnerEvent[];
  inbox: OwnerInboxItem[];
};

export type SerializedOwnerBundle = Omit<OwnerBundle, 'items' | 'tasks' | 'events' | 'inbox'> & {
  items: SerializedCalItem[];
  tasks: any[];
  events: any[];
  inbox: any[];
};

export type WorkingHours = Record<number, [number, number] | null>;

export function deserializeOwnerBundle(bundle: any): OwnerBundle {
  return {
    ...bundle,
    items: (bundle.items || []).map((i: any) => ({
      ...i,
      start: typeof i.start === 'string' ? new Date(i.start) : i.start,
      end: i.end ? (typeof i.end === 'string' ? new Date(i.end) : i.end) : null,
    })),
    tasks: (bundle.tasks || []).map((t: any) => ({
      ...t,
      dueDate: t.dueDate ? (typeof t.dueDate === 'string' ? new Date(t.dueDate) : t.dueDate) : null,
      scheduledStart: t.scheduledStart ? (typeof t.scheduledStart === 'string' ? new Date(t.scheduledStart) : t.scheduledStart) : null,
      scheduledEnd: t.scheduledEnd ? (typeof t.scheduledEnd === 'string' ? new Date(t.scheduledEnd) : t.scheduledEnd) : null,
      createdAt: typeof t.createdAt === 'string' ? new Date(t.createdAt) : t.createdAt,
      updatedAt: typeof t.updatedAt === 'string' ? new Date(t.updatedAt) : t.updatedAt,
    })),
    events: (bundle.events || []).map((e: any) => ({
      ...e,
      startAt: typeof e.startAt === 'string' ? new Date(e.startAt) : e.startAt,
      endAt: e.endAt ? (typeof e.endAt === 'string' ? new Date(e.endAt) : e.endAt) : null,
      createdAt: typeof e.createdAt === 'string' ? new Date(e.createdAt) : e.createdAt,
      updatedAt: typeof e.updatedAt === 'string' ? new Date(e.updatedAt) : e.updatedAt,
    })),
    inbox: (bundle.inbox || []).map((i: any) => ({
      ...i,
      capturedAt: typeof i.capturedAt === 'string' ? new Date(i.capturedAt) : i.capturedAt,
      createdAt: typeof i.createdAt === 'string' ? new Date(i.createdAt) : i.createdAt,
    })),
  };
}

export function computeWorkload(items: CalItem[], day: Date, wh: WorkingHours | null) {
  const dayItems = items.filter((i) => ymd(i.start) === ymd(day) && i.status !== "cancelled");
  const timed = dayItems.filter((i) => !i.allDay && i.end);
  const minutes = timed.reduce((s, i) => s + Math.max(0, (i.end!.getTime() - i.start.getTime()) / 60_000), 0);
  const appointments = dayItems.filter((i) => i.kind === "event").length;
  const whToday = wh?.[day.getDay()];
  const available = whToday ? whToday[1] - whToday[0] : null;
  return { minutes: Math.round(minutes), appointments, itemCount: dayItems.length, availableMinutes: available };
}

export function findConflicts(items: CalItem[], day: Date): { a: string; b: string }[] {
  const timed = items
    .filter((i) => ymd(i.start) === ymd(day) && !i.allDay && i.end && i.status !== "cancelled")
    .sort((a, b) => a.start.getTime() - b.start.getTime());
  const conflicts: { a: string; b: string }[] = [];
  for (let i = 0; i < timed.length; i++) {
    for (let j = i + 1; j < timed.length; j++) {
      if (timed[j].start.getTime() < timed[i].end!.getTime()) conflicts.push({ a: timed[i].key, b: timed[j].key });
      else break;
    }
  }
  return conflicts;
}

export function overdueTasksFrom(tasks: OwnerTask[], now = new Date()): OwnerTask[] {
  const today = startOfDay(now);
  return tasks.filter(
    (t) =>
      t.status !== "done" &&
      t.status !== "cancelled" &&
      !t.recurrence &&
      ((t.dueDate && startOfDay(new Date(t.dueDate)) < today) ||
        (t.scheduledStart && startOfDay(new Date(t.scheduledStart)) < today)),
  );
}

/** Missed (not completed) appointments from the past. */
export function missedEvents(items: CalItem[], now = new Date()): CalItem[] {
  return items.filter(
    (i) => !i.kind.startsWith("task") && i.start.getTime() < now.getTime() - 3_600_000 && i.status === "scheduled",
  );
}
