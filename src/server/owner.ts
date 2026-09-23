"use server";

import { revalidatePath } from "next/cache";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { ownerEvents, ownerTasks, ownerInbox, ownerCategories, ownerPreferences } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { RECURRENCE_PRESETS, type Recurrence } from "@/lib/dates";

const touch = () => revalidatePath("/owner", "layout");
const recFromKey = (key?: string | null): Recurrence | null =>
  RECURRENCE_PRESETS.find((p) => p.key === (key ?? "none"))?.rec ?? null;

/* ================= EVENTS ================= */

export type OwnerEventInput = {
  title: string; kind?: string; startAt: string; endAt?: string | null; isAllDay?: boolean;
  location?: string; person?: string; categoryId?: string | null; color?: string | null;
  reminderMinutes?: number | null; recurrenceKey?: string; notes?: string; description?: string;
};

export async function createOwnerEvent(input: OwnerEventInput) {
  const user = await requireUser();
  await db.insert(ownerEvents).values({
    ownerId: user.id,
    title: input.title,
    kind: input.kind || "event",
    startAt: new Date(input.startAt),
    endAt: input.endAt ? new Date(input.endAt) : null,
    isAllDay: input.isAllDay ?? false,
    location: input.location || null,
    person: input.person || null,
    categoryId: input.categoryId || null,
    color: input.color || null,
    reminderMinutes: input.reminderMinutes ?? null,
    recurrence: recFromKey(input.recurrenceKey),
    notes: input.notes || null,
    description: input.description || null,
  });
  touch();
  return { ok: true as const };
}

export async function updateOwnerEvent(id: string, patch: Partial<OwnerEventInput> & { status?: string }) {
  const user = await requireUser();
  const { startAt, endAt, recurrenceKey, ...rest } = patch;
  await db.update(ownerEvents).set({
    ...rest,
    ...(startAt ? { startAt: new Date(startAt) } : {}),
    ...(endAt !== undefined ? { endAt: endAt ? new Date(endAt) : null } : {}),
    ...(recurrenceKey !== undefined ? { recurrence: recFromKey(recurrenceKey) } : {}),
    updatedAt: new Date(),
  }).where(and(eq(ownerEvents.id, id), eq(ownerEvents.ownerId, user.id)));
  touch();
  return { ok: true as const };
}

/** mode: "series" edits whole record; "occurrence" exempts a single date. */
export async function deleteOwnerEvent(id: string, mode: "series" | "occurrence", dateYmd?: string) {
  const user = await requireUser();
  const [ev] = await db.select().from(ownerEvents).where(and(eq(ownerEvents.id, id), eq(ownerEvents.ownerId, user.id))).limit(1);
  if (!ev) return { ok: false as const };
  if (mode === "occurrence" && ev.recurrence && dateYmd) {
    const rec: Recurrence = { ...ev.recurrence, exdates: [...(ev.recurrence.exdates ?? []), dateYmd] };
    await db.update(ownerEvents).set({ recurrence: rec, updatedAt: new Date() }).where(eq(ownerEvents.id, id));
  } else {
    await db.update(ownerEvents).set({ deletedAt: new Date() }).where(eq(ownerEvents.id, id));
  }
  touch();
  return { ok: true as const };
}

export async function completeOwnerEvent(id: string, mode: "series" | "occurrence", dateYmd?: string) {
  const user = await requireUser();
  const [ev] = await db.select().from(ownerEvents).where(and(eq(ownerEvents.id, id), eq(ownerEvents.ownerId, user.id))).limit(1);
  if (!ev) return { ok: false as const };
  if (mode === "occurrence" && ev.recurrence && dateYmd) {
    const rec: Recurrence = { ...ev.recurrence, exdates: [...(ev.recurrence.exdates ?? []), dateYmd] };
    await db.update(ownerEvents).set({ recurrence: rec }).where(eq(ownerEvents.id, id));
    const base = new Date(`${dateYmd}T00:00:00`);
    const start = new Date(base); start.setHours(ev.startAt.getHours(), ev.startAt.getMinutes());
    const dur = ev.endAt ? ev.endAt.getTime() - ev.startAt.getTime() : 30 * 60_000;
    await db.insert(ownerEvents).values({
      ownerId: user.id, title: ev.title, kind: ev.kind, startAt: start,
      endAt: new Date(start.getTime() + dur), categoryId: ev.categoryId, color: ev.color,
      location: ev.location, status: "done", completedAt: new Date(),
    });
  } else {
    await db.update(ownerEvents).set({ status: "done", completedAt: new Date(), updatedAt: new Date() }).where(eq(ownerEvents.id, id));
  }
  touch();
  return { ok: true as const };
}

export async function duplicateOwnerEvent(id: string) {
  const user = await requireUser();
  const [ev] = await db.select().from(ownerEvents).where(and(eq(ownerEvents.id, id), eq(ownerEvents.ownerId, user.id))).limit(1);
  if (!ev) return { ok: false as const };
  await db.insert(ownerEvents).values({
    ownerId: user.id, title: `${ev.title}`, kind: ev.kind, startAt: ev.startAt, endAt: ev.endAt,
    isAllDay: ev.isAllDay, location: ev.location, person: ev.person, categoryId: ev.categoryId,
    color: ev.color, notes: ev.notes, description: ev.description, reminderMinutes: ev.reminderMinutes,
  });
  touch();
  return { ok: true as const };
}

/* ================= TASKS ================= */

export type OwnerTaskInput = {
  title: string; description?: string; dueDate?: string | null; scheduledStart?: string | null;
  scheduledEnd?: string | null; estimatedMinutes?: number | null; priority?: string;
  categoryId?: string | null; notes?: string; recurrenceKey?: string; reminderMinutes?: number | null;
};

const taskPatch = (input: Partial<OwnerTaskInput>) => {
  const { dueDate, scheduledStart, scheduledEnd, recurrenceKey, ...rest } = input;
  return {
    ...rest,
    ...(dueDate !== undefined ? { dueDate: dueDate ? new Date(dueDate) : null } : {}),
    ...(scheduledStart !== undefined ? { scheduledStart: scheduledStart ? new Date(scheduledStart) : null } : {}),
    ...(scheduledEnd !== undefined ? { scheduledEnd: scheduledEnd ? new Date(scheduledEnd) : null } : {}),
    ...(recurrenceKey !== undefined ? { recurrence: recFromKey(recurrenceKey) } : {}),
    updatedAt: new Date(),
  };
};

export async function createOwnerTask(input: OwnerTaskInput) {
  const user = await requireUser();
  await db.insert(ownerTasks).values({ ownerId: user.id, title: input.title, ...taskPatch(input) });
  touch();
  return { ok: true as const };
}

export async function updateOwnerTask(id: string, patch: Partial<OwnerTaskInput>) {
  const user = await requireUser();
  await db.update(ownerTasks).set(taskPatch(patch)).where(and(eq(ownerTasks.id, id), eq(ownerTasks.ownerId, user.id)));
  touch();
  return { ok: true as const };
}

export async function setOwnerTaskDone(id: string, done: boolean) {
  const user = await requireUser();
  await db.update(ownerTasks).set({
    status: done ? "done" : "pending",
    completedAt: done ? new Date() : null,
    updatedAt: new Date(),
  }).where(and(eq(ownerTasks.id, id), eq(ownerTasks.ownerId, user.id)));
  touch();
  return { ok: true as const };
}

export async function cancelOwnerTask(id: string) {
  const user = await requireUser();
  await db.update(ownerTasks).set({ status: "cancelled", updatedAt: new Date() }).where(and(eq(ownerTasks.id, id), eq(ownerTasks.ownerId, user.id)));
  touch();
  return { ok: true as const };
}

export async function scheduleOwnerTask(id: string, startIso: string | null, endIso: string | null) {
  const user = await requireUser();
  await db.update(ownerTasks).set({
    scheduledStart: startIso ? new Date(startIso) : null,
    scheduledEnd: endIso ? new Date(endIso) : null,
    updatedAt: new Date(),
  }).where(and(eq(ownerTasks.id, id), eq(ownerTasks.ownerId, user.id)));
  touch();
  return { ok: true as const };
}

export async function postponeOwnerTask(id: string, dateIso: string) {
  const user = await requireUser();
  await db.update(ownerTasks).set({ dueDate: new Date(dateIso), scheduledStart: null, scheduledEnd: null, updatedAt: new Date() })
    .where(and(eq(ownerTasks.id, id), eq(ownerTasks.ownerId, user.id)));
  touch();
  return { ok: true as const };
}

export async function toggleOnToday(id: string, onToday: boolean) {
  const user = await requireUser();
  await db.update(ownerTasks).set({ onToday, updatedAt: new Date() }).where(and(eq(ownerTasks.id, id), eq(ownerTasks.ownerId, user.id)));
  touch();
  return { ok: true as const };
}

export async function deleteOwnerTask(id: string) {
  const user = await requireUser();
  await db.update(ownerTasks).set({ deletedAt: new Date() }).where(and(eq(ownerTasks.id, id), eq(ownerTasks.ownerId, user.id)));
  touch();
  return { ok: true as const };
}

/* ================= INBOX ================= */

export async function addInboxItem(title: string, priority?: string, dueDate?: string | null, notes?: string) {
  const user = await requireUser();
  await db.insert(ownerInbox).values({
    ownerId: user.id, title, priority: priority || "normal",
    dueDate: dueDate ? new Date(dueDate) : null, notes: notes || null,
  });
  touch();
  return { ok: true as const };
}

export async function archiveInboxItem(id: string) {
  const user = await requireUser();
  await db.update(ownerInbox).set({ processedAt: new Date(), convertedType: "archived" })
    .where(and(eq(ownerInbox.id, id), eq(ownerInbox.ownerId, user.id)));
  touch();
  return { ok: true as const };
}

export async function convertInboxItem(id: string, type: "task" | "event" | "reminder", dateIso?: string | null) {
  const user = await requireUser();
  const [item] = await db.select().from(ownerInbox).where(and(eq(ownerInbox.id, id), eq(ownerInbox.ownerId, user.id))).limit(1);
  if (!item || item.processedAt) return { ok: false as const };
  const when = dateIso ? new Date(dateIso) : null;
  if (type === "task") {
    await db.insert(ownerTasks).values({ ownerId: user.id, title: item.title, notes: item.notes, priority: item.priority, dueDate: when ?? item.dueDate });
  } else {
    const start = when ?? (() => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); return d; })();
    await db.insert(ownerEvents).values({
      ownerId: user.id, title: item.title, kind: type === "reminder" ? "reminder" : "event",
      startAt: start, endAt: new Date(start.getTime() + 45 * 60_000), notes: item.notes,
    });
  }
  await db.update(ownerInbox).set({ processedAt: new Date(), convertedType: type }).where(eq(ownerInbox.id, id));
  touch();
  return { ok: true as const };
}

/* ================= CATEGORIES & PREFS ================= */

export async function createCategory(name: string, color: string) {
  const user = await requireUser();
  await db.insert(ownerCategories).values({ name, color, position: 99 });
  touch();
  return { ok: true as const };
}

export async function updateCategory(id: string, patch: { name?: string; color?: string; hidden?: boolean }) {
  await requireUser();
  await db.update(ownerCategories).set(patch).where(eq(ownerCategories.id, id));
  touch();
  return { ok: true as const };
}

export async function deleteCategory(id: string, reassignTo: string | null) {
  await requireUser();
  await db.update(ownerEvents).set({ categoryId: reassignTo }).where(eq(ownerEvents.categoryId, id));
  await db.update(ownerTasks).set({ categoryId: reassignTo }).where(eq(ownerTasks.categoryId, id));
  await db.delete(ownerCategories).where(eq(ownerCategories.id, id));
  touch();
  return { ok: true as const };
}

export type PrefsPatch = {
  defaultView?: string; weekStart?: number; timeFormat?: string; defaultEventMinutes?: number;
  defaultTaskPriority?: string; showWeekends?: boolean; showCompleted?: boolean;
  workingHours?: Record<number, [number, number] | null>; timezone?: string;
};

export async function updatePreferences(patch: PrefsPatch) {
  const user = await requireUser();
  const [existing] = await db.select().from(ownerPreferences).where(eq(ownerPreferences.ownerId, user.id)).limit(1);
  if (existing) {
    await db.update(ownerPreferences).set({ ...patch, updatedAt: new Date() }).where(eq(ownerPreferences.id, existing.id));
  } else {
    await db.insert(ownerPreferences).values({ ownerId: user.id, ...patch });
  }
  touch();
  return { ok: true as const };
}
