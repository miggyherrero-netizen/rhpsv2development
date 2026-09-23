import { db } from "@/db";
import {
  projects, tasks, workers, timeEntries, workerBreaks, updates, inventoryItems, pianos,
  inquiries, settings, ownerEvents, ownerTasks, ownerInbox, ownerCategories,
  ownerPreferences, taskAssignees,
  type Project, type Task, type Worker, type TimeEntry, type Update,
  type OwnerEvent, type OwnerTask, type OwnerInboxItem, type OwnerCategory,
  type OwnerPreference,
} from "@/db/schema";
import { and, asc, desc, eq, isNull, inArray, ilike, or, gte, ne } from "drizzle-orm";
import { expandRecurrence, ymd, startOfManilaDayUTC } from "@/lib/dates";
import { overdueTasksFrom, type CalItem, type OwnerBundle, type WorkingHours, computeWorkload, findConflicts } from "@/lib/owner-utils";
import { parseWebsiteContent, WEBSITE_CONTENT_KEY } from "@/lib/website-content";

export type { CalItem, OwnerBundle, WorkingHours };
export { computeWorkload, findConflicts };

/* ================= LIVE LABOR ================= */

export type LiveWorker = {
  entryId: string;
  workerId: string;
  name: string;
  title: string;
  avatarUrl: string | null;
  clockIn: string;
  rateCents: number;
  taskTitle: string | null;
  projectName: string | null;
  onBreak: boolean;
  breakStartedAt: string | null;
  breakMinutes: number;
};

export type LiveOps = {
  workers: LiveWorker[];
  burnRateCentsPerHour: number;
  activeTaskCount: number;
  clockInCount: number;
  generatedAt: string;
};

export async function getLiveOps(): Promise<LiveOps> {
  const open = await db
    .select({ entry: timeEntries, worker: workers })
    .from(timeEntries)
    .innerJoin(workers, eq(workers.id, timeEntries.workerId))
    .where(isNull(timeEntries.clockOut))
    .orderBy(asc(timeEntries.clockIn));

  const taskIds = open.map((o) => o.entry.taskId).filter((x): x is string => !!x);
  const taskRows = taskIds.length
    ? await db
        .select({ task: tasks, project: projects })
        .from(tasks)
        .leftJoin(projects, eq(projects.id, tasks.projectId))
        .where(inArray(tasks.id, taskIds))
    : [];
  const taskMap = new Map(taskRows.map((r) => [r.task.id, r]));

  const activeTaskCount = (
    await db.select({ id: tasks.id }).from(tasks).where(inArray(tasks.status, ["claimed", "in_progress"]))
  ).length;

  return {
    generatedAt: new Date().toISOString(),
    workers: open.map(({ entry, worker }) => {
      const t = entry.taskId ? taskMap.get(entry.taskId) : undefined;
      return {
        entryId: entry.id,
        workerId: worker.id,
        name: worker.name,
        title: worker.title,
        avatarUrl: worker.avatarUrl,
        clockIn: entry.clockIn.toISOString(),
        rateCents: entry.rateAtClockInCents,
        taskTitle: t?.task.title ?? null,
        projectName: t?.project ? `${t.project.pianoBrand} ${t.project.pianoModel} — ${t.project.clientName}` : null,
        onBreak: entry.onBreak,
        breakStartedAt: entry.breakStartedAt ? entry.breakStartedAt.toISOString() : null,
        breakMinutes: entry.breakMinutes,
      };
    }),
    burnRateCentsPerHour: open.reduce((s, o) => s + o.entry.rateAtClockInCents, 0),
    activeTaskCount,
    clockInCount: open.length,
  };
}

/* ================= TIMESHEET (TODAY) ================= */

export type BreakLog = {
  startedAt: string;
  endedAt: string | null;
  minutes: number | null;
  long: boolean;
};

const LONG_BREAK_MINUTES = 60;

export type TimesheetEntry = {
  entryId: string;
  workerId: string;
  name: string;
  avatarUrl: string | null;
  clockIn: string;
  clockOut: string | null;
  rateCents: number;
  breakMinutes: number;
  onBreak: boolean;
  breakStartedAt: string | null;
  earnedCents: number;
  paidCents: number;
  balanceCents: number;
  isToday: boolean;
  breaks: BreakLog[];
};

export type TimesheetWorkerSummary = {
  workerId: string;
  name: string;
  avatarUrl: string | null;
  totalMinutesToday: number;
  totalEarnedCentsToday: number;
  totalBalanceCents: number;
  entries: TimesheetEntry[];
};

/**
 * Today's shifts, still-open shifts, plus any older shift that still has an unpaid balance —
 * so a shortfall from days ago (e.g. weekly-paid workers) never silently falls off the list.
 * Bounded to the last 30 days to keep the query cheap.
 */
export async function getTodayTimesheet(): Promise<TimesheetWorkerSummary[]> {
  const startOfDay = startOfManilaDayUTC();
  const lookback = new Date(startOfDay.getTime() - 30 * 86_400_000);

  const rows = await db
    .select({ entry: timeEntries, worker: workers })
    .from(timeEntries)
    .innerJoin(workers, eq(workers.id, timeEntries.workerId))
    .where(or(gte(timeEntries.clockIn, lookback), isNull(timeEntries.clockOut)))
    .orderBy(desc(timeEntries.clockIn));

  const entryIds = rows.map((r) => r.entry.id);
  const breakRows = entryIds.length
    ? await db.select().from(workerBreaks).where(inArray(workerBreaks.timeEntryId, entryIds)).orderBy(asc(workerBreaks.startedAt))
    : [];
  const breaksByEntry = new Map<string, BreakLog[]>();
  for (const b of breakRows) {
    const minutes = b.endedAt ? Math.round((b.endedAt.getTime() - b.startedAt.getTime()) / 60_000) : null;
    const list = breaksByEntry.get(b.timeEntryId) ?? [];
    list.push({
      startedAt: b.startedAt.toISOString(),
      endedAt: b.endedAt ? b.endedAt.toISOString() : null,
      minutes,
      long: minutes !== null ? minutes > LONG_BREAK_MINUTES : (Date.now() - b.startedAt.getTime()) / 60_000 > LONG_BREAK_MINUTES,
    });
    breaksByEntry.set(b.timeEntryId, list);
  }

  const byWorker = new Map<string, TimesheetWorkerSummary>();
  for (const { entry, worker } of rows) {
    const endMs = entry.clockOut ? entry.clockOut.getTime() : Date.now();
    const ongoingBreakMs = entry.onBreak && entry.breakStartedAt ? Date.now() - entry.breakStartedAt.getTime() : 0;
    const workedMs = endMs - entry.clockIn.getTime() - entry.breakMinutes * 60_000 - ongoingBreakMs;
    const earned = Math.max(0, (workedMs / 3_600_000) * entry.rateAtClockInCents);
    const balance = Math.max(0, Math.round(earned) - entry.paidCents);
    const isToday = entry.clockIn.getTime() >= startOfDay.getTime();

    // Skip entries that are old, closed, and already fully settled — nothing to track or show.
    if (!isToday && entry.clockOut && balance <= 0) continue;

    const item: TimesheetEntry = {
      entryId: entry.id,
      workerId: worker.id,
      name: worker.name,
      avatarUrl: worker.avatarUrl,
      clockIn: entry.clockIn.toISOString(),
      clockOut: entry.clockOut ? entry.clockOut.toISOString() : null,
      rateCents: entry.rateAtClockInCents,
      breakMinutes: entry.breakMinutes,
      onBreak: entry.onBreak,
      breakStartedAt: entry.breakStartedAt ? entry.breakStartedAt.toISOString() : null,
      earnedCents: earned,
      paidCents: entry.paidCents,
      balanceCents: balance,
      isToday,
      breaks: breaksByEntry.get(entry.id) ?? [],
    };

    const summary = byWorker.get(worker.id) ?? {
      workerId: worker.id, name: worker.name, avatarUrl: worker.avatarUrl,
      totalMinutesToday: 0, totalEarnedCentsToday: 0, totalBalanceCents: 0, entries: [],
    };
    if (isToday) {
      summary.totalMinutesToday += Math.max(0, workedMs / 60_000);
      summary.totalEarnedCentsToday += earned;
    }
    summary.totalBalanceCents += balance;
    summary.entries.push(item);
    byWorker.set(worker.id, summary);
  }

  return [...byWorker.values()].sort((a, b) => b.totalEarnedCentsToday - a.totalEarnedCentsToday);
}

/* ================= PIPELINE / TASK META ================= */

export type ProjectRow = Project & {
  workerName: string | null;
  openTasks: number;
  doneTasks: number;
};

export async function getProjectRows(): Promise<ProjectRow[]> {
  const rows = await db
    .select({ project: projects, worker: workers })
    .from(projects)
    .leftJoin(workers, eq(workers.id, projects.assignedWorkerId))
    .orderBy(desc(projects.updatedAt));
  const taskRows = await db.select({ id: tasks.id, projectId: tasks.projectId, status: tasks.status }).from(tasks);
  const byProject = new Map<string, { open: number; done: number }>();
  for (const t of taskRows) {
    if (!t.projectId) continue;
    const cur = byProject.get(t.projectId) ?? { open: 0, done: 0 };
    if (t.status === "done") cur.done++;
    else cur.open++;
    byProject.set(t.projectId, cur);
  }
  return rows.map(({ project, worker }) => ({
    ...project,
    workerName: worker?.name ?? null,
    openTasks: byProject.get(project.id)?.open ?? 0,
    doneTasks: byProject.get(project.id)?.done ?? 0,
  }));
}

export type TaskRow = Task & {
  projectName: string | null;
  pianoName: string | null;
  assigneeName: string | null;
  claimedName: string | null;
  assigneeIds: string[];
  assigneeNames: string[];
};

export async function getTaskRows(includeArchived = false): Promise<TaskRow[]> {
  const rows = await db.select().from(tasks).where(includeArchived ? undefined : isNull(tasks.archivedAt)).orderBy(asc(tasks.position), desc(tasks.updatedAt));
  const taskIds = rows.map((r) => r.id);
  const assigneeRows = taskIds.length ? await db.select().from(taskAssignees).where(inArray(taskAssignees.taskId, taskIds)) : [];
  const byTask = new Map<string, string[]>();
  for (const a of assigneeRows) {
    const arr = byTask.get(a.taskId) ?? [];
    arr.push(a.workerId);
    byTask.set(a.taskId, arr);
  }
  const projectIds = [...new Set(rows.map((r) => r.projectId).filter((x): x is string => !!x))];
  const workerIds = [
    ...new Set([
      ...rows.flatMap((r) => [r.assignedWorkerId, r.claimedByWorkerId]).filter((x): x is string => !!x),
      ...assigneeRows.map((a) => a.workerId),
    ]),
  ];
  const projRows = projectIds.length ? await db.select().from(projects).where(inArray(projects.id, projectIds)) : [];
  const wRows = workerIds.length ? await db.select().from(workers).where(inArray(workers.id, workerIds)) : [];
  const pm = new Map(projRows.map((p) => [p.id, p]));
  const wm = new Map(wRows.map((w) => [w.id, w]));
  return rows.map((r) => {
    const p = r.projectId ? pm.get(r.projectId) : undefined;
    // Fall back to the legacy single column for tasks that predate the join table.
    const ids = byTask.get(r.id) ?? (r.assignedWorkerId ? [r.assignedWorkerId] : []);
    const names = ids
      .map((id) => wm.get(id)?.name)
      .filter((n): n is string => !!n)
      .sort((a, b) => a.localeCompare(b));
    return {
      ...r,
      projectName: p ? p.clientName : null,
      pianoName: p ? `${p.pianoBrand} ${p.pianoModel}` : null,
      assigneeName: r.assignedWorkerId ? (wm.get(r.assignedWorkerId)?.name ?? null) : null,
      claimedName: r.claimedByWorkerId ? (wm.get(r.claimedByWorkerId)?.name ?? null) : null,
      assigneeIds: ids,
      assigneeNames: names,
    };
  });
}

export async function getProjectDetail(id: string) {
  const [project] = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
  if (!project) return null;
  const [worker] = project.assignedWorkerId
    ? await db.select().from(workers).where(eq(workers.id, project.assignedWorkerId)).limit(1)
    : [undefined];
  const tRows = await getTaskRows(true);
  const projectTasks = tRows.filter((t) => t.projectId === id);
  const story = await db.select().from(updates).where(eq(updates.projectId, id)).orderBy(asc(updates.position));
  const taskIds = projectTasks.map((t) => t.id);
  const entries = taskIds.length
    ? await db
        .select({ entry: timeEntries, worker: workers })
        .from(timeEntries)
        .innerJoin(workers, eq(workers.id, timeEntries.workerId))
        .where(inArray(timeEntries.taskId, taskIds))
        .orderBy(desc(timeEntries.clockIn))
    : [];
  return { project, worker: worker ?? null, tasks: projectTasks.filter((t) => !t.archivedAt), updates: story, labor: entries };
}

export async function getDashboard() {
  const [projRows, taskRows, live, inquires, settingRows, inv] = await Promise.all([
    getProjectRows(),
    getTaskRows(),
    getLiveOps(),
    db.select().from(inquiries).where(eq(inquiries.status, "new")).orderBy(desc(inquiries.createdAt)),
    db.select().from(settings),
    db.select().from(inventoryItems),
  ]);
  const staleDays = Number(settingRows.find((s) => s.key === "staleUpdateDays")?.value ?? 10);
  const now = new Date();
  const overdue = taskRows.filter((t) => t.status !== "done" && t.dueDate && t.dueDate < now);
  const waitingParts = taskRows.filter((t) => t.status !== "done" && t.waitingParts);
  const staleClients = projRows.filter(
    (p) =>
      p.status !== "delivery" &&
      (!p.lastClientUpdateAt || now.getTime() - p.lastClientUpdateAt.getTime() > staleDays * 86_400_000),
  );
  const lowStock = inv.filter((i) => i.qtyOnHand <= i.reorderPoint);
  return {
    projects: projRows, tasks: taskRows, live, inquiries: inquires, staleDays,
    overdue, waitingParts, staleClients, lowStock,
  };
}

export async function getWorkerDetail(id: string) {
  const [worker] = await db.select().from(workers).where(eq(workers.id, id)).limit(1);
  if (!worker) return null;
  const entries = await db
    .select({ entry: timeEntries, task: tasks })
    .from(timeEntries)
    .leftJoin(tasks, eq(tasks.id, timeEntries.taskId))
    .where(eq(timeEntries.workerId, id))
    .orderBy(desc(timeEntries.clockIn))
    .limit(40);
  const allTasks = await getTaskRows(true);
  const completed = allTasks.filter((t) => t.claimedByWorkerId === id && t.status === "done");
  const current = allTasks.find((t) => t.claimedByWorkerId === id && t.status === "in_progress") ?? null;
  return { worker, entries, completed, current };
}

/* ================= PORTAL / CURATOR ================= */

export async function getPortal(uuid: string) {
  const [project] = await db.select().from(projects).where(eq(projects.portalUuid, uuid)).limit(1);
  if (!project) return null;
  const story = await db
    .select()
    .from(updates)
    .where(and(eq(updates.projectId, project.id), eq(updates.isVisibleToClient, true)))
    .orderBy(asc(updates.updateDate), asc(updates.position));
  return { project, updates: story };
}

export type PublicPiano = Omit<typeof pianos.$inferSelect, "costCents">;

export async function getShowroom() {
  // Public-facing: never select costCents here, this feeds the public homepage client bundle.
  // Sold pianos are excluded entirely — once sold, an instrument leaves the live showroom.
  return db.select({
    id: pianos.id, brand: pianos.brand, model: pianos.model, year: pianos.year,
    type: pianos.type, condition: pianos.condition, description: pianos.description,
    technicianNotes: pianos.technicianNotes, dimensions: pianos.dimensions,
    recommendedUse: pianos.recommendedUse, priceCents: pianos.priceCents,
    status: pianos.status, imageUrl: pianos.imageUrl, sortOrder: pianos.sortOrder,
    createdAt: pianos.createdAt,
  }).from(pianos).where(ne(pianos.status, "sold")).orderBy(asc(pianos.sortOrder));
}

/* ================= SHOWROOM ADMIN ================= */

export async function getShowroomAdmin() {
  return db.select().from(pianos).orderBy(asc(pianos.sortOrder));
}

export async function getPianoCost(id: string) {
  const [row] = await db.select({
    id: pianos.id, brand: pianos.brand, model: pianos.model,
    priceCents: pianos.priceCents, costCents: pianos.costCents,
  }).from(pianos).where(eq(pianos.id, id)).limit(1);
  return row ?? null;
}

export async function getWebsiteContent() {
  const [row] = await db.select().from(settings).where(eq(settings.key, WEBSITE_CONTENT_KEY)).limit(1);
  return parseWebsiteContent(row?.value);
}

/* ================= OWNER WORKSPACE ================= */

export async function getOwnerBundle(userId: string, from: Date, to: Date): Promise<OwnerBundle> {
  const [categories, prefRows, eventRows, taskRows, inboxRows] = await Promise.all([
    db.select().from(ownerCategories).orderBy(asc(ownerCategories.position)),
    db.select().from(ownerPreferences).where(eq(ownerPreferences.ownerId, userId)).limit(1),
    db.select().from(ownerEvents).where(and(eq(ownerEvents.ownerId, userId), isNull(ownerEvents.deletedAt))),
    db.select().from(ownerTasks).where(and(eq(ownerTasks.ownerId, userId), isNull(ownerTasks.deletedAt))),
    db.select().from(ownerInbox).where(eq(ownerInbox.ownerId, userId)).orderBy(desc(ownerInbox.capturedAt)),
  ]);

  const items: CalItem[] = [];
  for (const ev of eventRows) {
    const durMs = ev.endAt ? ev.endAt.getTime() - ev.startAt.getTime() : 30 * 60_000;
    const occ = expandRecurrence(ev.startAt, ev.recurrence, from, to);
    for (const o of occ) {
      items.push({
        key: `${ev.id}@${ymd(o)}`,
        kind: ev.kind === "focus" ? "focus" : ev.kind === "reminder" ? "reminder" : "event",
        sourceId: ev.id,
        title: ev.title,
        start: o,
        end: ev.isAllDay ? null : new Date(o.getTime() + durMs),
        allDay: ev.isAllDay,
        color: ev.color,
        categoryId: ev.categoryId,
        status: ev.status,
        location: ev.location,
        person: ev.person,
        recurring: !!ev.recurrence,
      });
    }
  }
  for (const t of taskRows) {
    if (t.status === "cancelled") continue;
    const recBase = t.scheduledStart ?? t.dueDate;
    const occ = expandRecurrence(recBase ?? t.createdAt, t.recurrence, from, to);
    for (const o of occ) {
      if (t.scheduledStart || (t.recurrence && t.scheduledStart)) {
        const dur = t.scheduledEnd ? t.scheduledEnd.getTime() - t.scheduledStart!.getTime() : (t.estimatedMinutes ?? 30) * 60_000;
        items.push({
          key: `${t.id}@${ymd(o)}`, kind: "task-block", sourceId: t.id, title: t.title,
          start: o, end: new Date(o.getTime() + dur), allDay: false, color: null,
          categoryId: t.categoryId, status: t.status, location: null, person: null,
          recurring: !!t.recurrence, priority: t.priority,
        });
      } else if (t.dueDate || t.recurrence) {
        items.push({
          key: `${t.id}@${ymd(o)}`, kind: "task-due", sourceId: t.id, title: t.title,
          start: o, end: null, allDay: true, color: null,
          categoryId: t.categoryId, status: t.status, location: null, person: null,
          recurring: !!t.recurrence, priority: t.priority,
        });
      }
    }
  }
  items.sort((a, b) => (a.allDay === b.allDay ? a.start.getTime() - b.start.getTime() : a.allDay ? -1 : 1));

  return {
    categories,
    prefs: prefRows[0] ?? null,
    items: items.map(i => ({
      ...i,
      start: i.start.toISOString(),
      end: i.end ? i.end.toISOString() : null,
    })),
    tasks: taskRows.map(t => ({
      ...t,
      dueDate: t.dueDate ? t.dueDate.toISOString() : null,
      scheduledStart: t.scheduledStart ? t.scheduledStart.toISOString() : null,
      scheduledEnd: t.scheduledEnd ? t.scheduledEnd.toISOString() : null,
      createdAt: t.createdAt.toISOString(),
      updatedAt: t.updatedAt.toISOString(),
    })),
    events: eventRows.map(e => ({
      ...e,
      startAt: e.startAt.toISOString(),
      endAt: e.endAt ? e.endAt.toISOString() : null,
      createdAt: e.createdAt.toISOString(),
      updatedAt: e.updatedAt.toISOString(),
    })),
    inbox: inboxRows.map(i => ({
      ...i,
      capturedAt: i.capturedAt.toISOString(),
      createdAt: i.createdAt.toISOString(),
    })),
  } as any;
}

export function overdueTasks(bundle: OwnerBundle, now = new Date()): OwnerTask[] {
  return overdueTasksFrom(bundle.tasks, now);
}

export async function searchOwner(userId: string, q: string) {
  const like = `%${q}%`;
  const [ev, ta] = await Promise.all([
    db.select().from(ownerEvents).where(
      and(eq(ownerEvents.ownerId, userId), isNull(ownerEvents.deletedAt),
        or(ilike(ownerEvents.title, like), ilike(ownerEvents.location, like), ilike(ownerEvents.person, like), ilike(ownerEvents.description, like))),
    ).limit(12),
    db.select().from(ownerTasks).where(
      and(eq(ownerTasks.ownerId, userId), isNull(ownerTasks.deletedAt),
        or(ilike(ownerTasks.title, like), ilike(ownerTasks.notes, like), ilike(ownerTasks.description, like))),
    ).limit(12),
  ]);
  return [
    ...ev.map((e) => ({ type: "event" as const, id: e.id, title: e.title, when: e.startAt, kind: e.kind })),
    ...ta.map((t) => ({ type: "task" as const, id: t.id, title: t.title, when: t.scheduledStart ?? t.dueDate ?? t.createdAt, kind: "task" })),
  ];
}
