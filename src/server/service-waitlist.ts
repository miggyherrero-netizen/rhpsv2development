"use server";

/**
 * Waitlist by Area — writes (Server Actions). Reads are in service-waitlist-data.ts, shared helpers in
 * service-waitlist-core.ts. Every action starts with requireUser().
 */
import { pianoLabel as pianoDisplayName } from "@/lib/service-piano-info";
import { realBrand } from "@/lib/service-piano-info";
import { revalidatePath } from "next/cache";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  phCities, serviceCustomers, serviceJobs, servicePianos, serviceLocations, serviceMessageTemplates, serviceRoutes, serviceSettings,
  serviceTechnicians, serviceTrips, serviceWaitlistEntries,
} from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { SERVICE_TYPES, SERVICE_TYPE_LABEL, serviceTypeMinutes } from "@/lib/service";
import { placeLabel } from "@/lib/service-geo";
import { isBatchCustomer } from "@/lib/service-reports";
import { NOT_NOW_DAYS, PLACEHOLDERS, WAIT_SOURCES, WAIT_STATUSES, afterMessaged, defaultNextFollowUp, type WaitSource, type WaitStatus } from "@/lib/service-waitlist";
import { createJob, type JobInput } from "@/server/service";
import { claimEntryForTrip, convertEntryToJob, createQuickInquiryEntry, insertEntry } from "@/server/service-waitlist-core";
import { validateQuickInquiry, type InquiryField, type QuickInquiryInput } from "@/lib/service-inquiry";
import { canConvertEntry, waitlistToJobInitial, type JobInitial } from "@/lib/service-waitlist-convert";
import { findCities, getBarangaysOf } from "@/server/service-waitlist-data";
import { canCreateNew } from "@/lib/service-customer-match";
import { withNewCustomerTx, type NewCustomerInput } from "@/server/service-new-customer";

type Result<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };
const ok = <T>(data?: T): Result<T> => ({ ok: true, data });
const fail = (error: string): Result<never> => ({ ok: false, error });
const touch = () => { revalidatePath("/service", "layout"); };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  return Number.isFinite(n) ? Math.max(0, Math.min(2_000_000_000, Math.round(n * 100))) : 0;
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

/**
 * Add to waitlist for a customer typed in the form. The new customer and the entry are written in ONE transaction, so a
 * refused entry (bad area, duplicate name) leaves no customer behind. A brand-new customer gets a first piano ("N/A", needs info) that the entry points at, and has no saved
 * address yet, so the entry takes the area chosen in the form (or none).
 */
export async function addWaitlistEntryWithNewCustomer(
  newCustomer: NewCustomerInput,
  input: Omit<EntryInput, "customerId" | "pianoId">,
): Promise<{ ok: true; data: { id: string; customerId: string; customerName: string } } | { ok: false; error: string; duplicateOf?: { id: string; name: string } }> {
  await requireUser();
  if (!newCustomer || typeof newCustomer !== "object" || !canCreateNew(newCustomer.name)) return { ok: false, error: "Type the customer's name — it needs at least one letter." };
  if (!input || typeof input !== "object") return { ok: false, error: "The entry details are missing. Reopen the form and try again." };
  const cityCode = text(input.cityCode, 20);
  const now = new Date();
  const res = await withNewCustomerTx(newCustomer, { brand: "" }, async (ctx, tx) => {
    if (cityCode && !(await tx.select({ c: phCities.code }).from(phCities).where(eq(phCities.code, cityCode)).limit(1)).length) return { ok: false as const, error: "That city isn't in the list." };
    const id = await insertEntry(tx, {
      customerId: ctx.customerId, pianoId: ctx.pianoId, serviceType: oneOf(input.serviceType, SERVICE_TYPES.map((s) => s.key), "tuning"),
      ...(input.cityCode !== undefined ? { cityCode, barangayCode: text(input.barangayCode, 20) } : {}),
      requestedAt: when(input.requestedAt) ?? now, nextFollowUpAt: when(input.nextFollowUpAt) ?? defaultNextFollowUp(now),
      estValueCents: pesoToCents(input.estValue), notes: text(input.notes, 1_000), source: oneOf(input.source, WAIT_SOURCES.map((s) => s.key) as WaitSource[], "phone"),
    }, now);
    return { ok: true as const, data: { id } };
  });
  if (!res.ok) return res;
  touch();
  return { ok: true, data: { id: res.data!.id, customerId: res.customerId, customerName: res.customerName } };
}

export async function updateWaitlistEntry(id: string, patch: Partial<EntryInput> & { status?: string }): Promise<Result> {
  await requireUser();
  if (!UUID_RE.test(String(id))) return fail("Entry not found.");
  const [cur] = await db.select().from(serviceWaitlistEntries).where(eq(serviceWaitlistEntries.id, id)).limit(1);
  if (!cur) return fail("Entry not found.");
  const set: Partial<typeof serviceWaitlistEntries.$inferInsert> = { updatedAt: new Date() };
  if (patch.status !== undefined) {
    const next = oneOf(patch.status, WAIT_STATUSES.map((s) => s.key) as WaitStatus[], cur.status);
    // "Scheduled" and "done" mean a visit exists: they come from booking / completing a job, not from the edit form.
    if ((next === "scheduled" || next === "done") && next !== cur.status && !cur.jobId) return fail("Book the visit first — “Scheduled” and “Done” follow a real job.");
    set.status = next;
    if (next !== cur.status) {
      // A manual status change restarts the follow-up cycle sensibly instead of keeping stale counters/dates.
      if (next === "waiting") { set.followUpCount = 0; set.nextFollowUpAt = defaultNextFollowUp(set.updatedAt as Date); }
      if (next === "not_now") set.nextFollowUpAt = new Date((set.updatedAt as Date).getTime() + NOT_NOW_DAYS * 86_400_000);
    }
  }
  if (patch.notes !== undefined) set.notes = text(patch.notes, 1_000);
  if (patch.estValue !== undefined) set.estValueCents = pesoToCents(patch.estValue);
  if (patch.serviceType) set.serviceType = oneOf(patch.serviceType, SERVICE_TYPES.map((s) => s.key), "tuning");
  if (patch.pianoId !== undefined) {
    const pid = text(patch.pianoId, 60);
    if (pid) {
      if (!UUID_RE.test(pid)) return fail("That piano isn't valid.");
      const [p] = await db.select({ id: servicePianos.id }).from(servicePianos).where(and(eq(servicePianos.id, pid), eq(servicePianos.customerId, cur.customerId))).limit(1);
      if (!p) return fail("That piano belongs to a different customer.");
    }
    set.pianoId = pid;
  }
  if (patch.cityCode !== undefined) {
    const code = text(patch.cityCode, 20);
    if (code && !(await db.select({ c: phCities.code }).from(phCities).where(eq(phCities.code, code)).limit(1)).length) return fail("That city isn't in the list.");
    set.cityCode = code; set.barangayCode = code ? text(patch.barangayCode, 20) : null;
  }
  if (patch.nextFollowUpAt !== undefined && !(set.nextFollowUpAt && patch.status !== undefined)) {
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

/* ------------------------------------------------------------------ quick inquiry */

export type QuickInquiryResult = { entryId: string; customerId: string; customerName: string; customerWasNew: boolean; nextFollowUpAt: string; duplicate: boolean };

/**
 * "Quick inquiry": name, phone, area and what they asked for. Finds the customer with the same phone number or makes a
 * new one, then adds the waitlist entry — the normal follow-up (3 days out) applies. Nothing is defaulted silently:
 * a missing name, phone, area or request is rejected with a message, and `fields` says which box to mark.
 */
export async function createQuickInquiry(input: QuickInquiryInput): Promise<Result<QuickInquiryResult> & { fields?: Partial<Record<InquiryField, string>> }> {
  await requireUser();
  const check = validateQuickInquiry(input ?? {});
  if (!check.ok) return { ...fail(check.error), fields: check.errors };
  const res = await createQuickInquiryEntry(check.value);
  if (!res.ok) return fail(res.error);
  touch();
  // Only the matched customer's name goes back (so the owner can see who it was attached to) — nothing else about them.
  return ok({ ...res.data, nextFollowUpAt: res.data.nextFollowUpAt.toISOString() });
}

/* ------------------------------------------------------------------ waitlist -> job */

/** What the job form starts with for "Convert to job": the entry's customer, piano, location, service, title and notes. */
export async function getConvertDefaults(entryId: string): Promise<Result<{ initial: JobInitial; customerName: string; isBatch: boolean; areaLabel: string | null }>> {
  await requireUser();
  if (!UUID_RE.test(String(entryId))) return fail("Entry not found.");
  const [entry] = await db.select().from(serviceWaitlistEntries).where(eq(serviceWaitlistEntries.id, entryId)).limit(1);
  if (!entry) return fail("Entry not found. It may have been removed.");
  if (!canConvertEntry(entry)) return fail(entry.status === "done" ? "This one is already done." : "This client is already booked as a job.");
  const [[customer], locations, pianos, [city]] = await Promise.all([
    db.select({ id: serviceCustomers.id, name: serviceCustomers.name, tags: serviceCustomers.tags }).from(serviceCustomers).where(eq(serviceCustomers.id, entry.customerId)).limit(1),
    db.select({ id: serviceLocations.id, cityCode: serviceLocations.cityCode, barangayCode: serviceLocations.barangayCode }).from(serviceLocations)
      .where(eq(serviceLocations.customerId, entry.customerId)).orderBy(serviceLocations.createdAt),
    db.select({ id: servicePianos.id, brand: servicePianos.brand, model: servicePianos.model, type: servicePianos.type }).from(servicePianos)
      .where(eq(servicePianos.customerId, entry.customerId)).orderBy(servicePianos.brand),
    entry.cityCode ? db.select({ name: phCities.name }).from(phCities).where(eq(phCities.code, entry.cityCode)).limit(1) : Promise.resolve([] as { name: string }[]),
  ]);
  if (!customer) return fail("That customer no longer exists.");
  const initial = waitlistToJobInitial(
    entry, customer, locations,
    pianos.map((p) => ({ id: p.id, label: pianoDisplayName(p), titleName: realBrand(p.brand) ? pianoDisplayName(p) : "" })),
  );
  return ok({ initial, customerName: customer.name, isBatch: isBatchCustomer(customer.tags, customer.name), areaLabel: city?.name ?? null });
}

/**
 * "Convert to job": books the waitlist entry as a job, once, and links the two. The job form values come from the
 * screen (prefilled from the entry); the customer must be the entry's own. See `convertEntryToJob` for the claim/undo rules.
 */
export async function convertWaitlistEntryToJob(entryId: string, values: JobInput): Promise<Result<{ jobId: string }>> {
  await requireUser();
  if (!UUID_RE.test(String(entryId))) return fail("Entry not found.");
  if (!values || typeof values !== "object" || Array.isArray(values)) return fail("The job details are missing. Reopen the form and try again.");
  const res = await convertEntryToJob(entryId, values, createJob);
  if (!res.ok) return fail(res.error);
  touch();
  return ok(res.data);
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
  if (!UUID_RE.test(String(input.entryId)) || !UUID_RE.test(String(input.tripId))) return fail("Entry not found.");
  const [entry] = await db.select().from(serviceWaitlistEntries).where(eq(serviceWaitlistEntries.id, input.entryId)).limit(1);
  if (!entry) return fail("Entry not found.");
  // Already booked on a live visit: hand that back instead of making a second one.
  if (entry.jobId) {
    const [existing] = await db.select({ id: serviceJobs.id, status: serviceJobs.status }).from(serviceJobs).where(eq(serviceJobs.id, entry.jobId)).limit(1);
    if (existing && existing.status !== "cancelled" && entry.status === "scheduled") return ok({ jobId: existing.id });
  }
  if (entry.status === "done") return fail("This one is already done.");
  const [trip] = await db.select().from(serviceTrips).where(eq(serviceTrips.id, input.tripId)).limit(1);
  if (!trip) return fail("Trip not found.");
  const start = when(input.start);
  if (!start) return fail("Pick the visit time first.");

  // A client's only piano is the obvious one; with several (or none) it has to be chosen first.
  let pianoId = entry.pianoId;
  if (!pianoId) {
    const owned = await db.select({ id: servicePianos.id }).from(servicePianos).where(eq(servicePianos.customerId, entry.customerId)).limit(2);
    if (owned.length === 1) pianoId = owned[0]!.id;
  }
  if (!pianoId) return fail("Choose this client's piano on their waitlist entry first (add it on the customer page if they have none) — every visit is for a piano.");

  // Claim the entry before creating anything, so a double-click or a second tab can only ever book it once.
  const prevStatus = entry.status;
  const claimed = await claimEntryForTrip(entry.id, trip.id, pianoId);
  if (!claimed) return fail("This client was just booked or finished — refresh the list.");
  if (prevStatus === "scheduled" && !entry.jobId) { /* a stale "scheduled" with no visit: carry on and book it properly */ }

  const [piano] = await db.select().from(servicePianos).where(eq(servicePianos.id, pianoId)).limit(1);
  const locations = await db.select().from(serviceLocations).where(eq(serviceLocations.customerId, entry.customerId));
  const loc = locations.find((l) => entry.cityCode && l.cityCode === entry.cityCode) ?? locations[0] ?? null;
  const techs = input.technicianId === undefined ? await db.select({ id: serviceTechnicians.id }).from(serviceTechnicians).where(eq(serviceTechnicians.active, true)) : [];
  const technicianId = input.technicianId ?? (techs.length === 1 ? techs[0]!.id : null);
  const typeLabel = SERVICE_TYPE_LABEL[entry.serviceType] ?? "Visit";
  const pianoLabel = piano && realBrand(piano.brand) ? pianoDisplayName(piano) : "";
  const created = await createJob({
    customerId: entry.customerId, locationId: loc?.id ?? null, pianoId, technicianId,
    title: pianoLabel ? `${typeLabel} — ${pianoLabel}` : typeLabel, serviceType: entry.serviceType, status: "scheduled",
    scheduledStart: input.start, estimatedMinutes: serviceTypeMinutes(entry.serviceType), notes: entry.notes ?? null,
  });
  if (!created.ok || !created.data) {
    // Nothing was booked: put the entry back exactly as it was.
    await db.update(serviceWaitlistEntries).set({ status: prevStatus, tripId: entry.tripId, pianoId: entry.pianoId, updatedAt: new Date() }).where(eq(serviceWaitlistEntries.id, entry.id));
    return fail(created.ok ? "Couldn't create the visit." : created.error);
  }
  await db.update(serviceJobs).set({ tripId: trip.id }).where(eq(serviceJobs.id, created.data.id));
  await db.update(serviceWaitlistEntries).set({ jobId: created.data.id, updatedAt: new Date() }).where(eq(serviceWaitlistEntries.id, entry.id));
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
