/**
 * Waitlist writes that other server code calls directly (job completion, website inquiries, the daily sweep).
 * Not a "use server" file on purpose: these are internal helpers, not endpoints a browser can invoke.
 */
import { and, asc, eq, gte, inArray, isNotNull, isNull, lt, lte, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  phBarangays, phCities, serviceCustomers, serviceLocations, servicePianos, serviceWaitlistEntries, serviceJobs,
} from "@/db/schema";
import type { JobInput } from "@/server/service";
import { CONVERTIBLE_STATUSES } from "@/lib/service-waitlist-convert";
import { composeInquiryNotes, customerSourceFor, phoneMatchKey, type QuickInquiryValue } from "@/lib/service-inquiry";
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
  // This piano was just tuned: any request still open for it (a phone call, a website inquiry, an older recall) is served.
  await db.update(serviceWaitlistEntries).set({ status: "done", jobId: job.id, updatedAt: new Date() })
    .where(and(eq(serviceWaitlistEntries.pianoId, piano.id), eq(serviceWaitlistEntries.serviceType, "tuning"), inArray(serviceWaitlistEntries.status, [...OPEN_WAIT_STATUSES, "not_now"] as WaitStatus[])));
  // One open recall per piano: never a second while the first is still being worked.
  const [existing] = await db.select({ id: serviceWaitlistEntries.id }).from(serviceWaitlistEntries)
    .where(and(eq(serviceWaitlistEntries.pianoId, piano.id), eq(serviceWaitlistEntries.source, "recall"), inArray(serviceWaitlistEntries.status, [...OPEN_WAIT_STATUSES, "not_now"] as WaitStatus[]))).limit(1);
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

/**
 * A booked job was cancelled (-> the client is waiting again, with a fresh follow-up) or a finished one was reopened
 * (-> the entry goes back from "done" to "scheduled"). Without this the entry would be stranded and vanish from every list.
 */
export async function releaseEntriesForJob(jobId: string, why: "cancelled" | "reopened", now: Date = new Date()): Promise<void> {
  if (why === "cancelled") {
    await db.update(serviceWaitlistEntries)
      .set({ status: "waiting", jobId: null, tripId: null, nextFollowUpAt: defaultNextFollowUp(now), updatedAt: now })
      .where(and(eq(serviceWaitlistEntries.jobId, jobId), inArray(serviceWaitlistEntries.status, ["scheduled", "done"] as WaitStatus[])));
  } else {
    await db.update(serviceWaitlistEntries).set({ status: "scheduled", updatedAt: now })
      .where(and(eq(serviceWaitlistEntries.jobId, jobId), eq(serviceWaitlistEntries.status, "done")));
  }
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
 * The customer whose saved phone has exactly these digits (however it was typed: spaces, dashes, "+" are ignored).
 * Oldest first, so the answer is stable. Returns the id and name only — nothing else about them.
 */
export async function findCustomerByPhoneDigits(x: Exec, digits: string, opts: { activeOnly?: boolean } = {}): Promise<{ id: string; name: string } | null> {
  if (digits.length < 7) return null;
  // Same rule as phoneMatchKey(): 0917…, +63917… and 63917… are one number (last 10 digits when it starts with 0 or 63).
  const stored = sql`regexp_replace(coalesce(${serviceCustomers.phone}, ''), '[^0-9]', '', 'g')`;
  const [hit] = await x.select({ id: serviceCustomers.id, name: serviceCustomers.name }).from(serviceCustomers)
    .where(and(
      sql`(case when length(${stored}) >= 10 and (${stored} like '0%' or ${stored} like '63%') then right(${stored}, 10) else ${stored} end) = ${phoneMatchKey(digits)}`,
      opts.activeOnly ? isNull(serviceCustomers.archivedAt) : undefined,
    ))
    .orderBy(asc(serviceCustomers.createdAt)).limit(1);
  return hit ?? null;
}

const digitsOf = (v: string | null | undefined): string => (v ?? "").replace(/\D/g, "");
let cityNames: { at: number; rows: { code: string; name: string }[] } | null = null;

/**
 * A website inquiry becomes a waitlist entry: reuse the customer with the same phone number (however it was typed), find
 * the city in what they wrote, and when none is recognised the entry lands in "Unsorted". Public and unauthenticated, so it
 * is defensive: text is capped, a repeat from the same person within a week adds nothing, and there is a global hourly
 * ceiling. Never throws into the inquiry form.
 */
export async function createWaitlistFromInquiry(input: { name: string; phone?: string | null; pianoContext?: string | null; message?: string | null }): Promise<void> {
  try {
    const name = input.name.trim().slice(0, 120);
    const phone = (input.phone ?? "").trim().slice(0, 40);
    const pianoContext = input.pianoContext?.trim().slice(0, 200) || null;
    const message = input.message?.trim().slice(0, 1_000) || null;
    if (!name) return;
    // Global ceiling: a flood of junk can't bury the real waitlist.
    const [{ n: lastHour }] = await db.select({ n: sql<number>`count(*)::int` }).from(serviceWaitlistEntries)
      .where(and(eq(serviceWaitlistEntries.source, "website"), gte(serviceWaitlistEntries.createdAt, new Date(Date.now() - 3_600_000))));
    if ((lastHour ?? 0) >= 40) return;

    const digits = digitsOf(phone);
    await db.transaction(async (tx) => {
      let customerId: string | undefined;
      if (digits.length >= 7) customerId = (await findCustomerByPhoneDigits(tx, digits))?.id;
      if (customerId) {
        // Same person asking again within a week: the request is already on the list.
        const [recent] = await tx.select({ id: serviceWaitlistEntries.id }).from(serviceWaitlistEntries)
          .where(and(eq(serviceWaitlistEntries.customerId, customerId), eq(serviceWaitlistEntries.source, "website"),
            inArray(serviceWaitlistEntries.status, [...OPEN_WAIT_STATUSES, "not_now"] as WaitStatus[]), gte(serviceWaitlistEntries.createdAt, new Date(Date.now() - 7 * 86_400_000)))).limit(1);
        if (recent) return;
      } else {
        const [created] = await tx.insert(serviceCustomers).values({ name, phone: phone || null, source: "website", tags: ["from:website-inquiry"] }).returning({ id: serviceCustomers.id });
        customerId = created!.id;
      }
      if (!cityNames || Date.now() - cityNames.at > 10 * 60_000) cityNames = { at: Date.now(), rows: await tx.select({ code: phCities.code, name: phCities.name }).from(phCities) };
      const found = findCityInText([message, pianoContext].filter(Boolean).join(" "), cityNames.rows);
      const note = [pianoContext, message].filter(Boolean).join(" — ").slice(0, 1_000) || null;
      await insertEntry(tx, { customerId, cityCode: found?.code ?? null, barangayCode: null, serviceType: "tuning", source: "website", notes: note });
    });
  } catch (err) {
    console.error("createWaitlistFromInquiry failed", err);
  }
}


/* ------------------------------------------------------------------ quick inquiry */

type Outcome<T> = { ok: true; data: T } | { ok: false; error: string };
export type QuickInquiryOutcome = { entryId: string; customerId: string; customerName: string; customerWasNew: boolean; nextFollowUpAt: Date; duplicate: boolean };

/**
 * A validated quick inquiry becomes a waitlist entry (its next follow-up is the normal default, 3 days out).
 * The customer with the same phone digits is reused; otherwise a new one is made. The same request sent twice within
 * two minutes (a double tap) returns the first entry instead of adding a second.
 */
export async function createQuickInquiryEntry(v: QuickInquiryValue, now: Date = new Date()): Promise<Outcome<QuickInquiryOutcome>> {
  const [city] = await db.select({ code: phCities.code }).from(phCities).where(eq(phCities.code, v.cityCode)).limit(1);
  if (!city) return { ok: false, error: "That area isn't in the list. Pick it again." };
  if (v.barangayCode) {
    const [b] = await db.select({ code: phBarangays.code }).from(phBarangays).where(and(eq(phBarangays.code, v.barangayCode), eq(phBarangays.cityCode, v.cityCode))).limit(1);
    if (!b) return { ok: false, error: "That barangay isn't in the chosen area." };
  }
  const notes = composeInquiryNotes(v);
  return db.transaction(async (tx) => {
    // One submit per phone number at a time: two taps can't both find "no customer" and create two.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"quick-inquiry:" + v.phoneKey}))`);
    const match = await findCustomerByPhoneDigits(tx, v.phoneDigits, { activeOnly: true });
    let customerId = match?.id;
    let customerName = match?.name ?? v.name;
    if (customerId) {
      const [dupe] = await tx.select({ id: serviceWaitlistEntries.id, nextFollowUpAt: serviceWaitlistEntries.nextFollowUpAt }).from(serviceWaitlistEntries)
        .where(and(eq(serviceWaitlistEntries.customerId, customerId), eq(serviceWaitlistEntries.notes, notes), gte(serviceWaitlistEntries.createdAt, new Date(now.getTime() - 120_000)))).limit(1);
      if (dupe) return { ok: true as const, data: { entryId: dupe.id, customerId, customerName, customerWasNew: false, nextFollowUpAt: dupe.nextFollowUpAt, duplicate: true } };
    } else {
      const [created] = await tx.insert(serviceCustomers).values({ name: v.name, phone: v.phone, source: customerSourceFor(v.source), tags: ["from:quick-inquiry"] })
        .returning({ id: serviceCustomers.id });
      customerId = created!.id;
    }
    const entryId = await insertEntry(tx, {
      customerId, cityCode: v.cityCode, barangayCode: v.barangayCode, serviceType: "tuning", source: v.source,
      estValueCents: v.estValueCents, notes,
    }, now);
    const [row] = await tx.select({ nextFollowUpAt: serviceWaitlistEntries.nextFollowUpAt }).from(serviceWaitlistEntries).where(eq(serviceWaitlistEntries.id, entryId)).limit(1);
    return { ok: true as const, data: { entryId, customerId, customerName, customerWasNew: !match, nextFollowUpAt: row!.nextFollowUpAt, duplicate: false } };
  });
}

/* ------------------------------------------------------------------ waitlist -> job */

type JobCreator = (input: JobInput) => Promise<{ ok: true; data?: { id: string } } | { ok: false; error: string }>;
type LinkFn = (entryId: string, jobId: string, pianoId: string | null) => Promise<boolean>;

/** The entry may be claimed by a trip "Confirm + time" unless a "Convert to job" is mid-way: a fresh "scheduled" entry with no job yet is held. */
export async function claimEntryForTrip(entryId: string, tripId: string, pianoId: string, now: Date = new Date()): Promise<boolean> {
  const [row] = await db.update(serviceWaitlistEntries)
    .set({ status: "scheduled", tripId, pianoId, updatedAt: now })
    .where(and(eq(serviceWaitlistEntries.id, entryId), or(
      inArray(serviceWaitlistEntries.status, ["waiting", "messaged", "confirmed", "not_now"] as WaitStatus[]),
      and(eq(serviceWaitlistEntries.status, "scheduled"), or(isNotNull(serviceWaitlistEntries.jobId), lt(serviceWaitlistEntries.updatedAt, new Date(now.getTime() - 60_000)))),
    )))
    .returning({ id: serviceWaitlistEntries.id });
  return !!row;
}

/** Links the claimed entry to its job. False when the entry already has a job (someone else got there). */
const linkEntryToJob: LinkFn = async (entryId, jobId, pianoId) => {
  const rows = await db.update(serviceWaitlistEntries)
    .set({ jobId, status: "scheduled", ...(pianoId ? { pianoId } : {}), updatedAt: new Date() })
    .where(and(eq(serviceWaitlistEntries.id, entryId), isNull(serviceWaitlistEntries.jobId)))
    .returning({ id: serviceWaitlistEntries.id });
  return rows.length > 0;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Books a waitlist entry as a job, once. The entry is claimed first (status -> scheduled, only if it is open and has no
 * job), so a double click or a second tab loses the claim and books nothing; a trip "Confirm + time" also respects that claim.
 * If creating the job fails the claim is undone and the entry is exactly as it was. If the job is created but linking fails
 * (retried once) the entry is put back and the message names the job, so nothing is stranded. The job is always for the
 * entry's own customer and is a home-service visit.
 */
export async function convertEntryToJob(entryId: string, values: JobInput, createJobFn: JobCreator, linkFn: LinkFn = linkEntryToJob): Promise<Outcome<{ jobId: string }>> {
  if (!values || typeof values !== "object" || Array.isArray(values)) return { ok: false, error: "The job details are missing. Reopen the form and try again." };
  const [entry] = await db.select().from(serviceWaitlistEntries).where(eq(serviceWaitlistEntries.id, entryId)).limit(1);
  if (!entry) return { ok: false, error: "Entry not found. It may have been removed." };
  if (entry.status === "done") return { ok: false, error: "This one is already done." };
  if (entry.jobId || entry.status === "scheduled") return { ok: false, error: "This client is already booked as a job. Open the job from the customer page." };
  if (values.customerId !== entry.customerId) return { ok: false, error: "This job has to be for the same customer as the waitlist entry. Use New job for someone else." };
  if (values.locationId) {
    const [loc] = UUID.test(String(values.locationId))
      ? await db.select({ id: serviceLocations.id }).from(serviceLocations).where(and(eq(serviceLocations.id, String(values.locationId)), eq(serviceLocations.customerId, entry.customerId))).limit(1)
      : [];
    if (!loc) return { ok: false, error: "That address belongs to a different customer. Pick one of this customer's addresses." };
  }

  const prev = entry.status;
  const [claimed] = await db.update(serviceWaitlistEntries)
    .set({ status: "scheduled", updatedAt: new Date() })
    .where(and(eq(serviceWaitlistEntries.id, entry.id), isNull(serviceWaitlistEntries.jobId), inArray(serviceWaitlistEntries.status, [...CONVERTIBLE_STATUSES])))
    .returning({ id: serviceWaitlistEntries.id });
  if (!claimed) return { ok: false, error: "This client was just booked by someone else. Refresh the list." };

  const undo = () => db.update(serviceWaitlistEntries).set({ status: prev, updatedAt: new Date() })
    .where(and(eq(serviceWaitlistEntries.id, entry.id), isNull(serviceWaitlistEntries.jobId), eq(serviceWaitlistEntries.status, "scheduled")));

  let created: Awaited<ReturnType<JobCreator>>;
  try {
    created = await createJobFn({
      ...values, customerId: entry.customerId, jobType: "service", salePianoId: null, buyCost: 0, prepCost: 0, salePrice: 0, deposit: 0,
      status: values.scheduledStart ? "scheduled" : "lead",
    });
  } catch (err) {
    console.error("convertEntryToJob: createJob threw", err);
    await undo();
    return { ok: false, error: "Couldn't create the job. Nothing was booked; try again." };
  }
  if (!created.ok || !created.data) {
    await undo();
    return { ok: false, error: created.ok ? "Couldn't create the job. Nothing was booked." : created.error };
  }
  const jobId = created.data.id;
  const [j] = await db.select({ n: serviceJobs.jobNumber }).from(serviceJobs).where(eq(serviceJobs.id, jobId)).limit(1).catch(() => []);
  const label = j ? `#${j.n}` : jobId;
  let linked = false;
  for (let attempt = 0; attempt < 2 && !linked; attempt++) {
    try { linked = await linkFn(entry.id, jobId, values.pianoId ?? null); if (!linked) break; }
    catch (err) { console.error("convertEntryToJob: linking failed", err); }
  }
  if (!linked) {
    // Not linked: put the entry back (only if it is still our claim) so it isn't stuck as "Scheduled" with no job.
    await undo().catch(() => undefined);
    return { ok: false, error: `Job ${label} was created but not linked to the waitlist entry. Open the job from the Jobs page.` };
  }
  return { ok: true, data: { jobId } };
}
