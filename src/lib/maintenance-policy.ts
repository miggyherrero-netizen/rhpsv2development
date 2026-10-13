/**
 * Pure policy for maintenance reminders on Manila-local calendar days. No DB, UI or network effects.
 * Phase 1 only PREVIEWS recalls (see docs/ARCHITECTURE.md, "Maintenance (Phase 1)"); nothing here sends anything.
 * Manila has no daylight saving, so a calendar day is always exactly 24 hours and day arithmetic on the day start is safe.
 */
import { startOfManilaDayUTC } from "@/lib/dates";

export const MAINTENANCE_LEAD_DAYS = [30, 7, 0] as const;
const DAY = 86_400_000;
export type MaintenanceStage = "d30" | "d7" | "due";
export type MaintenanceChannel = "manual" | "email" | "sms";

/** 00:00 Manila of the day `instant` falls on (same rule as `startOfManilaDayUTC`, but an invalid date throws instead of returning NaN). */
export function manilaDayStart(instant: Date): Date {
  if (!Number.isFinite(instant.getTime())) throw new Error("Invalid maintenance date");
  return startOfManilaDayUTC(instant);
}
export function dayOffset(day: Date, days: number): Date {
  if (!Number.isInteger(days)) throw new Error("days must be an integer");
  return new Date(manilaDayStart(day).getTime() + days * DAY);
}
/** Whole Manila days from `now` to `due` (negative = the due day has passed). */
export function daysToMaintenance(due: Date, now: Date): number {
  return Math.round((manilaDayStart(due).getTime() - manilaDayStart(now).getTime()) / DAY);
}

/** Where a due date sits today: its day has passed, it is today, or it is still ahead. */
export type MaintenanceTiming = "past" | "today" | "ahead";
export function maintenanceTiming(due: Date, now: Date): MaintenanceTiming {
  const n = daysToMaintenance(due, now);
  return n < 0 ? "past" : n === 0 ? "today" : "ahead";
}

export function plannedStages(due: Date): { stage: MaintenanceStage; scheduledAt: Date }[] {
  return [
    { stage: "d30", scheduledAt: dayOffset(due, -30) },
    { stage: "d7", scheduledAt: dayOffset(due, -7) },
    { stage: "due", scheduledAt: dayOffset(due, 0) },
  ];
}
export type MaintenanceEligibility = {
  customerArchived: boolean;
  recallActive: boolean;
  alreadyBooked: boolean;
  currentDueAt: Date | null;
  cycleDueAt: Date;
  optedOut: boolean;
  emailConsent: boolean;
  smsConsent: boolean;
  email: string | null;
  phone: string | null;
};
/**
 * Why a channel is (not) available, in plain words for the page. `ready` is exactly `canPrepareReminder`: the reason is only an
 * explanation, never a second rule. Absent preferences = no consent recorded; manual review is still allowed.
 */
export type ChannelStatus = { ready: boolean; reason: string | null };
export function channelStatus(input: MaintenanceEligibility, channel: MaintenanceChannel): ChannelStatus {
  const ready = canPrepareReminder(input, channel);
  if (ready) return { ready, reason: null };
  if (input.customerArchived) return { ready, reason: "Customer archived" };
  if (input.optedOut) return { ready, reason: "Opted out" };
  if (input.alreadyBooked) return { ready, reason: "Already booked" };
  if (!input.recallActive) return { ready, reason: "No open recall" };
  if (!input.currentDueAt || manilaDayStart(input.currentDueAt).getTime() !== manilaDayStart(input.cycleDueAt).getTime()) return { ready, reason: "Due date changed" };
  if (channel === "email") return { ready, reason: !input.emailConsent ? "No consent recorded" : "No email on file" };
  return { ready, reason: !input.smsConsent ? "No consent recorded" : "No phone on file" };
}

/**
 * Absent preferences mean no electronic-send consent; manual review is still allowed.
 * Opt-out is deliberately conservative in Phase 1: it blocks EVERY channel, manual included. Phase 2 must separate marketing
 * contact from customer-requested service communications, with separate per-channel preferences and appropriate consent handling,
 * before this is relaxed.
 */
export function canPrepareReminder(input: MaintenanceEligibility, channel: MaintenanceChannel): boolean {
  if (input.customerArchived || !input.recallActive || input.alreadyBooked || input.optedOut) return false;
  if (!input.currentDueAt || manilaDayStart(input.currentDueAt).getTime() !== manilaDayStart(input.cycleDueAt).getTime()) return false;
  if (channel === "email") return input.emailConsent && Boolean(input.email?.trim());
  if (channel === "sms") return input.smsConsent && Boolean(input.phone?.trim());
  return true;
}
export function shouldQueueStage(due: Date, stage: MaintenanceStage, now: Date): boolean {
  const planned = plannedStages(due).find((x) => x.stage === stage);
  // No backdated catch-up sends: stage must be exactly today.
  return Boolean(planned && manilaDayStart(planned.scheduledAt).getTime() === manilaDayStart(now).getTime());
}
