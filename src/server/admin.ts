"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray, isNull, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  projects, tasks, workers, updates, inventoryItems, settings, inquiries, timeEntries, payments, pianos, taskAssignees,
} from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { hashPin } from "@/lib/security";
import { randomUUID } from "crypto";
import { getProjectDetail, getWorkerDetail, getWebsiteContent } from "@/server/data";
import { HERO_IMAGE_KEY, HERO_IMAGE_MAX_CHARS, HERO_IMAGE_RE } from "@/lib/hero-image";
import { normalizeWebsiteContent, WEBSITE_CONTENT_KEY, type WebsiteContent } from "@/lib/website-content";

const touch = () => revalidatePath("/admin", "layout");

export type ProjectInput = {
  clientName: string; clientEmail?: string; clientPhone?: string; clientAddress?: string;
  pianoBrand: string; pianoModel: string; pianoYear?: number | null; serialNumber?: string;
  serviceType?: string; status?: string; dueDate?: string | null; assignedWorkerId?: string | null;
  imageUrl?: string; notes?: string;
};

export async function createProject(input: ProjectInput) {
  await requireUser();
  await db.insert(projects).values({
    clientName: input.clientName,
    clientEmail: input.clientEmail || null,
    clientPhone: input.clientPhone || null,
    clientAddress: input.clientAddress || null,
    pianoBrand: input.pianoBrand,
    pianoModel: input.pianoModel,
    pianoYear: input.pianoYear ?? null,
    serialNumber: input.serialNumber || null,
    serviceType: input.serviceType || "Full Restoration",
    status: input.status || "intake",
    dueDate: input.dueDate ? new Date(input.dueDate) : null,
    assignedWorkerId: input.assignedWorkerId || null,
    imageUrl: input.imageUrl || null,
    notes: input.notes || null,
  });
  touch();
  return { ok: true as const };
}

export async function updateProject(id: string, patch: Partial<ProjectInput> & { progress?: number }) {
  await requireUser();
  const { dueDate, ...rest } = patch;
  await db.update(projects).set({
    ...rest,
    ...(dueDate !== undefined ? { dueDate: dueDate ? new Date(dueDate) : null } : {}),
    updatedAt: new Date(),
  }).where(eq(projects.id, id));
  touch();
  return { ok: true as const };
}

export async function setProjectStatus(id: string, status: string) {
  await requireUser();
  const progressMap: Record<string, number> = { intake: 8, disassembly: 22, restoration: 50, finishing: 72, quality: 88, delivery: 98 };
  await db.update(projects).set({ status, ...(progressMap[status] ? { progress: progressMap[status] } : {}), updatedAt: new Date() }).where(eq(projects.id, id));
  touch();
  return { ok: true as const };
}

export async function deleteProject(id: string) {
  await requireUser();
  await db.delete(projects).where(eq(projects.id, id));
  touch();
  return { ok: true as const };
}

export async function rotatePortalLink(id: string) {
  await requireUser();
  await db.update(projects).set({ portalUuid: randomUUID(), updatedAt: new Date() }).where(eq(projects.id, id));
  touch();
  return { ok: true as const };
}

/* ================= TASKS ================= */

export type TaskInput = {
  kind?: "standalone" | "project";
  projectId?: string | null; title: string; description?: string; priority?: string;
  assignedWorkerId?: string | null; assigneeIds?: string[]; estimatedMinutes?: number; dueDate?: string | null;
  status?: string; waitingParts?: boolean;
};

/** Replace the task_assignees rows for a task with the given worker ids (dedup'd). Pass [] to clear. */
async function syncTaskAssignees(taskId: string, workerIds: string[]) {
  const ids = [...new Set(workerIds.filter(Boolean))];
  await db.delete(taskAssignees).where(eq(taskAssignees.taskId, taskId));
  if (ids.length) {
    await db.insert(taskAssignees).values(ids.map((workerId) => ({ taskId, workerId })));
  }
}

async function requireTaskOwner() {
  const user = await requireUser();
  if (user.role !== "owner") throw new Error("Only the owner can manage tasks.");
}

function taskInputError(input: Partial<TaskInput>) {
  if (input.title !== undefined && !input.title.trim()) return "Enter a task title.";
  if (input.kind === "project" && !input.projectId) return "Choose a project.";
  if (input.kind === "standalone" && input.projectId) return "Standalone tasks cannot have a project.";
  if (input.status !== undefined && !["backlog", "available", "claimed", "in_progress", "done"].includes(input.status)) return "Invalid task status.";
  if (input.priority !== undefined && !["low", "normal", "high", "urgent"].includes(input.priority)) return "Invalid priority.";
  if (input.estimatedMinutes !== undefined && (!Number.isInteger(input.estimatedMinutes) || input.estimatedMinutes <= 0)) return "Estimated minutes must be a positive whole number.";
  if (input.dueDate && Number.isNaN(new Date(input.dueDate).getTime())) return "Invalid due date.";
  return null;
}

export async function createTask(input: TaskInput) {
  await requireTaskOwner();
  const error = taskInputError(input);
  if (error) return { ok: false as const, error };
  const assigneeIds = input.assigneeIds ?? (input.assignedWorkerId ? [input.assignedWorkerId] : []);
  const primaryWorkerId = assigneeIds[0] ?? input.assignedWorkerId ?? null;
  const [row] = await db.insert(tasks).values({
    projectId: input.projectId || null,
    title: input.title,
    description: input.description || null,
    priority: input.priority || "normal",
    assignedWorkerId: primaryWorkerId,
    estimatedMinutes: input.estimatedMinutes ?? 60,
    dueDate: input.dueDate ? new Date(input.dueDate) : null,
    status: input.status || "available",
    waitingParts: input.waitingParts ?? false,
    completedAt: input.status === "done" ? new Date() : null,
  }).returning({ id: tasks.id });
  await syncTaskAssignees(row.id, assigneeIds);
  touch();
  return { ok: true as const };
}

export async function updateTask(id: string, patch: Partial<TaskInput>) {
  await requireTaskOwner();
  const error = taskInputError(patch);
  if (error) return { ok: false as const, error };
  const { dueDate, assigneeIds } = patch;
  const data: Record<string, unknown> = { updatedAt: new Date() };
  // Whitelist fields: archive state and claimant cannot be changed through a form payload.
  for (const key of ["projectId", "title", "description", "priority", "assignedWorkerId", "estimatedMinutes", "status", "waitingParts"] as const) {
    if (patch[key] !== undefined) data[key] = patch[key];
  }
  if (assigneeIds !== undefined) data.assignedWorkerId = assigneeIds[0] ?? null;
  if (dueDate !== undefined) data.dueDate = dueDate ? new Date(dueDate) : null;
  if (patch.status !== undefined) data.completedAt = patch.status === "done" ? sql`COALESCE(${tasks.completedAt}, now())` : null;
  if (patch.status === "available" || patch.status === "backlog") data.claimedByWorkerId = null;
  const [changed] = await db.update(tasks).set(data).where(and(eq(tasks.id, id), isNull(tasks.archivedAt))).returning({ id: tasks.id });
  if (!changed) return { ok: false as const, error: "Task is archived or no longer exists." };
  if (assigneeIds !== undefined) {
    await syncTaskAssignees(id, assigneeIds);
  } else if (patch.assignedWorkerId !== undefined) {
    // Legacy single-select path — mirror it into the join table so gating/display stay consistent.
    await syncTaskAssignees(id, patch.assignedWorkerId ? [patch.assignedWorkerId] : []);
  }
  if (patch.status && patch.status !== "in_progress") {
    await db.update(timeEntries).set({ taskId: null }).where(and(eq(timeEntries.taskId, id), isNull(timeEntries.clockOut)));
  }
  touch();
  return { ok: true as const };
}

function cleanTitles(titles: string[]) {
  return titles.map((t) => t.trim()).filter(Boolean);
}

async function bulkCreateTasks(rows: { projectId: string | null; title: string; assigneeIds: string[] }[]) {
  await db.transaction(async (tx) => {
    for (const r of rows) {
      const [created] = await tx.insert(tasks).values({
        projectId: r.projectId,
        title: r.title,
        status: "available",
        assignedWorkerId: r.assigneeIds[0] ?? null,
      }).returning({ id: tasks.id });
      if (r.assigneeIds.length) {
        await tx.insert(taskAssignees).values(r.assigneeIds.map((workerId) => ({ taskId: created.id, workerId })));
      }
    }
  });
}

export async function createAssignedWork(input: { titles: string[]; workerIds: string[] }) {
  await requireTaskOwner();
  const titles = cleanTitles(input.titles);
  const workerIds = [...new Set(input.workerIds.filter(Boolean))];
  if (!titles.length) return { ok: false as const, error: "Enter at least one work item." };
  if (!workerIds.length) return { ok: false as const, error: "Select at least one worker." };
  await bulkCreateTasks(titles.map((title) => ({ projectId: null, title, assigneeIds: workerIds })));
  touch();
  return { ok: true as const };
}

export async function createProjectWork(input: { projectId: string; titles: string[]; workerIds: string[] }) {
  await requireTaskOwner();
  const titles = cleanTitles(input.titles);
  const workerIds = [...new Set(input.workerIds.filter(Boolean))];
  if (!input.projectId) return { ok: false as const, error: "Choose a project." };
  if (!titles.length) return { ok: false as const, error: "Enter at least one work item." };
  if (!workerIds.length) return { ok: false as const, error: "Select at least one worker." };
  await bulkCreateTasks(titles.map((title) => ({ projectId: input.projectId, title, assigneeIds: workerIds })));
  touch();
  return { ok: true as const };
}

export async function createOpenWork(input: { titles: string[] }) {
  await requireTaskOwner();
  const titles = cleanTitles(input.titles);
  if (!titles.length) return { ok: false as const, error: "Enter at least one work item." };
  await bulkCreateTasks(titles.map((title) => ({ projectId: null, title, assigneeIds: [] })));
  touch();
  return { ok: true as const };
}

export async function setTaskStatus(id: string, status: string) {
  return updateTask(id, { status });
}

export async function deleteTask(id: string) {
  await requireTaskOwner();
  await db.delete(tasks).where(eq(tasks.id, id));
  touch();
  return { ok: true as const };
}

export async function archiveTask(id: string) {
  await requireTaskOwner();
  const [changed] = await db.update(tasks).set({ archivedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(tasks.id, id), eq(tasks.status, "done"), isNull(tasks.archivedAt))).returning({ id: tasks.id });
  if (!changed) return { ok: false as const, error: "Only completed, unarchived tasks can be archived." };
  touch();
  return { ok: true as const };
}

export async function restoreTask(id: string) {
  await requireTaskOwner();
  const [changed] = await db.update(tasks).set({ archivedAt: null, updatedAt: new Date() })
    .where(and(eq(tasks.id, id), isNotNull(tasks.archivedAt))).returning({ id: tasks.id });
  if (!changed) return { ok: false as const, error: "Archived task not found." };
  touch();
  return { ok: true as const };
}

/* ================= WORKERS ================= */

export async function createWorker(input: { name: string; title?: string; hourlyRateCents: number; pin: string; avatarUrl?: string }) {
  await requireUser();
  if (!/^\d{4}$/.test(input.pin)) return { ok: false as const, error: "PIN must be exactly 4 digits." };
  await db.insert(workers).values({
    name: input.name,
    title: input.title || "Technician",
    hourlyRateCents: input.hourlyRateCents,
    pinHash: hashPin(input.pin),
    avatarUrl: input.avatarUrl || null,
  });
  touch();
  return { ok: true as const };
}

export async function updateWorker(id: string, patch: { name?: string; title?: string; hourlyRateCents?: number; active?: boolean; avatarUrl?: string | null }) {
  await requireUser();
  await db.update(workers).set(patch).where(eq(workers.id, id));
  touch();
  return { ok: true as const };
}

export async function resetWorkerPin(id: string, pin: string) {
  await requireUser();
  if (!/^\d{4}$/.test(pin)) return { ok: false as const, error: "PIN must be exactly 4 digits." };
  await db.update(workers).set({ pinHash: hashPin(pin) }).where(eq(workers.id, id));
  touch();
  return { ok: true as const };
}

export async function deleteWorker(id: string) {
  await requireUser();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return { ok: false as const, error: "Invalid worker account." };
  }
  await db.transaction(async (tx) => {
    // Release unfinished claims so other workers can pick up the work.
    await tx.update(tasks).set({
      status: "available", claimedByWorkerId: null, updatedAt: new Date(),
    }).where(and(eq(tasks.claimedByWorkerId, id), inArray(tasks.status, ["claimed", "in_progress"])));
    // Existing foreign keys cascade attendance, breaks, and payments, and clear assignments.
    await tx.delete(workers).where(eq(workers.id, id));
  });
  touch();
  revalidatePath("/workshop");
  return { ok: true as const };
}

/* ================= INVENTORY ================= */

export type InventoryInput = {
  name: string; category: string; sku?: string; supplier?: string; qtyOnHand?: number;
  unitCostCents?: number; reorderPoint?: number; location?: string; notes?: string;
};

export async function createInventoryItem(input: InventoryInput) {
  await requireUser();
  await db.insert(inventoryItems).values({
    name: input.name, category: input.category || "General",
    sku: input.sku || null, supplier: input.supplier || null,
    qtyOnHand: input.qtyOnHand ?? 0, unitCostCents: input.unitCostCents ?? 0,
    reorderPoint: input.reorderPoint ?? 0, location: input.location || null, notes: input.notes || null,
  });
  touch();
  return { ok: true as const };
}

export async function updateInventoryItem(id: string, patch: Partial<InventoryInput>) {
  await requireUser();
  await db.update(inventoryItems).set({ ...patch, updatedAt: new Date() }).where(eq(inventoryItems.id, id));
  touch();
  return { ok: true as const };
}

export async function adjustInventoryQty(id: string, delta: number) {
  await requireUser();
  await db.update(inventoryItems)
    .set({ qtyOnHand: sql`GREATEST(0, ${inventoryItems.qtyOnHand} + ${delta})`, updatedAt: new Date() })
    .where(eq(inventoryItems.id, id));
  touch();
  return { ok: true as const };
}

export async function deleteInventoryItem(id: string) {
  await requireUser();
  await db.delete(inventoryItems).where(eq(inventoryItems.id, id));
  touch();
  return { ok: true as const };
}

/* ================= SHOWROOM ================= */

export type PianoInput = {
  brand: string; model: string; year?: number | null; type?: string; condition?: string;
  description?: string; technicianNotes?: string; dimensions?: string; recommendedUse?: string;
  priceCents?: number | null; status?: string; imageUrl?: string; sortOrder?: number;
};

export async function createPiano(input: PianoInput) {
  await requireUser();
  await db.insert(pianos).values({
    brand: input.brand, model: input.model, year: input.year ?? null,
    type: input.type || "Grand", condition: input.condition || "Restored",
    description: input.description || null, technicianNotes: input.technicianNotes || null,
    dimensions: input.dimensions || null, recommendedUse: input.recommendedUse || "Home",
    priceCents: input.priceCents ?? null, status: input.status || "available",
    imageUrl: input.imageUrl || null, sortOrder: input.sortOrder ?? 0,
  });
  touch();
  return { ok: true as const };
}

// Never accepts costCents — cost/margin is edited only via updatePianoCost, from the separate private cost page.
export async function updatePiano(id: string, patch: Partial<PianoInput>) {
  await requireUser();
  const { ...rest } = patch;
  await db.update(pianos).set(rest).where(eq(pianos.id, id));
  touch();
  return { ok: true as const };
}

export async function setPianoStatus(id: string, status: string) {
  await requireUser();
  await db.update(pianos).set({ status }).where(eq(pianos.id, id));
  touch();
  return { ok: true as const };
}

export async function updatePianoCost(id: string, costCents: number | null) {
  await requireUser();
  await db.update(pianos).set({ costCents }).where(eq(pianos.id, id));
  touch();
  return { ok: true as const };
}

export async function deletePiano(id: string) {
  await requireUser();
  await db.delete(pianos).where(eq(pianos.id, id));
  touch();
  return { ok: true as const };
}

/* ================= CURATOR / STORY ================= */

export async function createUpdate(input: { projectId: string; title: string; body?: string; imageUrl?: string; visible?: boolean }) {
  await requireUser();
  const [max] = await db.select({ m: sql<number>`COALESCE(MAX(${updates.position}),0)` }).from(updates).where(eq(updates.projectId, input.projectId));
  await db.insert(updates).values({
    projectId: input.projectId, title: input.title, body: input.body || null,
    imageUrl: input.imageUrl || null, isVisibleToClient: input.visible ?? false,
    position: (max?.m ?? 0) + 1, updateDate: new Date(),
  });
  if (input.visible) {
    await db.update(projects).set({ lastClientUpdateAt: new Date() }).where(eq(projects.id, input.projectId));
  }
  touch();
  return { ok: true as const };
}

export async function toggleUpdateVisibility(id: string, visible: boolean, projectId: string) {
  await requireUser();
  await db.update(updates).set({ isVisibleToClient: visible }).where(eq(updates.id, id));
  if (visible) await db.update(projects).set({ lastClientUpdateAt: new Date() }).where(eq(projects.id, projectId));
  touch();
  return { ok: true as const };
}

export async function reorderUpdates(projectId: string, orderedIds: string[]) {
  await requireUser();
  await Promise.all(orderedIds.map((id, i) => db.update(updates).set({ position: i + 1 }).where(eq(updates.id, id))));
  touch();
  return { ok: true as const };
}

export async function deleteUpdate(id: string) {
  await requireUser();
  await db.delete(updates).where(eq(updates.id, id));
  touch();
  return { ok: true as const };
}

export async function publishAllUpdates(projectId: string) {
  await requireUser();
  await db.update(updates).set({ isVisibleToClient: true }).where(eq(updates.projectId, projectId));
  await db.update(projects).set({ lastClientUpdateAt: new Date() }).where(eq(projects.id, projectId));
  touch();
  return { ok: true as const };
}

/* ================= MISC ================= */

export async function resolveInquiry(id: string) {
  await requireUser();
  await db.update(inquiries).set({ status: "handled" }).where(eq(inquiries.id, id));
  touch();
  return { ok: true as const };
}

export async function saveStaleDays(days: number) {
  await requireUser();
  await db.insert(settings).values({ key: "staleUpdateDays", value: String(days) })
    .onConflictDoUpdate({ target: settings.key, set: { value: String(days) } });
  touch();
  return { ok: true as const };
}

export async function saveWebsiteContent(input: WebsiteContent) {
  await requireUser();
  // The hero-photo version is owned by saveHeroImage/removeHeroImage — never trust it from the editor payload.
  const current = await getWebsiteContent();
  const next = normalizeWebsiteContent(input);
  next.hero.imageVersion = current.hero.imageVersion;
  const value = JSON.stringify(next);
  await db.insert(settings).values({ key: WEBSITE_CONTENT_KEY, value })
    .onConflictDoUpdate({ target: settings.key, set: { value } });
  touch();
  revalidatePath("/");
  revalidatePath("/admin/website");
  return { ok: true as const };
}

export async function saveHeroImage(dataUrl: string, alt: string) {
  await requireUser();
  if (typeof dataUrl !== "string" || dataUrl.length > HERO_IMAGE_MAX_CHARS || !HERO_IMAGE_RE.test(dataUrl)) {
    return { ok: false as const, error: "Please upload a JPG, PNG or WebP image under 4MB." };
  }
  const content = await getWebsiteContent();
  const version = String(Date.now());
  const next = normalizeWebsiteContent({ ...content, hero: { ...content.hero, imageVersion: version, imageAlt: alt.trim() || content.hero.imageAlt } });
  await db.insert(settings).values({ key: HERO_IMAGE_KEY, value: dataUrl })
    .onConflictDoUpdate({ target: settings.key, set: { value: dataUrl } });
  const value = JSON.stringify(next);
  await db.insert(settings).values({ key: WEBSITE_CONTENT_KEY, value })
    .onConflictDoUpdate({ target: settings.key, set: { value } });
  touch();
  revalidatePath("/");
  return { ok: true as const, version, alt: next.hero.imageAlt ?? "" };
}

export async function removeHeroImage() {
  await requireUser();
  const content = await getWebsiteContent();
  const next = normalizeWebsiteContent({ ...content, hero: { ...content.hero, imageVersion: undefined, imageAlt: undefined } });
  await db.delete(settings).where(eq(settings.key, HERO_IMAGE_KEY));
  const value = JSON.stringify(next);
  await db.insert(settings).values({ key: WEBSITE_CONTENT_KEY, value })
    .onConflictDoUpdate({ target: settings.key, set: { value } });
  touch();
  revalidatePath("/");
  return { ok: true as const };
}

export async function fetchProjectDetail(id: string) {
  await requireUser();
  return getProjectDetail(id);
}

export async function fetchWorkerDetail(id: string) {
  await requireUser();
  return getWorkerDetail(id);
}

export async function fetchProjectUpdates(projectId: string) {
  await requireUser();
  return db.select().from(updates).where(eq(updates.projectId, projectId)).orderBy(updates.position);
}

/* ================= TIMESHEET / PAYROLL ================= */

export async function recordPayment(entryId: string, amountCents: number) {
  await requireUser();
  if (!Number.isFinite(amountCents) || amountCents <= 0) {
    return { ok: false as const, error: "Enter an amount greater than zero." };
  }
  await db.insert(payments).values({ timeEntryId: entryId, amountCents });
  await db
    .update(timeEntries)
    .set({ paidCents: sql`${timeEntries.paidCents} + ${amountCents}` })
    .where(eq(timeEntries.id, entryId));
  touch();
  return { ok: true as const };
}
