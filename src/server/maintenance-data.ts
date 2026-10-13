/**
 * Maintenance Phase 1 — READ-ONLY. Plain module (not "use server"): the page calls it after `requireUser()`.
 * It adds NO recall detection of its own: the pianos come from `getRecalls` (the same source as Today's recalls and the
 * customers page). On top of that it only reads: the customer's contact, the open recall entry (for the link and the
 * "booked" check) and the consent row, then lets the pure policy say which reminder stages / channels would apply.
 * Nothing is written, sent or scheduled from here (guarded by tests/service-maintenance-readonly.ts).
 */
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { serviceCustomers, serviceNotificationPreferences, servicePianos, serviceWaitlistEntries } from "@/db/schema";
import { getRecalls } from "@/server/service-data";
import { isPianoInfoMissing } from "@/lib/service-piano-info";
import {
  channelStatus, daysToMaintenance, maintenanceTiming, plannedStages,
  type ChannelStatus, type MaintenanceChannel, type MaintenanceStage, type MaintenanceTiming,
} from "@/lib/maintenance-policy";

export const MAINTENANCE_WINDOW_DAYS = 30;
export const MAINTENANCE_ROW_LIMIT = 200;

export type MaintenanceRow = {
  pianoId: string;
  customerId: string;
  customerName: string;
  pianoLabel: string;
  pianoInfoMissing: boolean;
  /** Real brand / model, for the shared "Needs piano info" badge. */
  pianoBrandModel: { brand: string; model: string | null };
  dueAt: Date;
  /** Whole Manila days to the due day (negative = the date has passed). Shown neutrally, never in red. */
  daysToDue: number;
  timing: MaintenanceTiming;
  /** The open recall entry on the Waitlist (null = the piano is due but has no recall entry). */
  entryId: string | null;
  entryStatus: string | null;
  booked: boolean;
  /** "none" = no consent row at all; "recorded" = a row exists (consents can still be false); "opted-out" = opted out. */
  consent: "none" | "recorded" | "opted-out";
  stages: { stage: MaintenanceStage; scheduledAt: Date; timing: MaintenanceTiming }[];
  channels: Record<MaintenanceChannel, ChannelStatus>;
};

export type MaintenanceOverview = {
  rows: MaintenanceRow[];
  asOf: Date;
  /** Pianos whose due day has passed / is today or ahead (within the window). */
  datePassed: number;
  upcoming: number;
  /** Rows where at least one e-mail / SMS channel would be allowed (explicit consent + address on file). */
  electronicReady: number;
  /** False when the consent table does not exist yet (file 12 not pasted): everything reads as "No consent recorded". */
  preferencesAvailable: boolean;
  /** True when more rows exist than the page shows. */
  truncated: boolean;
};

const OPEN = ["waiting", "messaged", "confirmed"] as const;

/** Postgres "undefined_table". drizzle wraps driver errors, so the code can be on the error or on its cause. */
export function isUndefinedTable(err: unknown): boolean {
  const e = err as { code?: unknown; cause?: { code?: unknown } } | null;
  return e?.code === "42P01" || e?.cause?.code === "42P01";
}

export async function getMaintenanceOverview(now: Date = new Date()): Promise<MaintenanceOverview> {
  const all = await getRecalls(now, MAINTENANCE_WINDOW_DAYS);
  const empty = { rows: [], asOf: now, datePassed: 0, upcoming: 0, electronicReady: 0, preferencesAvailable: true, truncated: false };
  if (all.length === 0) return empty;

  // Archived customers are dropped BEFORE the row limit, so "truncated" and the first 200 only count real rows.
  const customers = await db.select({ id: serviceCustomers.id, email: serviceCustomers.email, phone: serviceCustomers.phone, archivedAt: serviceCustomers.archivedAt })
    .from(serviceCustomers).where(inArray(serviceCustomers.id, [...new Set(all.map((r) => r.customerId))]));
  const active = new Set(customers.filter((c) => !c.archivedAt).map((c) => c.id));
  const live = all.filter((r) => active.has(r.customerId));
  const recalls = live.slice(0, MAINTENANCE_ROW_LIMIT);
  if (recalls.length === 0) return empty;
  const pianoIds = recalls.map((r) => r.pianoId);
  const customerIds = [...new Set(recalls.map((r) => r.customerId))];

  const [pianos, entries] = await Promise.all([
    db.select({ id: servicePianos.id, brand: servicePianos.brand, model: servicePianos.model })
      .from(servicePianos).where(inArray(servicePianos.id, pianoIds)),
    db.select({ id: serviceWaitlistEntries.id, pianoId: serviceWaitlistEntries.pianoId, status: serviceWaitlistEntries.status, jobId: serviceWaitlistEntries.jobId })
      .from(serviceWaitlistEntries)
      .where(and(eq(serviceWaitlistEntries.source, "recall"), inArray(serviceWaitlistEntries.pianoId, pianoIds), inArray(serviceWaitlistEntries.status, [...OPEN, "scheduled"]))),
  ]);

  // Consent: a missing row means NO consent. If the table itself is missing (SQL not pasted yet) the page still works.
  let preferencesAvailable = true;
  let prefs: { customerId: string; emailConsent: boolean; smsConsent: boolean; optedOutAt: Date | null }[] = [];
  try {
    prefs = await db.select({
      customerId: serviceNotificationPreferences.customerId, emailConsent: serviceNotificationPreferences.emailConsent,
      smsConsent: serviceNotificationPreferences.smsConsent, optedOutAt: serviceNotificationPreferences.optedOutAt,
    }).from(serviceNotificationPreferences).where(inArray(serviceNotificationPreferences.customerId, customerIds));
  } catch (err) {
    if (!isUndefinedTable(err)) throw err; // only "table missing" is expected; a real database problem must surface
    preferencesAvailable = false;
    console.error("maintenance: consent table unavailable, treating everyone as 'no consent recorded'", err);
  }

  const customerOf = new Map(customers.map((c) => [c.id, c]));
  const pianoOf = new Map(pianos.map((p) => [p.id, p]));
  const prefOf = new Map(prefs.map((p) => [p.customerId, p]));
  const entryOf = new Map<string, (typeof entries)[number]>();
  // One open recall per piano; if there were several, prefer the one that is still open over a booked one.
  for (const e of entries) {
    const cur = e.pianoId ? entryOf.get(e.pianoId) : undefined;
    if (e.pianoId && (!cur || (cur.jobId && !e.jobId))) entryOf.set(e.pianoId, e);
  }

  const rows: MaintenanceRow[] = [];
  for (const r of recalls) {
    const c = customerOf.get(r.customerId);
    if (!c) continue;
    const piano = pianoOf.get(r.pianoId);
    const entry = entryOf.get(r.pianoId) ?? null;
    const pref = prefOf.get(r.customerId);
    const booked = !!entry && (entry.status === "scheduled" || !!entry.jobId);
    const input = {
      customerArchived: false,
      recallActive: !!entry && !booked,
      alreadyBooked: booked,
      // Phase 1 has no queue row, so the "cycle" is simply today's due date and the policy's "Due date changed" check cannot fire.
      // Phase 2 must pass the due date stored on the queue row as `cycleDueAt` so a moved recall is caught.
      currentDueAt: r.nextServiceDueAt,
      cycleDueAt: r.nextServiceDueAt,
      optedOut: !!pref?.optedOutAt,
      emailConsent: !!pref?.emailConsent,
      smsConsent: !!pref?.smsConsent,
      email: c.email,
      phone: c.phone,
    };
    rows.push({
      pianoId: r.pianoId, customerId: r.customerId, customerName: r.customerName, pianoLabel: r.pianoLabel,
      pianoInfoMissing: piano ? isPianoInfoMissing(piano) : false,
      pianoBrandModel: { brand: piano?.brand ?? "", model: piano?.model ?? null },
      dueAt: r.nextServiceDueAt, daysToDue: daysToMaintenance(r.nextServiceDueAt, now), timing: maintenanceTiming(r.nextServiceDueAt, now),
      entryId: entry?.id ?? null, entryStatus: entry?.status ?? null, booked,
      consent: pref?.optedOutAt ? "opted-out" : pref ? "recorded" : "none",
      stages: plannedStages(r.nextServiceDueAt).map((s) => ({ ...s, timing: maintenanceTiming(s.scheduledAt, now) })),
      channels: { manual: channelStatus(input, "manual"), email: channelStatus(input, "email"), sms: channelStatus(input, "sms") },
    });
  }

  return {
    rows, asOf: now,
    datePassed: rows.filter((r) => r.timing === "past").length,
    upcoming: rows.filter((r) => r.timing !== "past").length,
    electronicReady: rows.filter((r) => r.channels.email.ready || r.channels.sms.ready).length,
    preferencesAvailable,
    truncated: live.length > MAINTENANCE_ROW_LIMIT,
  };
}
