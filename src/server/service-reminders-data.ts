/** Client follow-up reminders — reads. (Writes: service-reminders.ts.) */
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { serviceCustomers, serviceReminders } from "@/db/schema";
import { titleCaseName } from "@/lib/service-reports";
import { isDueNow, sortByDue } from "@/lib/service-reminders";

export type ReminderRow = {
  id: string;
  customerId: string;
  /** Always filled: every reminder says which client it is for. */
  customerName: string;
  customerPhone: string | null;
  note: string | null;
  dueAt: Date;
  createdAt: Date;
};

const select = {
  id: serviceReminders.id,
  customerId: serviceReminders.customerId,
  customerName: serviceCustomers.name,
  customerPhone: serviceCustomers.phone,
  note: serviceReminders.note,
  dueAt: serviceReminders.dueAt,
  createdAt: serviceReminders.createdAt,
};

const clean = <T extends { customerName: string }>(rows: T[]): T[] => rows.map((r) => ({ ...r, customerName: titleCaseName(r.customerName) }));

/** Every open reminder, most overdue first. */
export async function getOpenReminders(): Promise<ReminderRow[]> {
  const rows = await db
    .select(select)
    .from(serviceReminders)
    .innerJoin(serviceCustomers, eq(serviceCustomers.id, serviceReminders.customerId))
    .where(eq(serviceReminders.status, "open"))
    .orderBy(asc(serviceReminders.dueAt));
  return sortByDue(clean(rows));
}

/** What Today shows: open reminders due today or earlier. */
export async function getRemindersDue(now: Date = new Date()): Promise<ReminderRow[]> {
  return (await getOpenReminders()).filter((r) => isDueNow(r.dueAt, now));
}

/** One client's open reminders (customer page). */
export async function getCustomerReminders(customerId: string): Promise<ReminderRow[]> {
  return (await getOpenReminders()).filter((r) => r.customerId === customerId);
}

/** customer id -> their next open reminder day (the marker on the customers list). */
export async function getNextReminderByCustomer(): Promise<Map<string, Date>> {
  const rows = await db
    .select({ customerId: serviceReminders.customerId, dueAt: serviceReminders.dueAt })
    .from(serviceReminders)
    .where(eq(serviceReminders.status, "open"))
    .orderBy(asc(serviceReminders.dueAt));
  const next = new Map<string, Date>();
  for (const r of rows) if (!next.has(r.customerId)) next.set(r.customerId, r.dueAt);
  return next;
}
