/**
 * Waitlist writes that other server code calls directly (job completion, website inquiries, the daily sweep).
 * Not a "use server" file on purpose: these are internal helpers, not endpoints a browser can invoke.
 */
import { and, eq, inArray, isNotNull, lte } from "drizzle-orm";
import { db } from "@/db";
import {
  phCities, serviceCustomers, serviceLocations, servicePianos, serviceWaitlistEntries, serviceJobs,
} from "@/db/schema";
import { countsAsTuning } from "@/lib/service-sale";
import { findCityInText } from "@/lib/service-geo";
import {
  OPEN_WAIT_STATUSES, defaultNextFollowUp, parkAsNotNow, recallEntryFor, shouldGoNotNow, type WaitSource, type WaitStatus,
} from "@/lib/service-waitlist";

type Exec = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Where this customer's visits usually are: the first saved address that has a city picked. */
export async function defaultPlaceForCustomer(x: Exec, customerId: string): Promise<{ cityCode: string | null; barangayCode: string | null }> {
  const [loc] = await x
    .select({ cityCode: serviceLocations.cityCode, barangayCode: serviceLocations.barangayCode })
    .from(serviceLocations)
    .where(and(eq(serviceLocations.customerId, customerId), isNotNull(serviceLocations.cityCode)))
    .orderBy(serviceLocations.createdAt)
    .limit(1);
  return { cityCode: loc?.cityCode ?? null, barangayCode: loc?.barangayCode ?? null };
}

export type NewEntry = {
  customerId: string; pianoId?: string | null; serviceType?: string; cityCode?: string | null; barangayCode?: string | null;
  requestedAt?: Date; nextFollowUpAt?: Date; estValueCents?: number; notes?: string | null; source?: WaitSource;
  status?: WaitStatus;
};

/** Creates an entry. Area defaults from the customer's saved address; the next follow-up defaults to 3 days out. */
export async function insertEntry(x: Exec, input: NewEntry, now: Date = new Date()): Promise<string> {
  const place = input.cityCode === undefined ? await defaultPlaceForCustomer(x, input.customerId) : { cityCode: input.cityCode, barangayCode: input.barangayCode ?? null };
  const [row] = await x.insert(serviceWaitlistEntries).values({
    customerId: input.customerId,
    pianoId: input.pianoId ?? null,
    serviceType: input.serviceType ?? "tuning",
    cityCode: place.cityCode,
    barangayCode: place.barangayCode,
    requestedAt: input.requestedAt ?? now,
    status: input.status ?? "waiting",
    nextFollowUpAt: input.nextFollowUpAt ?? defaultNextFollowUp(now),
    estValueCents: Math.max(0, Math.round(input.estValueCents ?? 0)),
    notes: input.notes ?? null,
    source: input.source ?? "phone",
  }).returning({ id: serviceWaitlistEntries.id });
  return row!.id;
}

/**
 * A completed tuning visit leaves a recall on the waitlist: due one tuning interval later, status waiting.
 * One open entry per piano — never a second one while the first is still being worked.
 */
export async function ensureRecallEntry(jobId: string): Promise<void> {
  const [job] = await db.select().from(serviceJobs).where(eq(serviceJobs.id, jobId)).limit(1);
  if (!job || job.jobType !== "service" || !job.pianoId || !job.completedAt || !countsAsTuning(job.serviceType)) return;
  const [piano] = await db.select().from(servicePianos).where(eq(servicePianos.id, job.pianoId)).limit(1);
  if (!piano) return;
  const recall = recallEntryFor({ completedAt: job.completedAt }, piano.tuningIntervalMonths || 6);
  if (!recall) return;
  const [existing] = await db.select({ id: serviceWaitlistEntries.id }).from(serviceWaitlistEntries)
    .where(and(eq(serviceWaitlistEntries.pianoId, piano.id), inArray(serviceWaitlistEntries.status, [...OPEN_WAIT_STATUSES, "not_now"] as WaitStatus[]))).limit(1);
  if (existing) return;
  let place = await defaultPlaceForCustomer(db, job.customerId);
  if (job.locationId) {
    const [loc] = await db.select({ cityCode: serviceLocations.cityCode, barangayCode: serviceLocations.barangayCode }).from(serviceLocations).where(eq(serviceLocations.id, job.locationId)).limit(1);
    if (loc?.cityCode) place = { cityCode: loc.cityCode, barangayCode: loc.barangayCode };
  }
  await insertEntry(db, {
    customerId: job.customerId, pianoId: piano.id, serviceType: "tuning", cityCode: place.cityCode, barangayCode: place.barangayCode,
    requestedAt: recall.requestedAt, nextFollowUpAt: recall.nextFollowUpAt, status: recall.status, source: recall.source,
  });
}

/** The job this entry was booked as is finished -> the entry is done. */
export async function completeEntriesForJob(jobId: string): Promise<void> {
  await db.update(serviceWaitlistEntries).set({ status: "done", updatedAt: new Date() })
    .where(and(eq(serviceWaitlistEntries.jobId, jobId), inArray(serviceWaitlistEntries.status, ["confirmed", "scheduled", "waiting", "messaged"] as WaitStatus[])));
}

/** Messaged three times with no yes and the last follow-up date passed -> "not now", back in 30 days. */
export async function sweepNotNow(now: Date = new Date()): Promise<number> {
  const stale = await db.select().from(serviceWaitlistEntries)
    .where(and(eq(serviceWaitlistEntries.status, "messaged"), lte(serviceWaitlistEntries.nextFollowUpAt, now)));
  const ids = stale.filter((e) => shouldGoNotNow({ status: e.status, followUpCount: e.followUpCount, nextFollowUpAt: e.nextFollowUpAt }, now)).map((e) => e.id);
  if (!ids.length) return 0;
  const parked = parkAsNotNow(now);
  await db.update(serviceWaitlistEntries).set({ status: parked.status, nextFollowUpAt: parked.nextFollowUpAt, updatedAt: now })
    .where(and(inArray(serviceWaitlistEntries.id, ids), eq(serviceWaitlistEntries.status, "messaged")));
  return ids.length;
}

/**
 * A website inquiry becomes a waitlist entry: reuse the customer with the same phone (or make one), find the
 * city in what they wrote, and when none is recognised the entry lands in "Unsorted". Never throws into the inquiry form.
 */
export async function createWaitlistFromInquiry(input: { name: string; phone?: string | null; pianoContext?: string | null; message?: string | null }): Promise<void> {
  try {
    const phone = (input.phone ?? "").trim();
    let customerId: string | undefined;
    if (phone) {
      const [hit] = await db.select({ id: serviceCustomers.id }).from(serviceCustomers).where(eq(serviceCustomers.phone, phone)).limit(1);
      customerId = hit?.id;
    }
    if (!customerId) {
      const [created] = await db.insert(serviceCustomers).values({ name: input.name.trim(), phone: phone || null, source: "website", tags: ["from:website-inquiry"] }).returning({ id: serviceCustomers.id });
      customerId = created!.id;
    }
    const cities = await db.select({ code: phCities.code, name: phCities.name }).from(phCities);
    const text = [input.message, input.pianoContext].filter(Boolean).join(" ");
    const found = findCityInText(text, cities);
    const note = [input.pianoContext, input.message].filter(Boolean).join(" — ").slice(0, 1_000) || null;
    await insertEntry(db, { customerId, cityCode: found?.code ?? null, barangayCode: null, serviceType: "tuning", source: "website", notes: note });
  } catch (err) {
    console.error("createWaitlistFromInquiry failed", err);
  }
}
