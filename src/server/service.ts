"use server";

/**
 * Home-service **writes**. Every action authenticates with `requireUser()`, validates its
 * input, and recalculates derived money/time columns inside the same call so the database
 * never holds stale totals. Reads live in `service-data.ts`.
 */

import { revalidatePath } from "next/cache";
import { and, eq, isNull, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  serviceTechnicians, serviceCustomers, serviceLocations, servicePianos, serviceCatalog,
  serviceJobs, serviceJobItems, serviceJobEvents, serviceTimeLogs, serviceInvoices,
  serviceInvoiceItems, servicePayments, serviceExpenses, serviceSettings,
} from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { addDays } from "@/lib/dates";
import {
  boolOr, computeTotals, elapsedMinutes, intOr, lineTotalCents, moneyToCents, oneOf,
  optionalDate, str, strOr, CUSTOMER_SOURCES, EXPENSE_CATEGORIES, ITEM_KINDS, JOB_STATUSES,
  PAYMENT_METHODS, PIANO_TYPES, SERVICE_TYPES, TIME_KINDS,
} from "@/lib/service";

type Result<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

const ok = <T>(data?: T): Result<T> => ({ ok: true, data });
const fail = (error: string): Result<never> => ({ ok: false, error });

/**
 * Optional text update for NOT NULL columns: a blank or omitted value leaves the
 * stored value untouched instead of writing an empty string.
 */
const strU = (value: unknown, max = 2_000): string | undefined => str(value, max) ?? undefined;

/** Every mutation revalidates the whole workspace so lists, boards, and totals agree. */
function touch() {
  revalidatePath("/service", "layout");
}

/* ============================================================
 * Customers, locations, pianos
 * ============================================================ */

export type CustomerInput = {
  name: string; company?: string | null; email?: string | null; phone?: string | null;
  source?: string | null; tags?: string[]; notes?: string | null;
};

export async function createCustomer(input: CustomerInput): Promise<Result<{ id: string }>> {
  await requireUser();
  const name = str(input.name, 160);
  if (!name) return fail("Customer name is required.");
  const [row] = await db
    .insert(serviceCustomers)
    .values({
      name,
      company: str(input.company, 160),
      email: str(input.email, 200),
      phone: str(input.phone, 60),
      source: oneOf(input.source, CUSTOMER_SOURCES.map((s) => s.key), "referral"),
      tags: (input.tags ?? []).map((t) => str(t, 40)).filter((t): t is string => !!t),
      notes: str(input.notes, 4_000),
    })
    .returning({ id: serviceCustomers.id });
  touch();
  return ok({ id: row!.id });
}

export async function updateCustomer(id: string, patch: CustomerInput): Promise<Result> {
  await requireUser();
  if (!id) return fail("Missing customer.");
  const name = str(patch.name, 160);
  if (!name) return fail("Customer name is required.");
  await db
    .update(serviceCustomers)
    .set({
      name,
      company: str(patch.company, 160),
      email: str(patch.email, 200),
      phone: str(patch.phone, 60),
      source: oneOf(patch.source, CUSTOMER_SOURCES.map((s) => s.key), "referral"),
      tags: (patch.tags ?? []).map((t) => str(t, 40)).filter((t): t is string => !!t),
      notes: str(patch.notes, 4_000),
      updatedAt: new Date(),
    })
    .where(eq(serviceCustomers.id, id));
  touch();
  return ok();
}

export async function archiveCustomer(id: string, archived: boolean): Promise<Result> {
  await requireUser();
  await db
    .update(serviceCustomers)
    .set({ archivedAt: archived ? new Date() : null, updatedAt: new Date() })
    .where(eq(serviceCustomers.id, id));
  touch();
  return ok();
}

export type LocationInput = {
  customerId: string; label?: string | null; addressLine: string; city?: string | null;
  area?: string | null; landmark?: string | null; accessNotes?: string | null;
  travelMinutes?: number; travelFee?: number;
};

export async function createLocation(input: LocationInput): Promise<Result<{ id: string }>> {
  await requireUser();
  const addressLine = str(input.addressLine, 300);
  if (!input.customerId) return fail("Pick a customer first.");
  if (!addressLine) return fail("Address is required.");
  const [row] = await db
    .insert(serviceLocations)
    .values({
      customerId: input.customerId,
      label: strOr(input.label, "Residence").slice(0, 80),
      addressLine,
      city: strOr(input.city, "Davao City").slice(0, 80),
      area: str(input.area, 80),
      landmark: str(input.landmark, 200),
      accessNotes: str(input.accessNotes, 1_000),
      travelMinutes: Math.max(0, intOr(input.travelMinutes, 0)),
      travelFeeCents: Math.max(0, moneyToCents(input.travelFee)),
    })
    .returning({ id: serviceLocations.id });
  touch();
  return ok({ id: row!.id });
}

export async function updateLocation(id: string, patch: Partial<LocationInput>): Promise<Result> {
  await requireUser();
  if (!id) return fail("Missing location.");
  await db
    .update(serviceLocations)
    .set({
      label: patch.label !== undefined ? strOr(patch.label, "Residence").slice(0, 80) : undefined,
      addressLine: patch.addressLine !== undefined ? strU(patch.addressLine, 300) : undefined,
      city: patch.city !== undefined ? strOr(patch.city, "Davao City").slice(0, 80) : undefined,
      area: patch.area !== undefined ? str(patch.area, 80) : undefined,
      landmark: patch.landmark !== undefined ? str(patch.landmark, 200) : undefined,
      accessNotes: patch.accessNotes !== undefined ? str(patch.accessNotes, 1_000) : undefined,
      travelMinutes: patch.travelMinutes !== undefined ? Math.max(0, intOr(patch.travelMinutes, 0)) : undefined,
      travelFeeCents: patch.travelFee !== undefined ? Math.max(0, moneyToCents(patch.travelFee)) : undefined,
      updatedAt: new Date(),
    })
    .where(eq(serviceLocations.id, id));
  touch();
  return ok();
}

export async function deleteLocation(id: string): Promise<Result> {
  await requireUser();
  await db.delete(serviceLocations).where(eq(serviceLocations.id, id));
  touch();
  return ok();
}

export type PianoInput = {
  customerId: string; locationId?: string | null; brand: string; model?: string | null;
  type?: string | null; serialNumber?: string | null; year?: number | null;
  conditionNotes?: string | null; lastServiceAt?: string | null;
  tuningIntervalMonths?: number; nextServiceDueAt?: string | null; notes?: string | null;
};

export async function createPiano(input: PianoInput): Promise<Result<{ id: string }>> {
  await requireUser();
  const brand = str(input.brand, 120);
  if (!input.customerId) return fail("Pick a customer first.");
  if (!brand) return fail("Piano brand is required.");
  const [row] = await db
    .insert(servicePianos)
    .values({
      customerId: input.customerId,
      locationId: str(input.locationId, 40) || null,
      brand,
      model: str(input.model, 120),
      type: oneOf(input.type, PIANO_TYPES, "Upright"),
      serialNumber: str(input.serialNumber, 80),
      year: input.year ? intOr(input.year, 0) || null : null,
      conditionNotes: str(input.conditionNotes, 2_000),
      lastServiceAt: optionalDate(input.lastServiceAt),
      tuningIntervalMonths: Math.max(1, intOr(input.tuningIntervalMonths, 6)),
      nextServiceDueAt: optionalDate(input.nextServiceDueAt),
      notes: str(input.notes, 2_000),
    })
    .returning({ id: servicePianos.id });
  touch();
  return ok({ id: row!.id });
}

export async function updatePiano(id: string, patch: Partial<PianoInput>): Promise<Result> {
  await requireUser();
  if (!id) return fail("Missing piano.");
  await db
    .update(servicePianos)
    .set({
      locationId: patch.locationId !== undefined ? str(patch.locationId, 40) || null : undefined,
      brand: patch.brand !== undefined ? strU(patch.brand, 120) : undefined,
      model: patch.model !== undefined ? str(patch.model, 120) : undefined,
      type: patch.type !== undefined ? oneOf(patch.type, PIANO_TYPES, "Upright") : undefined,
      serialNumber: patch.serialNumber !== undefined ? str(patch.serialNumber, 80) : undefined,
      year: patch.year !== undefined ? intOr(patch.year, 0) || null : undefined,
      conditionNotes: patch.conditionNotes !== undefined ? str(patch.conditionNotes, 2_000) : undefined,
      lastServiceAt: patch.lastServiceAt !== undefined ? optionalDate(patch.lastServiceAt) : undefined,
      tuningIntervalMonths: patch.tuningIntervalMonths !== undefined
        ? Math.max(1, intOr(patch.tuningIntervalMonths, 6)) : undefined,
      nextServiceDueAt: patch.nextServiceDueAt !== undefined ? optionalDate(patch.nextServiceDueAt) : undefined,
      notes: patch.notes !== undefined ? str(patch.notes, 2_000) : undefined,
      updatedAt: new Date(),
    })
    .where(eq(servicePianos.id, id));
  touch();
  return ok();
}

export async function deletePiano(id: string): Promise<Result> {
  await requireUser();
  await db.delete(servicePianos).where(eq(servicePianos.id, id));
  touch();
  return ok();
}

/* ============================================================
 * Technicians
 * ============================================================ */

export type TechnicianInput = {
  name: string; title?: string | null; phone?: string | null; color?: string | null;
  hourlyRate?: number; billableRate?: number; active?: boolean; notes?: string | null;
};

export async function createTechnician(input: TechnicianInput): Promise<Result<{ id: string }>> {
  await requireUser();
  const name = str(input.name, 120);
  if (!name) return fail("Technician name is required.");
  const [row] = await db
    .insert(serviceTechnicians)
    .values({
      name,
      title: strOr(input.title, "Field Technician").slice(0, 80),
      phone: str(input.phone, 60),
      color: /^#[0-9a-fA-F]{6}$/.test(strOr(input.color)) ? input.color! : "#4d8df0",
      hourlyRateCents: Math.max(0, moneyToCents(input.hourlyRate)),
      billableRateCents: Math.max(0, moneyToCents(input.billableRate)),
      active: boolOr(input.active, true),
      notes: str(input.notes, 2_000),
    })
    .returning({ id: serviceTechnicians.id });
  touch();
  return ok({ id: row!.id });
}

export async function updateTechnician(id: string, patch: Partial<TechnicianInput>): Promise<Result> {
  await requireUser();
  if (!id) return fail("Missing technician.");
  await db
    .update(serviceTechnicians)
    .set({
      name: patch.name !== undefined ? strU(patch.name, 120) : undefined,
      title: patch.title !== undefined ? strOr(patch.title, "Field Technician").slice(0, 80) : undefined,
      phone: patch.phone !== undefined ? str(patch.phone, 60) : undefined,
      color: patch.color && /^#[0-9a-fA-F]{6}$/.test(patch.color) ? patch.color : undefined,
      hourlyRateCents: patch.hourlyRate !== undefined ? Math.max(0, moneyToCents(patch.hourlyRate)) : undefined,
      billableRateCents: patch.billableRate !== undefined ? Math.max(0, moneyToCents(patch.billableRate)) : undefined,
      active: patch.active !== undefined ? boolOr(patch.active, true) : undefined,
      notes: patch.notes !== undefined ? str(patch.notes, 2_000) : undefined,
      updatedAt: new Date(),
    })
    .where(eq(serviceTechnicians.id, id));
  touch();
  return ok();
}

export async function deleteTechnician(id: string): Promise<Result> {
  await requireUser();
  await db.delete(serviceTechnicians).where(eq(serviceTechnicians.id, id));
  touch();
  return ok();
}

/* ============================================================
 * Price book
 * ============================================================ */

export type CatalogInput = {
  name: string; description?: string | null; kind?: string | null; unitPrice?: number;
  taxable?: boolean; estimatedMinutes?: number; active?: boolean;
};

export async function createCatalogItem(input: CatalogInput): Promise<Result<{ id: string }>> {
  await requireUser();
  const name = str(input.name, 160);
  if (!name) return fail("Item name is required.");
  const [{ max }] = await db
    .select({ max: sql<number>`coalesce(max(${serviceCatalog.position}), 0)::int` })
    .from(serviceCatalog);
  const [row] = await db
    .insert(serviceCatalog)
    .values({
      name,
      description: str(input.description, 1_000),
      kind: oneOf(input.kind, ITEM_KINDS.map((k) => k.key), "service"),
      unitPriceCents: moneyToCents(input.unitPrice),
      taxable: boolOr(input.taxable, true),
      estimatedMinutes: Math.max(0, intOr(input.estimatedMinutes, 60)),
      active: boolOr(input.active, true),
      position: (max ?? 0) + 1,
    })
    .returning({ id: serviceCatalog.id });
  touch();
  return ok({ id: row!.id });
}

export async function updateCatalogItem(id: string, patch: Partial<CatalogInput>): Promise<Result> {
  await requireUser();
  if (!id) return fail("Missing price-book item.");
  await db
    .update(serviceCatalog)
    .set({
      name: patch.name !== undefined ? strU(patch.name, 160) : undefined,
      description: patch.description !== undefined ? str(patch.description, 1_000) : undefined,
      kind: patch.kind !== undefined ? oneOf(patch.kind, ITEM_KINDS.map((k) => k.key), "service") : undefined,
      unitPriceCents: patch.unitPrice !== undefined ? moneyToCents(patch.unitPrice) : undefined,
      taxable: patch.taxable !== undefined ? boolOr(patch.taxable, true) : undefined,
      estimatedMinutes: patch.estimatedMinutes !== undefined ? Math.max(0, intOr(patch.estimatedMinutes, 60)) : undefined,
      active: patch.active !== undefined ? boolOr(patch.active, true) : undefined,
      updatedAt: new Date(),
    })
    .where(eq(serviceCatalog.id, id));
  touch();
  return ok();
}

export async function deleteCatalogItem(id: string): Promise<Result> {
  await requireUser();
  await db.delete(serviceCatalog).where(eq(serviceCatalog.id, id));
  touch();
  return ok();
}

/* ============================================================
 * Jobs
 * ============================================================ */

export type JobInput = {
  customerId: string; locationId?: string | null; pianoId?: string | null;
  technicianId?: string | null; title: string; serviceType?: string | null;
  status?: string | null; priority?: string | null;
  scheduledStart?: string | null; scheduledEnd?: string | null;
  estimatedMinutes?: number; travelMinutes?: number; travelFee?: number;
  notes?: string | null; privateNotes?: string | null;
};

export async function createJob(input: JobInput): Promise<Result<{ id: string }>> {
  await requireUser();
  const title = str(input.title, 200) || "Home service visit";
  if (!input.customerId) return fail("Pick a customer for this job.");
  const [row] = await db
    .insert(serviceJobs)
    .values({
      customerId: input.customerId,
      locationId: str(input.locationId) || null,
      pianoId: str(input.pianoId) || null,
      technicianId: str(input.technicianId) || null,
      title,
      serviceType: oneOf(input.serviceType, SERVICE_TYPES.map((s) => s.key), "tuning"),
      status: oneOf(input.status, JOB_STATUSES.map((s) => s.key), "lead"),
      priority: oneOf(input.priority, ["low", "normal", "high", "urgent"], "normal"),
      scheduledStart: optionalDate(input.scheduledStart),
      scheduledEnd: optionalDate(input.scheduledEnd),
      estimatedMinutes: Math.max(0, intOr(input.estimatedMinutes, 60)),
      travelMinutes: Math.max(0, intOr(input.travelMinutes, 0)),
      travelFeeCents: Math.max(0, moneyToCents(input.travelFee)),
      notes: str(input.notes, 4_000),
      privateNotes: str(input.privateNotes, 4_000),
    })
    .returning({ id: serviceJobs.id });

  await db.insert(serviceJobEvents).values({
    jobId: row!.id,
    type: "created",
    message: "Job created",
    actorName: "Owner",
  });
  touch();
  return ok({ id: row!.id });
}

export async function updateJob(id: string, patch: Partial<JobInput>): Promise<Result> {
  await requireUser();
  if (!id) return fail("Missing job.");
  const next: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.customerId) next.customerId = patch.customerId;
  if (patch.locationId !== undefined) next.locationId = str(patch.locationId) || null;
  if (patch.pianoId !== undefined) next.pianoId = str(patch.pianoId) || null;
  if (patch.technicianId !== undefined) next.technicianId = str(patch.technicianId) || null;
  if (patch.title !== undefined) next.title = str(patch.title, 200) || "Home service visit";
  if (patch.serviceType) next.serviceType = oneOf(patch.serviceType, SERVICE_TYPES.map((s) => s.key), "tuning");
  if (patch.priority) next.priority = oneOf(patch.priority, ["low", "normal", "high", "urgent"], "normal");
  if (patch.estimatedMinutes !== undefined) next.estimatedMinutes = Math.max(0, intOr(patch.estimatedMinutes, 60));
  if (patch.travelMinutes !== undefined) next.travelMinutes = Math.max(0, intOr(patch.travelMinutes, 0));
  if (patch.travelFee !== undefined) next.travelFeeCents = Math.max(0, moneyToCents(patch.travelFee));
  if (patch.notes !== undefined) next.notes = str(patch.notes, 4_000);
  if (patch.privateNotes !== undefined) next.privateNotes = str(patch.privateNotes, 4_000);
  if (patch.scheduledStart !== undefined) {
    const start = optionalDate(patch.scheduledStart);
    next.scheduledStart = start;
    if (start) {
      const mins = Math.max(0, intOr(patch.estimatedMinutes, 0)) ||
        (await db.select({ m: serviceJobs.estimatedMinutes }).from(serviceJobs).where(eq(serviceJobs.id, id)).limit(1))[0]?.m || 60;
      next.scheduledEnd = patch.scheduledEnd ? optionalDate(patch.scheduledEnd) : new Date(start.getTime() + mins * 60_000);
    } else {
      next.scheduledEnd = null;
    }
  } else if (patch.scheduledEnd !== undefined) {
    next.scheduledEnd = optionalDate(patch.scheduledEnd);
  }
  await db.update(serviceJobs).set(next).where(eq(serviceJobs.id, id));
  touch();
  return ok();
}

/** Drag-and-drop on the dispatch board: move a job to a new slot, keep its duration. */
export async function rescheduleJob(id: string, startLocal: string, endLocal?: string): Promise<Result> {
  await requireUser();
  const start = optionalDate(startLocal);
  if (!start) return fail("Pick a valid start time.");
  const [job] = await db.select().from(serviceJobs).where(eq(serviceJobs.id, id)).limit(1);
  if (!job) return fail("Job not found.");
  const end = endLocal ? optionalDate(endLocal)
    : new Date(start.getTime() + Math.max(15, job.estimatedMinutes || 60) * 60_000);
  await db
    .update(serviceJobs)
    .set({
      scheduledStart: start,
      scheduledEnd: end,
      status: job.status === "lead" || job.status === "quoted" ? "scheduled" : job.status,
      updatedAt: new Date(),
    })
    .where(eq(serviceJobs.id, id));
  await db.insert(serviceJobEvents).values({
    jobId: id, type: "scheduled", message: "Rescheduled", actorName: "Owner",
  });
  touch();
  return ok();
}

export async function assignJob(id: string, technicianId: string | null): Promise<Result> {
  await requireUser();
  await db
    .update(serviceJobs)
    .set({ technicianId: str(technicianId) || null, updatedAt: new Date() })
    .where(eq(serviceJobs.id, id));
  touch();
  return ok();
}

/** Status changes carry the side effects that keep time, cost, and recall data honest. */
export async function setJobStatus(id: string, status: string, note?: string): Promise<Result> {
  await requireUser();
  const next = oneOf(status, JOB_STATUSES.map((s) => s.key), "scheduled");
  const [job] = await db.select().from(serviceJobs).where(eq(serviceJobs.id, id)).limit(1);
  if (!job) return fail("Job not found.");

  const patch: Record<string, unknown> = { status: next, updatedAt: new Date() };
  const now = new Date();

  if (next === "in_progress") {
    patch.startedAt = job.startedAt ?? now;
  }
  if (next === "completed") {
    patch.completedAt = job.completedAt ?? now;
  }
  if (next === "cancelled") {
    patch.cancelledAt = now;
    patch.cancelReason = str(note, 500);
  }

  await db.update(serviceJobs).set(patch).where(eq(serviceJobs.id, id));

  if (next === "completed") {
    await recalcJobLabor(id);
    await recalcJobMoney(id);
    await advanceRecall(id);
  }

  await db.insert(serviceJobEvents).values({
    jobId: id,
    type: next,
    message: note ? str(note, 500) : `Status set to ${next.replace(/_/g, " ")}`,
    actorName: "Owner",
  });
  touch();
  return ok();
}

export async function addJobNote(id: string, message: string): Promise<Result> {
  await requireUser();
  const text = str(message, 1_000);
  if (!text) return fail("Write something first.");
  await db.insert(serviceJobEvents).values({ jobId: id, type: "note", message: text, actorName: "Owner" });
  touch();
  return ok();
}

export async function deleteJob(id: string): Promise<Result> {
  await requireUser();
  if (!id) return fail("Missing job.");
  await db.delete(serviceJobs).where(eq(serviceJobs.id, id));
  touch();
  return ok();
}

/* ---- derived job money/time ---- */

/** Recomputes quote total and parts cost from the job's line items. */
export async function recalcJobMoney(jobId: string): Promise<void> {
  const items = await db.select().from(serviceJobItems).where(eq(serviceJobItems.jobId, jobId));
  const quotedCents = items.reduce((sum, i) => sum + lineTotalCents(i), 0);
  const partsCostCents = items
    .filter((i) => i.kind === "part")
    .reduce((sum, i) => sum + lineTotalCents(i), 0);
  await db
    .update(serviceJobs)
    .set({ quotedCents: Math.max(0, quotedCents), partsCostCents, updatedAt: new Date() })
    .where(eq(serviceJobs.id, jobId));
}

/** Recomputes worked/travel minutes and labor cost from stopped time logs. */
export async function recalcJobLabor(jobId: string): Promise<void> {
  const logs = await db
    .select()
    .from(serviceTimeLogs)
    .where(and(eq(serviceTimeLogs.jobId, jobId), isNotNull(serviceTimeLogs.endedAt)));
  const workMinutes = logs.filter((l) => l.kind === "work").reduce((s, l) => s + (l.minutes ?? 0), 0);
  const travelMinutes = logs.filter((l) => l.kind === "travel").reduce((s, l) => s + (l.minutes ?? 0), 0);
  const laborCostCents = logs
    .filter((l) => l.kind === "work")
    .reduce((s, l) => s + Math.round(((l.minutes ?? 0) / 60) * l.hourlyRateCents), 0);
  await db
    .update(serviceJobs)
    .set({
      actualMinutes: workMinutes,
      travelMinutes,
      laborCostCents,
      updatedAt: new Date(),
    })
    .where(eq(serviceJobs.id, jobId));
}

/** After a tuning/maintenance visit, roll the piano's next-service date forward. */
async function advanceRecall(jobId: string): Promise<void> {
  const [job] = await db.select().from(serviceJobs).where(eq(serviceJobs.id, jobId)).limit(1);
  if (!job?.pianoId) return;
  const [piano] = await db.select().from(servicePianos).where(eq(servicePianos.id, job.pianoId)).limit(1);
  if (!piano) return;
  const servedAt = job.completedAt ?? new Date();
  const months = Math.max(1, piano.tuningIntervalMonths || 6);
  const next = new Date(servedAt);
  next.setUTCMonth(next.getUTCMonth() + months);
  await db
    .update(servicePianos)
    .set({ lastServiceAt: servedAt, nextServiceDueAt: next, updatedAt: new Date() })
    .where(eq(servicePianos.id, piano.id));
}

/* ---- job line items ---- */

export type JobItemInput = {
  kind?: string; description: string; qty?: number; unitPrice?: number;
  taxable?: boolean; minutes?: number | null; catalogItemId?: string | null;
};

export async function addJobItem(jobId: string, input: JobItemInput): Promise<Result> {
  await requireUser();
  const description = str(input.description, 300);
  if (!description) return fail("Describe the line item.");
  const [{ max }] = await db
    .select({ max: sql<number>`coalesce(max(${serviceJobItems.position}), 0)::int` })
    .from(serviceJobItems)
    .where(eq(serviceJobItems.jobId, jobId));
  await db.insert(serviceJobItems).values({
    jobId,
    kind: oneOf(input.kind, ITEM_KINDS.map((k) => k.key), "service"),
    description,
    qty: Math.max(1, intOr(input.qty, 1)),
    unitPriceCents: moneyToCents(input.unitPrice),
    taxable: boolOr(input.taxable, true),
    minutes: input.minutes ? Math.max(0, intOr(input.minutes, 0)) : null,
    catalogItemId: str(input.catalogItemId) || null,
    position: (max ?? 0) + 1,
  });
  await recalcJobMoney(jobId);
  touch();
  return ok();
}

export async function updateJobItem(id: string, patch: Partial<JobItemInput>): Promise<Result> {
  await requireUser();
  const [item] = await db.select().from(serviceJobItems).where(eq(serviceJobItems.id, id)).limit(1);
  if (!item) return fail("Line item not found.");
  await db
    .update(serviceJobItems)
    .set({
      kind: patch.kind ? oneOf(patch.kind, ITEM_KINDS.map((k) => k.key), "service") : undefined,
      description: patch.description !== undefined ? str(patch.description, 300) || item.description : undefined,
      qty: patch.qty !== undefined ? Math.max(1, intOr(patch.qty, 1)) : undefined,
      unitPriceCents: patch.unitPrice !== undefined ? moneyToCents(patch.unitPrice) : undefined,
      taxable: patch.taxable !== undefined ? boolOr(patch.taxable, true) : undefined,
      minutes: patch.minutes !== undefined ? (patch.minutes ? Math.max(0, intOr(patch.minutes, 0)) : null) : undefined,
      updatedAt: new Date(),
    })
    .where(eq(serviceJobItems.id, id));
  await recalcJobMoney(item.jobId);
  touch();
  return ok();
}

export async function deleteJobItem(id: string): Promise<Result> {
  await requireUser();
  const [item] = await db.select().from(serviceJobItems).where(eq(serviceJobItems.id, id)).limit(1);
  if (!item) return fail("Line item not found.");
  await db.delete(serviceJobItems).where(eq(serviceJobItems.id, id));
  await recalcJobMoney(item.jobId);
  touch();
  return ok();
}

/* ============================================================
 * Time tracking
 * ============================================================ */

export async function startTimer(
  jobId: string,
  kind: string,
  technicianId?: string | null,
): Promise<Result> {
  await requireUser();
  const nextKind = oneOf(kind, TIME_KINDS.map((k) => k.key), "work");
  const techId = str(technicianId) || null;

  if (techId) {
    const [running] = await db
      .select({ id: serviceTimeLogs.id })
      .from(serviceTimeLogs)
      .where(and(eq(serviceTimeLogs.technicianId, techId), isNull(serviceTimeLogs.endedAt)))
      .limit(1);
    if (running) return fail("That technician already has a timer running — stop it first.");
  }

  const rate = techId
    ? (await db.select({ r: serviceTechnicians.hourlyRateCents }).from(serviceTechnicians)
        .where(eq(serviceTechnicians.id, techId)).limit(1))[0]?.r ?? 0
    : 0;

  await db.insert(serviceTimeLogs).values({
    jobId,
    technicianId: techId,
    kind: nextKind,
    startedAt: new Date(),
    hourlyRateCents: rate,
  });
  await db.insert(serviceJobEvents).values({
    jobId, type: nextKind === "travel" ? "en_route" : "started",
    message: nextKind === "travel" ? "Travel started" : nextKind === "break" ? "Break started" : "Work started",
    actorName: "Owner",
  });
  if (nextKind === "travel" || nextKind === "work") {
    await db
      .update(serviceJobs)
      .set({ status: nextKind === "travel" ? "en_route" : "in_progress", startedAt: new Date(), updatedAt: new Date() })
      .where(eq(serviceJobs.id, jobId));
  }
  touch();
  return ok();
}

export async function stopTimer(logId: string): Promise<Result> {
  await requireUser();
  const [log] = await db.select().from(serviceTimeLogs).where(eq(serviceTimeLogs.id, logId)).limit(1);
  if (!log) return fail("Timer not found.");
  if (log.endedAt) return ok();
  const endedAt = new Date();
  await db
    .update(serviceTimeLogs)
    .set({ endedAt, minutes: elapsedMinutes(log.startedAt, endedAt) })
    .where(eq(serviceTimeLogs.id, logId));
  await recalcJobLabor(log.jobId);
  touch();
  return ok();
}

export async function addManualTime(input: {
  jobId: string; kind?: string; technicianId?: string | null;
  startedAt: string; endedAt: string; note?: string | null;
}): Promise<Result> {
  await requireUser();
  const start = optionalDate(input.startedAt);
  const end = optionalDate(input.endedAt);
  if (!start || !end) return fail("Pick a start and end time.");
  if (end <= start) return fail("End time must be after the start time.");
  const techId = str(input.technicianId) || null;
  const rate = techId
    ? (await db.select({ r: serviceTechnicians.hourlyRateCents }).from(serviceTechnicians)
        .where(eq(serviceTechnicians.id, techId)).limit(1))[0]?.r ?? 0
    : 0;
  await db.insert(serviceTimeLogs).values({
    jobId: input.jobId,
    technicianId: techId,
    kind: oneOf(input.kind, TIME_KINDS.map((k) => k.key), "work"),
    startedAt: start,
    endedAt: end,
    minutes: elapsedMinutes(start, end),
    hourlyRateCents: rate,
    note: str(input.note, 500),
  });
  await recalcJobLabor(input.jobId);
  touch();
  return ok();
}

export async function deleteTimeLog(id: string): Promise<Result> {
  await requireUser();
  const [log] = await db.select().from(serviceTimeLogs).where(eq(serviceTimeLogs.id, id)).limit(1);
  if (!log) return fail("Time entry not found.");
  await db.delete(serviceTimeLogs).where(eq(serviceTimeLogs.id, id));
  await recalcJobLabor(log.jobId);
  touch();
  return ok();
}

/* ============================================================
 * Invoices
 * ============================================================ */

/** Recomputes an invoice's totals from its line items and payments. Single source of truth. */
async function recalcInvoice(invoiceId: string): Promise<void> {
  const [invoice] = await db.select().from(serviceInvoices).where(eq(serviceInvoices.id, invoiceId)).limit(1);
  if (!invoice) return;
  const [items, payments] = await Promise.all([
    db.select().from(serviceInvoiceItems).where(eq(serviceInvoiceItems.invoiceId, invoiceId)),
    db.select().from(servicePayments).where(eq(servicePayments.invoiceId, invoiceId)),
  ]);
  const totals = computeTotals(items, {
    discountCents: invoice.discountCents,
    taxRateBps: invoice.taxRateBps,
  });
  const amountPaidCents = payments.reduce((s, p) => s + p.amountCents, 0);
  const balance = Math.max(0, totals.totalCents - amountPaidCents);

  const status = invoice.voidedAt
    ? "void"
    : totals.totalCents > 0 && balance <= 0
      ? "paid"
      : amountPaidCents > 0
        ? "partial"
        : invoice.sentAt
          ? "sent"
          : "draft";

  await db
    .update(serviceInvoices)
    .set({
      subtotalCents: totals.subtotalCents,
      taxCents: totals.taxCents,
      totalCents: totals.totalCents,
      amountPaidCents,
      status,
      paidAt: status === "paid" ? invoice.paidAt ?? new Date() : null,
      updatedAt: new Date(),
    })
    .where(eq(serviceInvoices.id, invoiceId));

  // Keep the linked job's status in step with its money.
  if (invoice.jobId && status === "paid") {
    const [job] = await db.select().from(serviceJobs).where(eq(serviceJobs.id, invoice.jobId)).limit(1);
    if (job && job.status === "invoiced") {
      await db.update(serviceJobs).set({ status: "paid", updatedAt: new Date() }).where(eq(serviceJobs.id, job.id));
    }
  }
}

async function createInvoiceRows(input: {
  customerId: string; jobId?: string | null; items: { description: string; qty: number; unitPriceCents: number; taxable: boolean; jobItemId?: string | null }[];
  terms?: string | null; notes?: string | null; dueDate?: Date | null; discountCents?: number;
}): Promise<Result<{ id: string }>> {
  const user = await requireUser();
  const [settings] = await db.select().from(serviceSettings).where(eq(serviceSettings.ownerId, user.id)).limit(1);
  const terms = input.terms ?? null;
  const issueDate = new Date();
  const dueDate = input.dueDate ?? addDays(issueDate, settings?.defaultTermsDays ?? 15);

  const [invoice] = await db
    .insert(serviceInvoices)
    .values({
      customerId: input.customerId,
      jobId: input.jobId ?? null,
      issueDate,
      dueDate,
      taxRateBps: settings?.taxRateBps ?? 1200,
      discountCents: Math.max(0, Math.round(input.discountCents ?? 0)),
      notes: str(input.notes, 2_000),
      terms: str(terms, 1_000),
      status: "draft",
    })
    .returning({ id: serviceInvoices.id });

  await db.insert(serviceInvoiceItems).values(
    input.items.map((item, index) => ({
      invoiceId: invoice!.id,
      jobItemId: item.jobItemId ?? null,
      description: item.description,
      qty: Math.max(1, Math.round(item.qty)),
      unitPriceCents: Math.round(item.unitPriceCents),
      taxable: item.taxable,
      position: index,
    })),
  );

  await recalcInvoice(invoice!.id);

  if (input.jobId) {
    await db
      .update(serviceJobs)
      .set({ status: "invoiced", invoicedAt: issueDate, updatedAt: new Date() })
      .where(eq(serviceJobs.id, input.jobId));
    await db.insert(serviceJobEvents).values({
      jobId: input.jobId, type: "invoiced", message: "Invoice created", actorName: "Owner",
    });
  }
  touch();
  return ok({ id: invoice!.id });
}

/** Turns a completed job's line items into an invoice, including the travel fee. */
export async function createInvoiceFromJob(jobId: string, opts: { discountCents?: number; includeTravel?: boolean } = {}): Promise<Result<{ id: string }>> {
  await requireUser();
  const [job] = await db.select().from(serviceJobs).where(eq(serviceJobs.id, jobId)).limit(1);
  if (!job) return fail("Job not found.");
  const items = await db.select().from(serviceJobItems).where(eq(serviceJobItems.jobId, jobId));
  const lines: {
    description: string; qty: number; unitPriceCents: number; taxable: boolean; jobItemId: string | null;
  }[] = items.map((i) => ({
    description: i.description,
    qty: i.qty,
    unitPriceCents: i.unitPriceCents,
    taxable: i.taxable,
    jobItemId: i.id,
  }));
  // Only add the call-out fee when the job doesn't already carry a fee line — otherwise
  // the travel charge would be billed twice.
  const hasFeeLine = items.some((i) => i.kind === "fee");
  if (opts.includeTravel !== false && job.travelFeeCents > 0 && !hasFeeLine) {
    lines.push({
      description: "Travel / service call",
      qty: 1,
      unitPriceCents: job.travelFeeCents,
      taxable: true,
      jobItemId: null,
    });
  }
  if (!lines.length) return fail("Add at least one line item to the job before invoicing.");
  return createInvoiceRows({
    customerId: job.customerId,
    jobId: job.id,
    items: lines,
    discountCents: opts.discountCents ?? 0,
  });
}

export async function createInvoice(input: {
  customerId: string; jobId?: string | null;
  items: { description: string; qty?: number; unitPrice?: number; taxable?: boolean }[];
  dueDate?: string | null; notes?: string | null; terms?: string | null; discount?: number;
}): Promise<Result<{ id: string }>> {
  await requireUser();
  if (!input.customerId) return fail("Pick a customer.");
  // Client sends human amounts (pesos); convert once, store centavos.
  const lines = (input.items ?? [])
    .filter((i) => str(i.description))
    .map((i) => ({
      description: str(i.description, 300)!,
      qty: Math.max(1, intOr(i.qty, 1)),
      unitPriceCents: moneyToCents(i.unitPrice),
      taxable: boolOr(i.taxable, true),
    }));
  if (!lines.length) return fail("Add at least one line item.");
  return createInvoiceRows({
    customerId: input.customerId,
    jobId: str(input.jobId) || null,
    items: lines,
    dueDate: optionalDate(input.dueDate),
    notes: input.notes,
    terms: input.terms,
    discountCents: input.discount,
  });
}

export async function updateInvoice(
  id: string,
  patch: {
    issueDate?: string; dueDate?: string | null; notes?: string | null; terms?: string | null;
    taxRateBps?: number; discount?: number; customerId?: string;
  },
): Promise<Result> {
  await requireUser();
  const issue = patch.issueDate !== undefined ? optionalDate(patch.issueDate) : undefined;
  if (patch.issueDate !== undefined && !issue) return fail("Pick a valid issue date.");
  await db
    .update(serviceInvoices)
    .set({
      issueDate: issue ?? undefined,
      dueDate: patch.dueDate !== undefined ? optionalDate(patch.dueDate) : undefined,
      notes: patch.notes !== undefined ? str(patch.notes, 2_000) : undefined,
      terms: patch.terms !== undefined ? str(patch.terms, 1_000) : undefined,
      taxRateBps: patch.taxRateBps !== undefined ? Math.max(0, intOr(patch.taxRateBps, 0)) : undefined,
      discountCents: patch.discount !== undefined ? Math.max(0, moneyToCents(patch.discount)) : undefined,
      customerId: patch.customerId || undefined,
      updatedAt: new Date(),
    })
    .where(eq(serviceInvoices.id, id));
  await recalcInvoice(id);
  touch();
  return ok();
}

export async function addInvoiceItem(
  invoiceId: string,
  input: { description: string; qty?: number; unitPrice?: number; taxable?: boolean },
): Promise<Result> {
  await requireUser();
  const description = str(input.description, 300);
  if (!description) return fail("Describe the line item.");
  const [{ max }] = await db
    .select({ max: sql<number>`coalesce(max(${serviceInvoiceItems.position}), 0)::int` })
    .from(serviceInvoiceItems)
    .where(eq(serviceInvoiceItems.invoiceId, invoiceId));
  await db.insert(serviceInvoiceItems).values({
    invoiceId,
    description,
    qty: Math.max(1, intOr(input.qty, 1)),
    unitPriceCents: moneyToCents(input.unitPrice),
    taxable: boolOr(input.taxable, true),
    position: (max ?? 0) + 1,
  });
  await recalcInvoice(invoiceId);
  touch();
  return ok();
}

export async function updateInvoiceItem(
  id: string,
  patch: { description?: string; qty?: number; unitPrice?: number; taxable?: boolean },
): Promise<Result> {
  await requireUser();
  const [item] = await db.select().from(serviceInvoiceItems).where(eq(serviceInvoiceItems.id, id)).limit(1);
  if (!item) return fail("Line item not found.");
  await db
    .update(serviceInvoiceItems)
    .set({
      description: patch.description !== undefined ? str(patch.description, 300) || item.description : undefined,
      qty: patch.qty !== undefined ? Math.max(1, intOr(patch.qty, 1)) : undefined,
      unitPriceCents: patch.unitPrice !== undefined ? moneyToCents(patch.unitPrice) : undefined,
      taxable: patch.taxable !== undefined ? boolOr(patch.taxable, true) : undefined,
    })
    .where(eq(serviceInvoiceItems.id, id));
  await recalcInvoice(item.invoiceId);
  touch();
  return ok();
}

export async function deleteInvoiceItem(id: string): Promise<Result> {
  await requireUser();
  const [item] = await db.select().from(serviceInvoiceItems).where(eq(serviceInvoiceItems.id, id)).limit(1);
  if (!item) return fail("Line item not found.");
  await db.delete(serviceInvoiceItems).where(eq(serviceInvoiceItems.id, id));
  await recalcInvoice(item.invoiceId);
  touch();
  return ok();
}

export async function setInvoiceStatus(id: string, status: string): Promise<Result> {
  await requireUser();
  const next = oneOf(status, ["draft", "sent", "void"], "draft");
  await db
    .update(serviceInvoices)
    .set({
      sentAt: next === "sent" ? new Date() : next === "draft" ? null : undefined,
      voidedAt: next === "void" ? new Date() : next === "draft" ? null : undefined,
      updatedAt: new Date(),
    })
    .where(eq(serviceInvoices.id, id));
  await recalcInvoice(id);
  touch();
  return ok();
}

export async function recordPayment(input: {
  invoiceId: string; amount?: number; method?: string; reference?: string | null;
  receivedAt?: string | null; note?: string | null;
}): Promise<Result> {
  await requireUser();
  const amountCents = moneyToCents(input.amount);
  if (amountCents <= 0) return fail("Enter a payment amount above zero.");
  const receivedAt = optionalDate(input.receivedAt) ?? new Date();
  await db.insert(servicePayments).values({
    invoiceId: input.invoiceId,
    amountCents,
    method: oneOf(input.method, PAYMENT_METHODS.map((m) => m.key), "cash"),
    reference: str(input.reference, 120),
    receivedAt,
    note: str(input.note, 500),
  });
  await recalcInvoice(input.invoiceId);

  const [invoice] = await db.select().from(serviceInvoices).where(eq(serviceInvoices.id, input.invoiceId)).limit(1);
  if (invoice?.jobId) {
    await db.insert(serviceJobEvents).values({
      jobId: invoice.jobId,
      type: "payment",
      message: `Payment received — ${(amountCents / 100).toFixed(2)}`,
      actorName: "Owner",
      at: receivedAt,
    });
  }
  touch();
  return ok();
}

export async function deletePayment(id: string): Promise<Result> {
  await requireUser();
  const [payment] = await db.select().from(servicePayments).where(eq(servicePayments.id, id)).limit(1);
  if (!payment) return fail("Payment not found.");
  await db.delete(servicePayments).where(eq(servicePayments.id, id));
  await recalcInvoice(payment.invoiceId);
  touch();
  return ok();
}

export async function deleteInvoice(id: string): Promise<Result> {
  await requireUser();
  await db.delete(serviceInvoices).where(eq(serviceInvoices.id, id));
  touch();
  return ok();
}

/* ============================================================
 * Expenses
 * ============================================================ */

export type ExpenseInput = {
  category?: string; description: string; amount?: number; spentAt?: string | null;
  jobId?: string | null; vendor?: string | null; method?: string;
  reimbursable?: boolean; note?: string | null;
};

export async function createExpense(input: ExpenseInput): Promise<Result<{ id: string }>> {
  await requireUser();
  const description = str(input.description, 300);
  if (!description) return fail("Describe the expense.");
  const [row] = await db
    .insert(serviceExpenses)
    .values({
      category: oneOf(input.category, EXPENSE_CATEGORIES.map((c) => c.key), "other"),
      description,
      amountCents: Math.max(0, moneyToCents(input.amount)),
      spentAt: optionalDate(input.spentAt) ?? new Date(),
      jobId: str(input.jobId) || null,
      vendor: str(input.vendor, 160),
      method: oneOf(input.method, PAYMENT_METHODS.map((m) => m.key), "cash"),
      reimbursable: boolOr(input.reimbursable, false),
      note: str(input.note, 1_000),
    })
    .returning({ id: serviceExpenses.id });
  touch();
  return ok({ id: row!.id });
}

export async function updateExpense(id: string, patch: Partial<ExpenseInput>): Promise<Result> {
  await requireUser();
  if (!id) return fail("Missing expense.");
  await db
    .update(serviceExpenses)
    .set({
      category: patch.category ? oneOf(patch.category, EXPENSE_CATEGORIES.map((c) => c.key), "other") : undefined,
      description: patch.description !== undefined ? str(patch.description, 300) || undefined : undefined,
      amountCents: patch.amount !== undefined ? Math.max(0, moneyToCents(patch.amount)) : undefined,
      spentAt: patch.spentAt !== undefined ? optionalDate(patch.spentAt) ?? new Date() : undefined,
      jobId: patch.jobId !== undefined ? str(patch.jobId) || null : undefined,
      vendor: patch.vendor !== undefined ? str(patch.vendor, 160) : undefined,
      method: patch.method ? oneOf(patch.method, PAYMENT_METHODS.map((m) => m.key), "cash") : undefined,
      reimbursable: patch.reimbursable !== undefined ? boolOr(patch.reimbursable, false) : undefined,
      note: patch.note !== undefined ? str(patch.note, 1_000) : undefined,
      updatedAt: new Date(),
    })
    .where(eq(serviceExpenses.id, id));
  touch();
  return ok();
}

export async function deleteExpense(id: string): Promise<Result> {
  await requireUser();
  await db.delete(serviceExpenses).where(eq(serviceExpenses.id, id));
  touch();
  return ok();
}

/* ============================================================
 * Settings + demo data
 * ============================================================ */

export async function updateSettings(patch: {
  businessName?: string; invoicePrefix?: string; jobPrefix?: string; taxRateBps?: number;
  taxLabel?: string; defaultTermsDays?: number; defaultHourlyRate?: number;
  defaultTravelFee?: number; defaultTuningIntervalMonths?: number;
  reminderLeadDays?: number; workingHours?: Record<number, [number, number] | null>;
}): Promise<Result> {
  const user = await requireUser();
  const [existing] = await db.select().from(serviceSettings).where(eq(serviceSettings.ownerId, user.id)).limit(1);
  if (!existing) {
    await db.insert(serviceSettings).values({ ownerId: user.id });
  }
  await db
    .update(serviceSettings)
    .set({
      businessName: patch.businessName !== undefined ? strOr(patch.businessName, "Herrero Pianos").slice(0, 160) : undefined,
      invoicePrefix: patch.invoicePrefix !== undefined ? strOr(patch.invoicePrefix, "INV").slice(0, 12).toUpperCase() : undefined,
      jobPrefix: patch.jobPrefix !== undefined ? strOr(patch.jobPrefix, "WO").slice(0, 12).toUpperCase() : undefined,
      taxRateBps: patch.taxRateBps !== undefined ? Math.max(0, intOr(patch.taxRateBps, 0)) : undefined,
      taxLabel: patch.taxLabel !== undefined ? strOr(patch.taxLabel, "VAT").slice(0, 60) : undefined,
      defaultTermsDays: patch.defaultTermsDays !== undefined ? Math.max(0, intOr(patch.defaultTermsDays, 15)) : undefined,
      defaultHourlyRateCents: patch.defaultHourlyRate !== undefined
        ? Math.max(0, moneyToCents(patch.defaultHourlyRate)) : undefined,
      defaultTravelFeeCents: patch.defaultTravelFee !== undefined
        ? Math.max(0, moneyToCents(patch.defaultTravelFee)) : undefined,
      defaultTuningIntervalMonths: patch.defaultTuningIntervalMonths !== undefined
        ? Math.max(1, intOr(patch.defaultTuningIntervalMonths, 6)) : undefined,
      reminderLeadDays: patch.reminderLeadDays !== undefined ? Math.max(0, intOr(patch.reminderLeadDays, 30)) : undefined,
      workingHours: patch.workingHours,
      updatedAt: new Date(),
    })
    .where(eq(serviceSettings.ownerId, user.id));
  touch();
  return ok();
}

/**
 * Idempotent demo dataset for an existing database. The main `seed.ts` only runs against
 * an empty database (its integrity guard must stay intact), so this is the supported way
 * to populate the workspace after the fact. Safe to press twice — it no-ops once data exists.
 */
export async function seedServiceDemo(): Promise<Result> {
  const user = await requireUser();
  const existing = await db.select({ id: serviceCustomers.id }).from(serviceCustomers).limit(1);
  if (existing.length) return fail("Home service data already exists — demo seed skipped.");

  const [techA, techB] = await db.insert(serviceTechnicians).values([
    { name: "Jerome Villanueva", title: "Senior Piano Technician", phone: "0917 555 0142",
      color: "#4d8df0", hourlyRateCents: 32000, billableRateCents: 85000 },
    { name: "Ariel Mendoza", title: "Field Technician", phone: "0917 555 0188",
      color: "#3fb984", hourlyRateCents: 22000, billableRateCents: 60000 },
  ]).returning();

  const customers = await db.insert(serviceCustomers).values([
    { name: "Maria Santos", phone: "0917 222 3344", email: "maria.santos@example.com",
      source: "referral", tags: ["residential"], notes: " prefers morning appointments." },
    { name: "Isabella Navarro", phone: "0918 888 1122", email: "isa.navarro@example.com",
      source: "repeat", tags: ["grand", "vip"] },
    { name: "Sta. Mesa Parish", company: "Sta. Mesa Parish", phone: "(082) 221 4477",
      source: "referral", tags: ["institution", "chapel"] },
    { name: "Lourdes Tan", phone: "0920 334 5566", source: "facebook", tags: ["upright"] },
  ]).returning({ id: serviceCustomers.id, name: serviceCustomers.name });

  const [maria, isa, parish, lourdes] = customers;
  const customerId = (c: typeof maria | undefined) => c!.id;

  const locations = await db.insert(serviceLocations).values([
    { customerId: customerId(maria), label: "Residence", addressLine: "14 Palm Drive, Juna Subdivision",
      city: "Davao City", area: "Matina", accessNotes: "Gate code 2214 · two friendly dogs", travelMinutes: 25, travelFeeCents: 50000 },
    { customerId: customerId(isa), label: "Residence", addressLine: "B3 L9 Camella Northpoint",
      city: "Davao City", area: "Buhangin", accessNotes: "Grand piano on 2nd floor — measure stairwell", travelMinutes: 35, travelFeeCents: 70000 },
    { customerId: customerId(parish), label: "Parish Hall", addressLine: "12 Sta. Mesa Ave.",
      city: "Davao City", area: "Sta. Mesa", accessNotes: "Ask for Fr. Miguel · parking at the rear", travelMinutes: 20, travelFeeCents: 40000 },
    { customerId: customerId(lourdes), label: "Condo", addressLine: "Unit 1204 Avida Towers",
      city: "Davao City", area: "Claro M. Recto", accessNotes: "Service elevator only, book with lobby", travelMinutes: 15, travelFeeCents: 30000 },
  ]).returning({ id: serviceLocations.id, customerId: serviceLocations.customerId });

  const locFor = (cid: string) => locations.find((l) => l.customerId === cid)!.id;

  const pianos = await db.insert(servicePianos).values([
    { customerId: customerId(maria), locationId: locFor(customerId(maria)), brand: "Yamaha", model: "U1",
      type: "Upright", year: 1998, serialNumber: "YU-4412098", tuningIntervalMonths: 6 },
    { customerId: customerId(isa), locationId: locFor(customerId(isa)), brand: "Kawai", model: "GX-2",
      type: "Grand", year: 2011, serialNumber: "KG-2211774", tuningIntervalMonths: 4 },
    { customerId: customerId(parish), locationId: locFor(customerId(parish)), brand: "Steinway", model: "Model O",
      type: "Grand", year: 1926, tuningIntervalMonths: 3 },
    { customerId: customerId(lourdes), locationId: locFor(customerId(lourdes)), brand: "Casio", model: "GP-510",
      type: "Digital", year: 2020, tuningIntervalMonths: 12 },
  ]).returning({ id: servicePianos.id, customerId: servicePianos.customerId });

  const pianoFor = (cid: string) => pianos.find((p) => p.customerId === cid)!.id;

  await db.insert(serviceCatalog).values([
    { name: "Concert tuning", description: "Pitch raise + fine tuning, single visit", kind: "service",
      unitPriceCents: 350000, estimatedMinutes: 90, position: 1 },
    { name: "Standard tuning", description: "Single-pass tuning", kind: "service",
      unitPriceCents: 250000, estimatedMinutes: 75, position: 2 },
    { name: "Action regulation", description: "Touch and escapement adjustment", kind: "service",
      unitPriceCents: 650000, estimatedMinutes: 180, position: 3 },
    { name: "Hammer voicing", description: "Tone shaping across the scale", kind: "service",
      unitPriceCents: 300000, estimatedMinutes: 120, position: 4 },
    { name: "Damper felts (set)", description: "Replacement wedge felts", kind: "part",
      unitPriceCents: 120000, estimatedMinutes: 60, position: 5 },
    { name: "Key bushing cloth", description: "Per-key replacement, labour included", kind: "part",
      unitPriceCents: 45000, estimatedMinutes: 45, position: 6 },
    { name: "Travel / service call", description: "Zone-based call-out fee", kind: "fee",
      unitPriceCents: 50000, estimatedMinutes: 0, position: 7 },
    { name: "Repeat client discount", description: "Loyalty adjustment", kind: "discount",
      unitPriceCents: -25000, estimatedMinutes: 0, position: 8 },
  ]);

  const now = new Date();
  const at = (dayOffset: number, hour: number, minute = 0) => {
    const d = new Date(now.getTime() + dayOffset * 86_400_000);
    // Schedule against Manila wall-clock (UTC+8, no DST).
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), hour - 8, minute));
  };

  const jobs = await db.insert(serviceJobs).values([
    { customerId: customerId(maria), locationId: locFor(customerId(maria)), pianoId: pianoFor(customerId(maria)),
      technicianId: techA!.id, title: "Standard tuning — Yamaha U1", serviceType: "tuning",
      status: "scheduled", priority: "normal", scheduledStart: at(0, 9), scheduledEnd: at(0, 10, 30),
      estimatedMinutes: 90, travelMinutes: 25, travelFeeCents: 50000 },
    { customerId: customerId(isa), locationId: locFor(customerId(isa)), pianoId: pianoFor(customerId(isa)),
      technicianId: techB!.id, title: "Concert tuning + voicing — Kawai GX-2", serviceType: "tuning",
      status: "in_progress", priority: "high", scheduledStart: at(0, 13), scheduledEnd: at(0, 16),
      estimatedMinutes: 180, travelMinutes: 35, travelFeeCents: 70000 },
    { customerId: customerId(parish), locationId: locFor(customerId(parish)), pianoId: pianoFor(customerId(parish)),
      technicianId: techA!.id, title: "Chapel piano maintenance visit", serviceType: "maintenance",
      status: "scheduled", priority: "normal", scheduledStart: at(1, 10), scheduledEnd: at(1, 12),
      estimatedMinutes: 120, travelMinutes: 20, travelFeeCents: 40000 },
    { customerId: customerId(lourdes), locationId: locFor(customerId(lourdes)), pianoId: pianoFor(customerId(lourdes)),
      technicianId: techB!.id, title: "Digital piano assessment", serviceType: "assessment",
      status: "quoted", priority: "low", scheduledStart: at(2, 15), scheduledEnd: at(2, 16),
      estimatedMinutes: 60, travelMinutes: 15, travelFeeCents: 30000 },
    { customerId: customerId(maria), locationId: locFor(customerId(maria)), pianoId: pianoFor(customerId(maria)),
      title: "Post-move tuning (unscheduled)", serviceType: "tuning", status: "lead", priority: "normal",
      estimatedMinutes: 90, travelFeeCents: 50000 },
  ]).returning({ id: serviceJobs.id, customerId: serviceJobs.customerId, title: serviceJobs.title });

  const jobByTitle = (t: string) => jobs.find((j) => j.title === t)!;

  await db.insert(serviceJobItems).values([
    { jobId: jobByTitle("Standard tuning — Yamaha U1").id, kind: "service", description: "Standard tuning",
      qty: 1, unitPriceCents: 250000, taxable: true, minutes: 75, position: 1 },
    { jobId: jobByTitle("Standard tuning — Yamaha U1").id, kind: "fee", description: "Travel / service call",
      qty: 1, unitPriceCents: 50000, taxable: true, position: 2 },
    { jobId: jobByTitle("Concert tuning + voicing — Kawai GX-2").id, kind: "service", description: "Concert tuning",
      qty: 1, unitPriceCents: 350000, taxable: true, minutes: 90, position: 1 },
    { jobId: jobByTitle("Concert tuning + voicing — Kawai GX-2").id, kind: "service", description: "Hammer voicing",
      qty: 1, unitPriceCents: 300000, taxable: true, minutes: 120, position: 2 },
    { jobId: jobByTitle("Concert tuning + voicing — Kawai GX-2").id, kind: "discount", description: "Repeat client discount",
      qty: 1, unitPriceCents: -25000, taxable: true, position: 3 },
    { jobId: jobByTitle("Chapel piano maintenance visit").id, kind: "service", description: "Action regulation",
      qty: 1, unitPriceCents: 650000, taxable: true, minutes: 180, position: 1 },
    { jobId: jobByTitle("Chapel piano maintenance visit").id, kind: "part", description: "Damper felts (set)",
      qty: 1, unitPriceCents: 120000, taxable: true, position: 2 },
    { jobId: jobByTitle("Digital piano assessment").id, kind: "service", description: "Assessment visit",
      qty: 1, unitPriceCents: 120000, taxable: true, minutes: 60, position: 1 },
  ]);

  for (const job of jobs) await recalcJobMoney(job.id);

  const completed = jobByTitle("Concert tuning + voicing — Kawai GX-2");
  await db.insert(serviceTimeLogs).values([
    { jobId: completed.id, technicianId: techB!.id, kind: "travel", startedAt: at(-1, 12, 30),
      endedAt: at(-1, 13, 5), minutes: 35, hourlyRateCents: 22000, billable: false },
    { jobId: completed.id, technicianId: techB!.id, kind: "work", startedAt: at(-1, 13, 5),
      endedAt: at(-1, 16, 20), minutes: 195, hourlyRateCents: 22000 },
  ]);
  await recalcJobLabor(completed.id);

  await db.insert(serviceJobEvents).values([
    { jobId: completed.id, type: "created", message: "Job created from repeat booking", actorName: "Owner", at: at(-3, 9) },
    { jobId: completed.id, type: "started", message: "On site", actorName: "Owner", at: at(-1, 13) },
  ]);

  await db.insert(serviceExpenses).values([
    { category: "fuel", description: "Diesel — Buhangin run", amountCents: 65000, spentAt: at(0, 8), jobId: completed.id },
    { category: "materials", description: "Damper felt stock", amountCents: 240000, spentAt: at(-4, 11), vendor: "Jahn Musik" },
    { category: "subcontractor", description: "Mover for grand piano stairwell", amountCents: 150000, spentAt: at(-2, 14), jobId: completed.id },
    { category: "meals", description: "Crew lunch — Sta. Mesa", amountCents: 45000, spentAt: at(1, 12) },
  ]);

  touch();
  return ok();
}
