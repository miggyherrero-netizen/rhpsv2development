"use server";

/**
 * Waitlist by Area — writes (Server Actions). Reads are in service-waitlist-data.ts, shared helpers in
 * service-waitlist-core.ts. Every action starts with requireUser().
 */
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  phCities, serviceCustomers, serviceJobs, servicePianos, serviceLocations, serviceMessageTemplates, serviceRoutes, serviceSettings,
  serviceTechnicians, serviceTrips, serviceWaitlistEntries,
} from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { SERVICE_TYPES, SERVICE_TYPE_LABEL, serviceTypeMinutes } from "@/lib/service";
import { placeLabel } from "@/lib/service-geo";
import { PLACEHOLDERS, WAIT_SOURCES, WAIT_STATUSES, afterMessaged, defaultNextFollowUp, type WaitSource, type WaitStatus } from "@/lib/service-waitlist";
import { createJob } from "@/server/service";
import { insertEntry } from "@/server/service-waitlist-core";
import { findCities, getBarangaysOf } from "@/server/service-waitlist-data";

type Result<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };
const ok = <T>(data?: T): Result<T> => ({ ok: true, data });
const fail = (error: string): Result<never> => ({ ok: false, error });
const touch = () => { revalidatePath("/service", "layout"); };

const text = (v: unknown, max: number): string | null => {
  const s = typeof v === "string" ? v.trim().slice(0, max) : "";
  return s || null;
};
const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T => (typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : fallback);
const when = (v: unknown): Date | null => {
  if (v instanceof Date) return v;
  if (typeof v !== "string" || !v) return null;
  // "2026-10-18T09:00" from a datetime-local box is Manila time.
  const d = new Date(/(Z|[+-]\d{2}:?\d{2})$/.test(v) ? v : `${v.length === 16 ? `${v}:00` : v}+08:00`);
  return Number.isNaN(d.getTime()) ? null : d;
};
const pesoToCents = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(String(v ?? "").replace(/[^\d.]/g, ""));
  return Number.isFinite(n) ? Math.max(0, Math.min(99_999_999_00, Math.round(n * 100))) : 0;
};

/* ------------------------------------------------------------------ places */

export type PlaceHit = { code: string; name: string; label: string; provinceName: string | null; regionShort: string; hasBarangays: boolean };

/** Typeahead for the city/municipality pickers. */
export async function searchCities(query: string): Promise<Result<PlaceHit[]>> {
  await requireUser();
  const hits = await findCities(String(query ?? "").slice(0, 60), 8);
  return ok(hits.map((c) => ({
    code: c.code, name: c.name, provinceName: c.provinceName, regionShort: c.regionShort,
    label: placeLabel({ city: c.name, province: c.provinceName, regionShort: c.regionShort }), hasBarangays: c.code === "112402000",
  })));
}

export async function loadBarangays(cityCode: string): Promise<Result<{ code: string; name: string }[]>> {
  await requireUser();
  return ok(await getBarangaysOf(String(cityCode ?? "")));
}

/* ------------------------------------------------------------------ entries */

export type EntryInput = {
  customerId: string; pianoId?: string | null; serviceType?: string; cityCode?: string | null; barangayCode?: string | null;
  requestedAt?: string | null; nextFollowUpAt?: string | null; estValue?: number; notes?: string | null; source?: string;
};

export async function addWaitlistEntry(input: EntryInput): Promise<Result<{ id: string }>> {
  await requireUser();
  if (!input.customerId) return fail("Pick a customer.");
  const [customer] = await db.select({ id: serviceCustomers.id }).from(serviceCustomers).where(eq(serviceCustomers.id, input.customerId)).limit(1);
  if (!customer) return fail("That customer no longer exists.");
  const pianoId = text(input.pianoId, 60);
  if (pianoId) {
    const [p] = await db.select({ id: servicePianos.id }).from(servicePianos).where(and(eq(servicePianos.id, pianoId), eq(servicePianos.customerId, input.customerId))).limit(1);
    if (!p) return fail("That piano belongs to a different customer.");
  }
  const cityCode = text(input.cityCode, 20);
  if (cityCode && !(await db.select({ c: phCities.code }).from(phCities).where(eq(phCities.code, cityCode)).limit(1)).length) return fail("That city isn't in the list.");
  const now = new Date();
  const id = await insertEntry(db, {
    customerId: input.customerId, pianoId, serviceType: oneOf(input.serviceType, SERVICE_TYPES.map((s) => s.key), "tuning"),
    // Not given -> default from the customer's saved address; given (even empty) -> exactly that.
    ...(input.cityCode !== undefined ? { cityCode, barangayCode: text(input.barangayCode, 20) } : {}),
    requestedAt: when(input.requestedAt) ?? now, nextFollowUpAt: when(input.nextFollowUpAt) ?? defaultNextFollowUp(now),
    estValueCents: pesoToCents(input.estValue), notes: text(input.notes, 1_000), source: oneOf(input.source, WAIT_SOURCES.map((s) => s.key) as WaitSource[], "phone"),
  }, now);
  touch();
  return ok({ id });
}

export async function updateWaitlistEntry(id: string, patch: Partial<EntryInput> & { status?: string }): Promise<Result> {
  await requireUser();
  const [cur] = await db.select().from(serviceWaitlistEntries).where(eq(serviceWaitlistEntries.id, id)).limit(1);
  if (!cur) return fail("Entry not found.");
  const set: Partial<typeof serviceWaitlistEntries.$inferInsert> = { updatedAt: new Date() };
  if (patch.status !== undefined) set.status = oneOf(patch.status, WAIT_STATUSES.map((s) => s.key) as WaitStatus[], cur.status);
  if (patch.notes !== undefined) set.notes = text(patch.notes, 1_000);
  if (patch.estValue !== undefined) set.estValueCents = pesoToCents(patch.estValue);
  if (patch.serviceType) set.serviceType = oneOf(patch.serviceType, SERVICE_TYPES.map((s) => s.key), "tuning");
  if (patch.pianoId !== undefined) set.pianoId = text(patch.pianoId, 60);
  if (patch.cityCode !== undefined) { set.cityCode = text(patch.cityCode, 20); set.barangayCode = text(patch.barangayCode, 20); }
  if (patch.nextFollowUpAt !== undefined) {
    const d = when(patch.nextFollowUpAt);
    if (!d) return fail("Every entry needs a next follow-up date.");
    set.nextFollowUpAt = d;
  }
  if (patch.requestedAt !== undefined) { const d = when(patch.requestedAt); if (d) set.requestedAt = d; }
  await db.update(serviceWaitlistEntries).set(set).where(eq(serviceWaitlistEntries.id, id));
  touch();
  return ok();
}

export async function setWaitlistStatus(id: string, status: string): Promise<Result> {
  return updateWaitlistEntry(id, { status });
}

/** "Messaged ✓": status → messaged, last contacted now, next follow-up in 3 days, one more message counted. */
export async function markMessaged(id: string): Promise<Result<{ status: string; followUpCount: number; nextFollowUpAt: Date }>> {
  await requireUser();
  const [cur] = await db.select().from(serviceWaitlistEntries).where(eq(serviceWaitlistEntries.id, id)).limit(1);
  if (!cur) return fail("Entry not found.");
  if (["scheduled", "done"].includes(cur.status)) return fail("This one is already booked.");
  const now = new Date();
  const next = afterMessaged({ status: cur.status, followUpCount: cur.followUpCount }, now);
  // A "confirmed" client who gets another message stays confirmed.
  const status = cur.status === "confirmed" ? "confirmed" : (next.status as WaitStatus);
  await db.update(serviceWaitlistEntries).set({
    status, followUpCount: next.followUpCount, lastContactedAt: next.lastContactedAt, nextFollowUpAt: next.nextFollowUpAt, updatedAt: now,
  }).where(eq(serviceWaitlistEntries.id, id));
  touch();
  return ok({ status, followUpCount: next.followUpCount, nextFollowUpAt: next.nextFollowUpAt });
}

export async function deleteWaitlistEntry(id: string): Promise<Result> {
  await requireUser();
  await db.delete(serviceWaitlistEntries).where(eq(serviceWaitlistEntries.id, id));
  touch();
  return ok();
}

/* ------------------------------------------------------------------ trips */

export async function createTrip(input: { name: string; cityCode: string | null; tripDate: string | null }): Promise<Result<{ id: string }>> {
  await requireUser();
  const name = text(input.name, 120);
  if (!name) return fail("Name the trip.");
  const cityCode = text(input.cityCode, 20);
  if (cityCode && !(await db.select({ c: phCities.code }).from(phCities).where(eq(phCities.code, cityCode)).limit(1)).length) return fail("That city isn't in the list.");
  const [row] = await db.insert(serviceTrips).values({ name, cityCode, tripDate: when(input.tripDate) }).returning({ id: serviceTrips.id });
  touch();
  return ok({ id: row!.id });
}

/**
 * "Confirm + time": books the client as a Scheduled job on the trip and marks the entry scheduled.
 * Needs the entry's piano (jobs are always for a piano); the error says so when it is missing.
 */
export async function confirmEntryForTrip(input: { entryId: string; tripId: string; start: string; technicianId?: string | null }): Promise<Result<{ jobId: string }>> {
  await requireUser();
  const [entry] = await db.select().from(serviceWaitlistEntries).where(eq(serviceWaitlistEntries.id, input.entryId)).limit(1);
  if (!entry) return fail("Entry not found.");
  if (entry.jobId && entry.status === "scheduled") return ok({ jobId: entry.jobId });
  const [trip] = await db.select().from(serviceTrips).where(eq(serviceTrips.id, input.tripId)).limit(1);
  if (!trip) return fail("Trip not found.");
  const start = when(input.start);
  if (!start) return fail("Pick the visit time first.");
  if (!entry.pianoId) return fail("Choose this client's piano on their waitlist entry first — every visit is for a piano.");
  const [piano] = await db.select().from(servicePianos).where(eq(servicePianos.id, entry.pianoId)).limit(1);
  const locations = await db.select().from(serviceLocations).where(eq(serviceLocations.customerId, entry.customerId));
  const loc = locations.find((l) => entry.cityCode && l.cityCode === entry.cityCode) ?? locations[0] ?? null;
  const techs = input.technicianId === undefined ? await db.select({ id: serviceTechnicians.id }).from(serviceTechnicians).where(eq(serviceTechnicians.active, true)) : [];
  const technicianId = input.technicianId ?? (techs.length === 1 ? techs[0]!.id : null);
  const typeLabel = SERVICE_TYPE_LABEL[entry.serviceType] ?? "Visit";
  const pianoLabel = piano ? [piano.brand, piano.model].filter(Boolean).join(" ") : "";
  const created = await createJob({
    customerId: entry.customerId, locationId: loc?.id ?? null, pianoId: entry.pianoId, technicianId,
    title: pianoLabel ? `${typeLabel} — ${pianoLabel}` : typeLabel, serviceType: entry.serviceType, status: "scheduled",
    scheduledStart: input.start, estimatedMinutes: serviceTypeMinutes(entry.serviceType), notes: entry.notes ?? null,
  });
  if (!created.ok || !created.data) return fail(created.ok ? "Couldn't create the visit." : created.error);
  await db.update(serviceJobs).set({ tripId: trip.id }).where(eq(serviceJobs.id, created.data.id));
  await db.update(serviceWaitlistEntries).set({ status: "scheduled", jobId: created.data.id, tripId: trip.id, updatedAt: new Date() }).where(eq(serviceWaitlistEntries.id, entry.id));
  touch();
  return ok({ jobId: created.data.id });
}

/** Closes the "N still waiting — message them?" prompt for a finished trip. */
export async function closeTrip(tripId: string): Promise<Result> {
  await requireUser();
  await db.update(serviceTrips).set({ status: "done", updatedAt: new Date() }).where(eq(serviceTrips.id, tripId));
  touch();
  return ok();
}

/* ------------------------------------------------------------------ settings: home base, routes, templates */

export async function savePlanSettings(input: { homeBaseCityCode: string; tripRadiusKm: number }): Promise<Result> {
  const user = await requireUser();
  const code = text(input.homeBaseCityCode, 20);
  if (!code || !(await db.select({ c: phCities.code }).from(phCities).where(eq(phCities.code, code)).limit(1)).length) return fail("Pick the home base city from the list.");
  const km = Math.round(Number(input.tripRadiusKm));
  if (!Number.isFinite(km) || km < 5 || km > 300) return fail("Search distance must be between 5 and 300 km.");
  await db.update(serviceSettings).set({ homeBaseCityCode: code, tripRadiusKm: km, updatedAt: new Date() }).where(eq(serviceSettings.ownerId, user.id));
  touch();
  return ok();
}

export async function saveRoute(input: { id?: string | null; name: string; cityCodes: string[] }): Promise<Result<{ id: string }>> {
  await requireUser();
  const name = text(input.name, 80);
  if (!name) return fail("Name the route.");
  const codes = [...new Set((input.cityCodes ?? []).map((c) => String(c)).filter(Boolean))].slice(0, 40);
  if (codes.length < 2) return fail("A route needs at least two cities.");
  const known = await db.select({ code: phCities.code }).from(phCities);
  const valid = new Set(known.map((k) => k.code));
  if (codes.some((c) => !valid.has(c))) return fail("One of the cities isn't in the list.");
  if (input.id) {
    await db.update(serviceRoutes).set({ name, cityCodes: codes }).where(eq(serviceRoutes.id, input.id));
    touch();
    return ok({ id: input.id });
  }
  const [row] = await db.insert(serviceRoutes).values({ name, cityCodes: codes }).returning({ id: serviceRoutes.id });
  touch();
  return ok({ id: row!.id });
}

export async function deleteRoute(id: string): Promise<Result> {
  await requireUser();
  await db.delete(serviceRoutes).where(eq(serviceRoutes.id, id));
  touch();
  return ok();
}

export async function saveTemplate(key: string, patch: { name?: string; body: string }): Promise<Result> {
  await requireUser();
  const known = ["area_trip", "follow_up", "confirm_day_before", "recall"];
  if (!known.includes(key)) return fail("Unknown template.");
  const body = text(patch.body, 2_000);
  if (!body) return fail("The message can't be empty.");
  // Warn about typos like {firstname}: only the known placeholders get filled in.
  const unknown = [...body.matchAll(/\{([a-zA-Z_]+)\}/g)].map((m) => m[1]!).filter((p) => !(PLACEHOLDERS as readonly string[]).includes(p));
  if (unknown.length) return fail(`Unknown placeholder${unknown.length > 1 ? "s" : ""}: ${[...new Set(unknown)].map((u) => `{${u}}`).join(", ")}.`);
  await db.insert(serviceMessageTemplates).values({ key, name: text(patch.name, 80) ?? key, body })
    .onConflictDoUpdate({ target: serviceMessageTemplates.key, set: { ...(text(patch.name, 80) ? { name: text(patch.name, 80)! } : {}), body, updatedAt: new Date() } });
  touch();
  return ok();
}
