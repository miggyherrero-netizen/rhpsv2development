"use server";

import { cookies } from "next/headers";
import { and, asc, eq, isNull, ne, or, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { workers, timeEntries, workerBreaks, tasks, projects, taskAssignees, type Worker } from "@/db/schema";
import { verifyPin, signPayload, verifySigned } from "@/lib/security";

const WORKER_COOKIE = "hp_worker";
const SESSION_MS = 14 * 3_600_000;

export type KioskWorker = Pick<Worker, "id" | "name" | "title" | "avatarUrl">;

export async function getKioskWorkers(): Promise<KioskWorker[]> {
  return db
    .select({ id: workers.id, name: workers.name, title: workers.title, avatarUrl: workers.avatarUrl })
    .from(workers)
    .where(eq(workers.active, true))
    .orderBy(asc(workers.name));
}

export async function verifyWorkerPin(workerId: string, pin: string) {
  const [w] = await db.select().from(workers).where(eq(workers.id, workerId)).limit(1);
  if (!w || !w.active) return { ok: false as const, error: "This account is inactive." };
  if (!/^\d{4}$/.test(pin) || !verifyPin(pin, w.pinHash)) {
    return { ok: false as const, error: "Incorrect PIN" };
  }
  const payload = `${w.id}:${Date.now() + SESSION_MS}`;
  const jar = await cookies();
  jar.set(WORKER_COOKIE, signPayload(payload), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MS / 1000,
  });
  return { ok: true as const };
}

async function workerFromCookie(): Promise<Worker | null> {
  const jar = await cookies();
  const payload = verifySigned(jar.get(WORKER_COOKIE)?.value);
  if (!payload) return null;
  const [id, exp] = payload.split(":");
  if (!id || Number(exp) < Date.now()) return null;
  const [w] = await db.select().from(workers).where(eq(workers.id, id)).limit(1);
  return w?.active ? w : null;
}

export async function signOutWorker() {
  const jar = await cookies();
  jar.delete(WORKER_COOKIE);
  return { ok: true as const };
}

export async function getWorkerState() {
  const w = await workerFromCookie();
  if (!w) return null;
  const [openEntry] = await db
    .select()
    .from(timeEntries)
    .where(and(eq(timeEntries.workerId, w.id), isNull(timeEntries.clockOut)))
    .limit(1);
  const allTasks = await db
    .select({ task: tasks, project: projects })
    .from(tasks)
    .leftJoin(projects, eq(projects.id, tasks.projectId))
    .where(isNull(tasks.archivedAt))
    .orderBy(asc(tasks.position));
  const taskIds = allTasks.map((r) => r.task.id);
  const assigneeRows = taskIds.length ? await db.select().from(taskAssignees).where(inArray(taskAssignees.taskId, taskIds)) : [];
  const assigneesByTask = new Map<string, Set<string>>();
  for (const a of assigneeRows) {
    const s = assigneesByTask.get(a.taskId) ?? new Set<string>();
    s.add(a.workerId);
    assigneesByTask.set(a.taskId, s);
  }
  // A task with no rows in taskAssignees is open to all (mirrors isNull(assignedWorkerId) semantics).
  const isOpenOrMine = (taskId: string) => {
    const set = assigneesByTask.get(taskId);
    return !set || set.size === 0 || set.has(w.id);
  };
  const shape = (r: (typeof allTasks)[number]) => ({
    id: r.task.id,
    title: r.task.title,
    status: r.task.status,
    priority: r.task.priority,
    estimatedMinutes: r.task.estimatedMinutes,
    dueDate: r.task.dueDate ? r.task.dueDate.toISOString() : null,
    waitingParts: r.task.waitingParts,
    piano: r.project ? `${r.project.pianoBrand} ${r.project.pianoModel}` : "Shop",
    client: r.project?.clientName ?? null,
  });
  return {
    worker: { id: w.id, name: w.name, title: w.title, avatarUrl: w.avatarUrl },
    clock: openEntry
      ? {
          entryId: openEntry.id, clockIn: openEntry.clockIn.toISOString(), rateCents: openEntry.rateAtClockInCents,
          taskId: openEntry.taskId, onBreak: openEntry.onBreak,
          breakStartedAt: openEntry.breakStartedAt ? openEntry.breakStartedAt.toISOString() : null,
          breakMinutes: openEntry.breakMinutes,
        }
      : null,
    myActive: allTasks.filter((r) => r.task.claimedByWorkerId === w.id && ["claimed", "in_progress"].includes(r.task.status)).map(shape),
    myAssigned: allTasks.filter((r) => !r.task.claimedByWorkerId && r.task.status === "available" && (assigneesByTask.get(r.task.id)?.has(w.id) ?? false)).map(shape),
    available: allTasks.filter((r) => r.task.status === "available" && !r.task.claimedByWorkerId && isOpenOrMine(r.task.id)).map(shape),
    completed: allTasks.filter((r) => r.task.status === "done" && (r.task.claimedByWorkerId === w.id || (!r.task.claimedByWorkerId && isOpenOrMine(r.task.id)))).map(shape),
  };
}
export type WorkerState = NonNullable<Awaited<ReturnType<typeof getWorkerState>>>;
export type KioskTask = WorkerState["available"][number];

export async function clockIn() {
  const w = await workerFromCookie();
  if (!w) return { ok: false as const, error: "Session expired" };
  const [open] = await db.select().from(timeEntries).where(and(eq(timeEntries.workerId, w.id), isNull(timeEntries.clockOut))).limit(1);
  if (open) return { ok: true as const };
  await db.insert(timeEntries).values({ workerId: w.id, clockIn: new Date(), rateAtClockInCents: w.hourlyRateCents });
  return { ok: true as const };
}

export async function clockOut() {
  const w = await workerFromCookie();
  if (!w) return { ok: false as const, error: "Session expired" };
  const [open] = await db.select().from(timeEntries).where(and(eq(timeEntries.workerId, w.id), isNull(timeEntries.clockOut))).limit(1);
  if (!open) return { ok: true as const };
  const now = new Date();
  const extraBreakMs = open.onBreak && open.breakStartedAt ? now.getTime() - open.breakStartedAt.getTime() : 0;
  if (open.onBreak) {
    await db
      .update(workerBreaks)
      .set({ endedAt: now })
      .where(and(eq(workerBreaks.timeEntryId, open.id), isNull(workerBreaks.endedAt)));
  }
  await db
    .update(timeEntries)
    .set({
      clockOut: now,
      onBreak: false,
      breakStartedAt: null,
      breakMinutes: open.breakMinutes + Math.round(extraBreakMs / 60_000),
    })
    .where(eq(timeEntries.id, open.id));
  return { ok: true as const };
}

export async function startBreak() {
  const w = await workerFromCookie();
  if (!w) return { ok: false as const, error: "Session expired" };
  const [open] = await db
    .select()
    .from(timeEntries)
    .where(and(eq(timeEntries.workerId, w.id), isNull(timeEntries.clockOut), eq(timeEntries.onBreak, false)))
    .limit(1);
  if (!open) return { ok: true as const };
  const now = new Date();
  await db.update(timeEntries).set({ onBreak: true, breakStartedAt: now }).where(eq(timeEntries.id, open.id));
  await db.insert(workerBreaks).values({ timeEntryId: open.id, startedAt: now, endedAt: null });
  return { ok: true as const };
}

export async function endBreak() {
  const w = await workerFromCookie();
  if (!w) return { ok: false as const, error: "Session expired" };
  const [open] = await db.select().from(timeEntries).where(and(eq(timeEntries.workerId, w.id), isNull(timeEntries.clockOut))).limit(1);
  if (!open || !open.onBreak || !open.breakStartedAt) return { ok: true as const };
  const now = new Date();
  const elapsedMinutes = Math.round((now.getTime() - open.breakStartedAt.getTime()) / 60_000);
  await db
    .update(timeEntries)
    .set({ onBreak: false, breakStartedAt: null, breakMinutes: open.breakMinutes + elapsedMinutes })
    .where(eq(timeEntries.id, open.id));
  await db
    .update(workerBreaks)
    .set({ endedAt: now })
    .where(and(eq(workerBreaks.timeEntryId, open.id), isNull(workerBreaks.endedAt)));
  return { ok: true as const };
}

export async function claimTask(taskId: string) {
  return startTask(taskId);
}

export async function startTask(taskId: string) {
  const w = await workerFromCookie();
  if (!w) return { ok: false as const, error: "Session expired" };
  const result = await db.transaction(async (tx) => {
    // Serialize this worker's task switches; competing workers still use a conditional claim.
    await tx.select({ id: workers.id }).from(workers).where(eq(workers.id, w.id)).for("update");
    // Open to all = no rows in task_assignees for this task; otherwise the worker must be one of the assignees.
    const openOrMine = sql`(NOT EXISTS (SELECT 1 FROM ${taskAssignees} WHERE ${taskAssignees.taskId} = ${tasks.id}) OR EXISTS (SELECT 1 FROM ${taskAssignees} WHERE ${taskAssignees.taskId} = ${tasks.id} AND ${taskAssignees.workerId} = ${w.id}))`;
    const [taken] = await tx.update(tasks)
      .set({ status: "in_progress", claimedByWorkerId: w.id, updatedAt: new Date() })
      .where(and(eq(tasks.id, taskId), isNull(tasks.archivedAt), or(
        and(eq(tasks.status, "available"), isNull(tasks.claimedByWorkerId), openOrMine),
        and(inArray(tasks.status, ["claimed", "in_progress"]), eq(tasks.claimedByWorkerId, w.id)),
      )))
      .returning({ id: tasks.id });
    if (!taken) return { ok: false as const, error: "This task is no longer available to you. Refresh and choose another." };
    await tx.update(tasks).set({ status: "claimed", updatedAt: new Date() })
      .where(and(eq(tasks.claimedByWorkerId, w.id), eq(tasks.status, "in_progress"), ne(tasks.id, taskId)));
    await tx.update(timeEntries).set({ taskId })
      .where(and(eq(timeEntries.workerId, w.id), isNull(timeEntries.clockOut)));
    return { ok: true as const };
  });
  revalidatePath("/admin", "layout");
  return result;
}

export async function finishTask(taskId: string) {
  const w = await workerFromCookie();
  if (!w) return { ok: false as const, error: "Session expired" };
  const result = await db.transaction(async (tx) => {
    await tx.select({ id: workers.id }).from(workers).where(eq(workers.id, w.id)).for("update");
    const [done] = await tx.update(tasks)
      .set({ status: "done", completedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(tasks.id, taskId), eq(tasks.claimedByWorkerId, w.id), inArray(tasks.status, ["claimed", "in_progress"]), isNull(tasks.archivedAt)))
      .returning({ id: tasks.id });
    if (!done) return { ok: false as const, error: "Only your taken tasks can be marked done." };
    await tx.update(timeEntries).set({ taskId: null })
      .where(and(eq(timeEntries.workerId, w.id), eq(timeEntries.taskId, taskId), isNull(timeEntries.clockOut)));
    return { ok: true as const };
  });
  revalidatePath("/admin", "layout");
  return result;
}

export async function releaseTask(taskId: string) {
  const w = await workerFromCookie();
  if (!w) return { ok: false as const, error: "Session expired" };
  const result = await db.transaction(async (tx) => {
    await tx.select({ id: workers.id }).from(workers).where(eq(workers.id, w.id)).for("update");
    const [released] = await tx.update(tasks)
      .set({ status: "available", claimedByWorkerId: null, updatedAt: new Date() })
      .where(and(eq(tasks.id, taskId), eq(tasks.claimedByWorkerId, w.id), inArray(tasks.status, ["claimed", "in_progress"]), isNull(tasks.archivedAt)))
      .returning({ id: tasks.id });
    if (!released) return { ok: false as const, error: "Only your unfinished tasks can be released." };
    await tx.update(timeEntries).set({ taskId: null })
      .where(and(eq(timeEntries.workerId, w.id), eq(timeEntries.taskId, taskId), isNull(timeEntries.clockOut)));
    return { ok: true as const };
  });
  revalidatePath("/admin", "layout");
  return result;
}
