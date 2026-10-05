/**
 * Waitlist reads: geography, the grouped waitlist, trip suggestions, follow-ups due today, templates, routes.
 * (Writes live in service-waitlist.ts / service-waitlist-core.ts.)
 */
import { and, asc, eq, gte, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  phBarangays, phCities, phProvinces, phRegions, servicePianos, serviceCustomers, serviceJobs, serviceInvoices,
  serviceMessageTemplates, serviceRoutes, serviceTrips, serviceWaitlistEntries, serviceSettings,
} from "@/db/schema";
import { messengerHandle } from "@/lib/service-flow";
import { titleCaseName } from "@/lib/service-reports";
import { areaName, searchPlaces, suggestForTrip, type LatLng } from "@/lib/service-geo";
import {
  DEFAULT_TEMPLATES, OPEN_WAIT_STATUSES, avgDaysWaiting, isFollowUpDue, jobsPerTrip, messagedToConfirmedRate, type WaitStatus,
} from "@/lib/service-waitlist";
import { sweepNotNow } from "@/server/service-waitlist-core";

/* ------------------------------------------------------------------ geography */

export type GeoCity = {
  code: string; name: string; fullName: string; kind: string;
  provinceCode: string | null; provinceName: string | null; regionCode: string; regionShort: string;
  lat: number | null; lng: number | null;
};

let cityCache: { at: number; rows: GeoCity[] } | null = null;

/** The 455 Mindanao cities/municipalities. Reference data that never changes while the app runs, so it is cached. */
export async function getGeoCities(): Promise<GeoCity[]> {
  if (cityCache && Date.now() - cityCache.at < 10 * 60_000) return cityCache.rows;
  const rows = await db
    .select({
      code: phCities.code, name: phCities.name, fullName: phCities.fullName, kind: phCities.kind, provinceCode: phCities.provinceCode,
      provinceName: phProvinces.name, regionCode: phCities.regionCode, regionShort: phRegions.shortName, lat: phCities.lat, lng: phCities.lng,
    })
    .from(phCities)
    .leftJoin(phProvinces, eq(phProvinces.code, phCities.provinceCode))
    .innerJoin(phRegions, eq(phRegions.code, phCities.regionCode))
    .orderBy(asc(phCities.name));
  cityCache = { at: Date.now(), rows };
  return rows;
}

export async function findCities(query: string, limit = 8): Promise<GeoCity[]> {
  return searchPlaces(await getGeoCities(), query, limit);
}

export async function getGeoCity(code: string | null | undefined): Promise<GeoCity | null> {
  if (!code) return null;
  return (await getGeoCities()).find((c) => c.code === code) ?? null;
}

export async function getBarangaysOf(cityCode: string): Promise<{ code: string; name: string }[]> {
  return db.select({ code: phBarangays.code, name: phBarangays.name }).from(phBarangays).where(eq(phBarangays.cityCode, cityCode)).orderBy(asc(phBarangays.name));
}

/* ------------------------------------------------------------------ settings, templates, routes */

export async function getGeoSettings(ownerId: string): Promise<{ homeBaseCityCode: string; tripRadiusKm: number; tuningIntervalMonths: number }> {
  const [row] = await db.select({
    homeBaseCityCode: serviceSettings.homeBaseCityCode, tripRadiusKm: serviceSettings.tripRadiusKm, tuningIntervalMonths: serviceSettings.defaultTuningIntervalMonths,
  }).from(serviceSettings).where(eq(serviceSettings.ownerId, ownerId)).limit(1);
  return row ?? { homeBaseCityCode: "112402000", tripRadiusKm: 40, tuningIntervalMonths: 6 };
}

export type TemplateRow = { key: string; name: string; body: string };

/** Saved templates; a key that was never saved (or the SQL not run yet) falls back to the built-in text. */
export async function getTemplates(): Promise<TemplateRow[]> {
  const saved = await db.select().from(serviceMessageTemplates).catch(() => []);
  const byKey = new Map(saved.map((t) => [t.key, t]));
  return DEFAULT_TEMPLATES.map((d) => ({ key: d.key, name: byKey.get(d.key)?.name ?? d.name, body: byKey.get(d.key)?.body ?? d.body }));
}

export type RouteRow = { id: string; name: string; cityCodes: string[]; position: number };
export async function getRoutes(): Promise<RouteRow[]> {
  const rows = await db.select().from(serviceRoutes).orderBy(asc(serviceRoutes.position), asc(serviceRoutes.createdAt)).catch(() => []);
  return rows.map((r) => ({ id: r.id, name: r.name, cityCodes: r.cityCodes, position: r.position }));
}

/* ------------------------------------------------------------------ the waitlist */

export type WaitlistItem = {
  id: string;
  customerId: string; customerName: string; customerPhone: string | null; messenger: string | null;
  pianoId: string | null; pianoLabel: string | null; serviceType: string;
  cityCode: string | null; cityName: string | null; provinceCode: string | null; provinceName: string | null;
  regionCode: string | null; regionShort: string | null; barangayName: string | null;
  /** What {area} means in a message: the city (the barangay inside Davao City). */
  areaLabel: string;
  lat: number | null; lng: number | null;
  requestedAt: Date; status: WaitStatus; lastContactedAt: Date | null; nextFollowUpAt: Date; followUpCount: number;
  estValueCents: number; notes: string | null; tripId: string | null; jobId: string | null; source: string;
  /** For {location}: the customer's address in that city, if any. */
  locationLabel: string | null;
};

async function loadItems(where?: ReturnType<typeof and>): Promise<WaitlistItem[]> {
  const rows = await db
    .select({
      e: serviceWaitlistEntries, customerName: serviceCustomers.name, customerPhone: serviceCustomers.phone, customerTags: serviceCustomers.tags,
      piano: { brand: servicePianos.brand, model: servicePianos.model, type: servicePianos.type },
      city: { code: phCities.code, name: phCities.name, provinceCode: phCities.provinceCode, regionCode: phCities.regionCode, lat: phCities.lat, lng: phCities.lng },
      provinceName: phProvinces.name, regionShort: phRegions.shortName, barangayName: phBarangays.name,
    })
    .from(serviceWaitlistEntries)
    .innerJoin(serviceCustomers, eq(serviceCustomers.id, serviceWaitlistEntries.customerId))
    .leftJoin(servicePianos, eq(servicePianos.id, serviceWaitlistEntries.pianoId))
    .leftJoin(phCities, eq(phCities.code, serviceWaitlistEntries.cityCode))
    .leftJoin(phProvinces, eq(phProvinces.code, phCities.provinceCode))
    .leftJoin(phRegions, eq(phRegions.code, phCities.regionCode))
    .leftJoin(phBarangays, eq(phBarangays.code, serviceWaitlistEntries.barangayCode))
    .where(where)
    .orderBy(asc(serviceWaitlistEntries.requestedAt));
  return rows.map((r) => ({
    id: r.e.id, customerId: r.e.customerId, customerName: titleCaseName(r.customerName), customerPhone: r.customerPhone, messenger: messengerHandle(r.customerTags),
    pianoId: r.e.pianoId, pianoLabel: r.piano ? [r.piano.brand, r.piano.model].filter(Boolean).join(" ") || r.piano.type : null, serviceType: r.e.serviceType,
    cityCode: r.city?.code ?? null, cityName: r.city?.name ?? null, provinceCode: r.city?.provinceCode ?? null, provinceName: r.provinceName ?? null,
    regionCode: r.city?.regionCode ?? null, regionShort: r.regionShort ?? null, barangayName: r.barangayName ?? null,
    areaLabel: r.city ? areaName({ code: r.city.code, name: r.city.name }, r.barangayName ? { name: r.barangayName } : null) : "",
    lat: r.city?.lat ?? null, lng: r.city?.lng ?? null,
    requestedAt: r.e.requestedAt, status: r.e.status, lastContactedAt: r.e.lastContactedAt, nextFollowUpAt: r.e.nextFollowUpAt, followUpCount: r.e.followUpCount,
    estValueCents: r.e.estValueCents, notes: r.e.notes, tripId: r.e.tripId, jobId: r.e.jobId, source: r.e.source, locationLabel: null,
  }));
}

export type WaitlistData = {
  items: WaitlistItem[];
  metrics: {
    waiting: number; avgDaysWaiting: number | null;
    messagedToConfirmed: { messaged: number; confirmed: number; ratePct: number | null };
    jobsPerTrip: number | null;
  };
};

/** Everything still alive, plus what finished in the last 60 days (for the "Done" filter). */
export async function getWaitlist(now: Date = new Date()): Promise<WaitlistData> {
  await sweepNotNow(now);
  const items = await loadItems(or(ne(serviceWaitlistEntries.status, "done"), gte(serviceWaitlistEntries.updatedAt, new Date(now.getTime() - 60 * 86_400_000))));
  const tripRows = await db
    .select({ id: serviceTrips.id, jobCount: sql<number>`count(${serviceJobs.id})::int` })
    .from(serviceTrips).leftJoin(serviceJobs, eq(serviceJobs.tripId, serviceTrips.id)).groupBy(serviceTrips.id).catch(() => []);
  return {
    items,
    metrics: {
      waiting: items.filter((i) => (OPEN_WAIT_STATUSES as string[]).includes(i.status)).length,
      avgDaysWaiting: avgDaysWaiting(items, now),
      messagedToConfirmed: messagedToConfirmedRate(items, now, 30),
      jobsPerTrip: jobsPerTrip(tripRows),
    },
  };
}

/** Follow-ups due today (or overdue) for the Today page. */
export async function getFollowUpsDue(now: Date = new Date()): Promise<WaitlistItem[]> {
  await sweepNotNow(now);
  const open = await loadItems(inArray(serviceWaitlistEntries.status, ["waiting", "messaged", "not_now"] as WaitStatus[]));
  return open.filter((i) => isFollowUpDue(i, now)).sort((a, b) => a.nextFollowUpAt.getTime() - b.nextFollowUpAt.getTime());
}

/* ------------------------------------------------------------------ trips */

export type TripPlanData = {
  home: { code: string; name: string; lat: number; lng: number } | null;
  dest: GeoCity | null;
  radiusKm: number;
  candidates: { item: WaitlistItem; routeKm: number | null; destKm: number | null; reason: string }[];
};

/** Waiting clients worth offering for a trip to `destCode`: near the way there, or near the destination. */
export async function getTripPlan(ownerId: string, destCode: string, radiusOverride?: number): Promise<TripPlanData> {
  const [settings, cities] = await Promise.all([getGeoSettings(ownerId), getGeoCities()]);
  const home = cities.find((c) => c.code === settings.homeBaseCityCode) ?? null;
  const dest = cities.find((c) => c.code === destCode) ?? null;
  const radiusKm = Math.max(5, Math.min(300, radiusOverride ?? settings.tripRadiusKm));
  if (!home?.lat || !home.lng || !dest?.lat || !dest.lng) return { home: home && home.lat && home.lng ? { code: home.code, name: home.name, lat: home.lat, lng: home.lng } : null, dest, radiusKm, candidates: [] };
  const waiting = await loadItems(inArray(serviceWaitlistEntries.status, ["waiting", "messaged", "confirmed", "not_now"] as WaitStatus[]));
  const ready = waiting.filter((i) => i.requestedAt.getTime() <= Date.now());
  const point = (i: WaitlistItem): LatLng | null => (i.lat !== null && i.lng !== null ? { lat: i.lat, lng: i.lng } : null);
  const suggested = suggestForTrip({
    home: { lat: home.lat, lng: home.lng }, dest: { lat: dest.lat, lng: dest.lng }, radiusKm,
    candidates: ready.map((i) => ({ item: i, point: point(i), sameCity: i.cityCode === dest.code })),
  });
  return {
    home: { code: home.code, name: home.name, lat: home.lat, lng: home.lng }, dest, radiusKm,
    candidates: suggested.map((s) => ({ item: s.item, routeKm: s.routeKm, destKm: s.destKm, reason: s.reason })),
  };
}

export type TripPrompt = { tripId: string; name: string; cityCode: string | null; cityName: string | null; stillWaiting: number };

/** Planned trips whose jobs are all finished: "N other clients in {area} still waiting — message them?" */
export async function getTripPrompts(): Promise<TripPrompt[]> {
  const trips = await db.select().from(serviceTrips).where(eq(serviceTrips.status, "planned")).catch(() => []);
  if (!trips.length) return [];
  const jobs = await db.select({ tripId: serviceJobs.tripId, status: serviceJobs.status }).from(serviceJobs).where(inArray(serviceJobs.tripId, trips.map((t) => t.id)));
  const out: TripPrompt[] = [];
  for (const t of trips) {
    const mine = jobs.filter((j) => j.tripId === t.id);
    if (!mine.length || !mine.every((j) => ["completed", "invoiced", "paid", "cancelled"].includes(j.status)) || mine.every((j) => j.status === "cancelled")) continue;
    const city = await getGeoCity(t.cityCode);
    const [waiting] = t.cityCode
      ? await db.select({ n: sql<number>`count(*)::int` }).from(serviceWaitlistEntries).where(and(eq(serviceWaitlistEntries.cityCode, t.cityCode), inArray(serviceWaitlistEntries.status, ["waiting", "messaged", "not_now"] as WaitStatus[]), lt(serviceWaitlistEntries.requestedAt, new Date())))
      : [{ n: 0 }];
    out.push({ tripId: t.id, name: t.name, cityCode: t.cityCode, cityName: city?.name ?? null, stillWaiting: waiting?.n ?? 0 });
  }
  return out;
}

/* ------------------------------------------------------------------ finance */

/** Recall revenue (invoiced on jobs that came from recall entries) and the other waitlist numbers, for the Finance range. */
export async function getWaitlistFinance(from: Date | null, to: Date): Promise<{ recallRevenueCents: number; recallJobs: number }> {
  const rows = await db
    .select({ total: sql<number>`coalesce(sum(${serviceInvoices.totalCents}), 0)::int`, jobs: sql<number>`count(distinct ${serviceJobs.id})::int` })
    .from(serviceWaitlistEntries)
    .innerJoin(serviceJobs, eq(serviceJobs.id, serviceWaitlistEntries.jobId))
    .innerJoin(serviceInvoices, eq(serviceInvoices.jobId, serviceJobs.id))
    .where(and(
      eq(serviceWaitlistEntries.source, "recall"), isNull(serviceInvoices.voidedAt),
      sql`(${serviceInvoices.sentAt} is not null or ${serviceInvoices.amountPaidCents} > 0)`,
      from ? gte(serviceInvoices.issueDate, from) : undefined, lt(serviceInvoices.issueDate, to),
    ))
    .catch(() => [{ total: 0, jobs: 0 }]);
  return { recallRevenueCents: rows[0]?.total ?? 0, recallJobs: rows[0]?.jobs ?? 0 };
}

