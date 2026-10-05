"use server";

/** Client follow-up reminders — writes (Server Actions). Reads are in service-reminders-data.ts. Every action starts with requireUser(). */
import { revalidatePath } from "next/cache";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { serviceCustomers, serviceReminders } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { cleanNote, isTodayOrLater, parseDayInput, snoozedTo } from "@/lib/service-reminders";

type Result = { ok: true } | { ok: false; error: string };
const touch = () => { revalidatePath("/service", "layout"); };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Plenty for one client; stops a stuck button from creating thousands. */
const MAX_OPEN_PER_CLIENT = 25;

/** `day` is "YYYY-MM-DD" (Manila). The quick buttons in the UI just fill that date in. */
export async function createReminder(input: { customerId: string; day: string; note?: string | null }): Promise<Result> {
  await requireUser();
  if (!UUID_RE.test(String(input?.customerId ?? ""))) return { ok: false, error: "Choose a client first." };
  const due = parseDayInput(input.day);
  if (!due) return { ok: false, error: "Pick a valid date." };
  if (!isTodayOrLater(due, new Date())) return { ok: false, error: "Pick today or a later date." };

  const [customer] = await db.select({ id: serviceCustomers.id }).from(serviceCustomers).where(eq(serviceCustomers.id, input.customerId)).limit(1);
  if (!customer) return { ok: false, error: "That client no longer exists." };

  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(serviceReminders)
    .where(and(eq(serviceReminders.customerId, input.customerId), eq(serviceReminders.status, "open")));
  if (n >= MAX_OPEN_PER_CLIENT) return { ok: false, error: "This client already has many open reminders. Finish some first." };

  await db.insert(serviceReminders).values({ customerId: input.customerId, dueAt: due, note: cleanNote(input.note) });
  touch();
  return { ok: true };
}

/** Marks it done (and keeps the record). Done twice is not an error. */
export async function completeReminder(id: string): Promise<Result> {
  await requireUser();
  if (!UUID_RE.test(String(id ?? ""))) return { ok: false, error: "Reminder not found." };
  const now = new Date();
  await db.update(serviceReminders).set({ status: "done", doneAt: now, updatedAt: now }).where(and(eq(serviceReminders.id, id), eq(serviceReminders.status, "open")));
  touch();
  return { ok: true };
}

/** Moves an open reminder to N days from today (1, 3 or 7 in the UI). */
export async function snoozeReminder(id: string, days: number): Promise<Result> {
  await requireUser();
  if (!UUID_RE.test(String(id ?? ""))) return { ok: false, error: "Reminder not found." };
  const n = Number(days);
  if (!Number.isFinite(n) || n < 1 || n > 365) return { ok: false, error: "Pick how many days to wait." };
  const now = new Date();
  await db.update(serviceReminders).set({ dueAt: snoozedTo(n, now), updatedAt: now }).where(and(eq(serviceReminders.id, id), eq(serviceReminders.status, "open")));
  touch();
  return { ok: true };
}

export async function deleteReminder(id: string): Promise<Result> {
  await requireUser();
  if (!UUID_RE.test(String(id ?? ""))) return { ok: false, error: "Reminder not found." };
  await db.delete(serviceReminders).where(eq(serviceReminders.id, id));
  touch();
  return { ok: true };
}
