"use server";

import { and, desc, eq, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { gosActivity, gosCustomers, type GosActivity, type GosCustomer } from "@/db/gos-schema";
import { addCustomerSchema, lostSchema, type AddCustomerInput } from "@/lib/gos/customer-input";
import {
  isDuplicateName, normalizeName, searchScore, statusAfterLost, statusAfterMarkReplied,
  statusAfterReopen, statusAfterUndoReplied, type CustomerStatus,
} from "@/lib/gos/customers";
import { loadGosSettings } from "@/server/gos/settings";
import { requireOwnerAction } from "@/server/gos/guard";

type Result<T> = { ok: true; value: T } | { ok: false; error: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NO_ACCESS = (r: { ok: false; error: string }) => r;

async function log(customerId: string, kind: string, text: string, undoData?: unknown) {
  await db.insert(gosActivity).values({ customerId, kind, text, undoData: undoData ?? null });
}

export type DuplicateHit = { id: string; name: string; area: string | null; lastJob: string | null };

/** Adds an inquiry. Returns `duplicate` (nothing saved) when the name matches and the caller has not confirmed. */
export async function addCustomer(
  input: AddCustomerInput,
  confirmNew = false,
): Promise<Result<{ id: string; linked: boolean }> | { ok: false; error: string; duplicate: DuplicateHit }> {
  const auth = await requireOwnerAction();
  if (!auth.ok) return NO_ACCESS(auth);
  const parsed = addCustomerSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Add a name so you can find this customer later." };
  const v = parsed.data;

  const all = await db.select().from(gosCustomers);
  const match = all.find((c) => isDuplicateName(c.name, v.name));
  if (match && !confirmNew) {
    return {
      ok: false, error: "duplicate",
      duplicate: { id: match.id, name: match.name, area: match.area, lastJob: null },
    };
  }
  if (match && confirmNew && v.cameFrom === "Repeat customer") {
    // AC-2.12: repeat inquiry goes back to the inquiry stage on the existing record.
    await db.update(gosCustomers).set({ status: "New", inquiryAt: new Date(), repliedAt: null, updatedAt: new Date() })
      .where(eq(gosCustomers.id, match.id));
    await log(match.id, "inquiry", "Repeat inquiry added");
    return { ok: true, value: { id: match.id, linked: true } };
  }
  const [row] = await db.insert(gosCustomers).values({
    name: v.name, phone: v.phone || null, area: v.area || null, cameFrom: v.cameFrom,
    adKind: v.cameFrom === "Messenger" ? v.adChoice : "none",
    adId: v.cameFrom === "Messenger" && v.adChoice === "ad" ? v.adId : null,
    note: v.note,
  }).returning();
  await log(row.id, "inquiry", `Inquiry added (${v.cameFrom})`);
  return { ok: true, value: { id: row.id, linked: false } };
}

async function getRow(id: string): Promise<GosCustomer | null> {
  if (!UUID.test(id)) return null;
  const [row] = await db.select().from(gosCustomers).where(eq(gosCustomers.id, id)).limit(1);
  return row ?? null;
}

async function setStatus(id: string, to: CustomerStatus, extra: Partial<GosCustomer> = {}) {
  await db.update(gosCustomers).set({ status: to, updatedAt: new Date(), ...extra }).where(eq(gosCustomers.id, id));
}

export async function markReplied(id: string): Promise<Result<{ activityId: string }>> {
  const auth = await requireOwnerAction();
  if (!auth.ok) return NO_ACCESS(auth);
  const c = await getRow(id);
  if (!c) return { ok: false, error: "Customer not found." };
  const next = statusAfterMarkReplied(c.status as CustomerStatus);
  if (!next) return { ok: false, error: "Already replied." };
  await setStatus(id, next, { repliedAt: new Date() });
  const [a] = await db.insert(gosActivity).values({
    customerId: id, kind: "replied", text: "Marked replied", undoData: { status: c.status, repliedAt: null },
  }).returning();
  return { ok: true, value: { activityId: a.id } };
}

export async function undoReplied(id: string): Promise<Result<null>> {
  const auth = await requireOwnerAction();
  if (!auth.ok) return NO_ACCESS(auth);
  const c = await getRow(id);
  if (!c) return { ok: false, error: "Customer not found." };
  const next = statusAfterUndoReplied(c.status as CustomerStatus);
  if (!next) return { ok: false, error: "Nothing to undo." };
  await setStatus(id, next, { repliedAt: null });
  await log(id, "undo-replied", "Undo replied");
  return { ok: true, value: null };
}

export async function markLost(id: string, reason: string): Promise<Result<{ activityId: string }>> {
  const auth = await requireOwnerAction();
  if (!auth.ok) return NO_ACCESS(auth);
  const parsed = lostSchema.safeParse({ reason });
  if (!parsed.success) return { ok: false, error: "Pick a reason." };
  const c = await getRow(id);
  if (!c) return { ok: false, error: "Customer not found." };
  if (!statusAfterLost(c.status as CustomerStatus)) return { ok: false, error: "Already lost." };
  await setStatus(id, "Lost", { statusBeforeLost: c.status, lostReason: parsed.data.reason });
  const [a] = await db.insert(gosActivity).values({
    customerId: id, kind: "lost", text: `Lost: ${parsed.data.reason}`,
    undoData: { status: c.status, statusBeforeLost: c.statusBeforeLost, lostReason: c.lostReason },
  }).returning();
  return { ok: true, value: { activityId: a.id } };
}

export async function reopenCustomer(id: string): Promise<Result<null>> {
  const auth = await requireOwnerAction();
  if (!auth.ok) return NO_ACCESS(auth);
  const c = await getRow(id);
  if (!c) return { ok: false, error: "Customer not found." };
  const next = statusAfterReopen(c.status as CustomerStatus, c.statusBeforeLost as CustomerStatus | null);
  if (!next) return { ok: false, error: "Not lost." };
  await setStatus(id, next, { lostReason: null });
  await log(id, "reopen", `Reopened (back to ${next})`);
  return { ok: true, value: null };
}

/** Undo for a logged status change (works for 10 s toast and from the Activity log). */
export async function undoActivity(activityId: string): Promise<Result<null>> {
  const auth = await requireOwnerAction();
  if (!auth.ok) return NO_ACCESS(auth);
  if (!UUID.test(activityId)) return { ok: false, error: "Not found." };
  const [a] = await db.select().from(gosActivity).where(eq(gosActivity.id, activityId)).limit(1);
  if (!a || a.undoneAt || !a.undoData) return { ok: false, error: "Nothing to undo." };
  const u = a.undoData as { status: CustomerStatus; statusBeforeLost?: string | null; lostReason?: string | null; repliedAt?: null };
  await db.update(gosCustomers).set({
    status: u.status, statusBeforeLost: u.statusBeforeLost ?? null, lostReason: u.lostReason ?? null,
    repliedAt: a.kind === "replied" ? null : undefined, updatedAt: new Date(),
  }).where(eq(gosCustomers.id, a.customerId));
  await db.update(gosActivity).set({ undoneAt: new Date() }).where(eq(gosActivity.id, a.id));
  await log(a.customerId, "undo", `Undid: ${a.text}`);
  return { ok: true, value: null };
}

export async function logSent(id: string, what: string): Promise<Result<null>> {
  const auth = await requireOwnerAction();
  if (!auth.ok) return NO_ACCESS(auth);
  if (!(await getRow(id))) return { ok: false, error: "Customer not found." };
  await log(id, "sent", `${what.slice(0, 80)} sent`);
  return { ok: true, value: null };
}

export async function markNotDuplicate(id: string): Promise<Result<null>> {
  const auth = await requireOwnerAction();
  if (!auth.ok) return NO_ACCESS(auth);
  if (!(await getRow(id))) return { ok: false, error: "Customer not found." };
  await db.update(gosCustomers).set({ notDuplicate: true }).where(eq(gosCustomers.id, id));
  return { ok: true, value: null };
}

/** AC-13.6: no payments exist yet in Step B, so delete is allowed; Step C adds the payments check. */
export async function deleteCustomer(id: string): Promise<Result<null>> {
  const auth = await requireOwnerAction();
  if (!auth.ok) return NO_ACCESS(auth);
  if (!(await getRow(id))) return { ok: false, error: "Customer not found." };
  await db.delete(gosCustomers).where(eq(gosCustomers.id, id));
  return { ok: true, value: null };
}

/** AC-13.5: keeps the older record, moves everything from the other onto it. */
export async function mergeCustomers(aId: string, bId: string): Promise<Result<{ keepId: string; joined: number }>> {
  const auth = await requireOwnerAction();
  if (!auth.ok) return NO_ACCESS(auth);
  const [a, b] = await Promise.all([getRow(aId), getRow(bId)]);
  if (!a || !b || a.id === b.id) return { ok: false, error: "Pick two different customers." };
  const [keep, join] = a.createdAt <= b.createdAt ? [a, b] : [b, a];
  const moved = await db.update(gosActivity).set({ customerId: keep.id }).where(eq(gosActivity.customerId, join.id)).returning({ id: gosActivity.id });
  await db.update(gosCustomers).set({
    phone: keep.phone ?? join.phone, area: keep.area ?? join.area,
    note: [keep.note, join.note].filter(Boolean).join("\n").slice(0, 500), updatedAt: new Date(),
  }).where(eq(gosCustomers.id, keep.id));
  await db.delete(gosCustomers).where(eq(gosCustomers.id, join.id));
  await log(keep.id, "merge", `Merged with ${join.name}`);
  return { ok: true, value: { keepId: keep.id, joined: moved.length } };
}

export type CustomerRow = GosCustomer & { possibleDuplicate: boolean };

function withDuplicates(rows: GosCustomer[]): CustomerRow[] {
  const nameCount = new Map<string, number>();
  const phoneCount = new Map<string, number>();
  for (const r of rows) {
    nameCount.set(normalizeName(r.name), (nameCount.get(normalizeName(r.name)) ?? 0) + 1);
    if (r.phone) phoneCount.set(r.phone.replace(/\D/g, ""), (phoneCount.get(r.phone.replace(/\D/g, "")) ?? 0) + 1);
  }
  return rows.map((r) => ({
    ...r,
    possibleDuplicate: !r.notDuplicate &&
      ((nameCount.get(normalizeName(r.name)) ?? 0) > 1 || (!!r.phone && (phoneCount.get(r.phone.replace(/\D/g, "")) ?? 0) > 1)),
  }));
}

export async function listCustomers(): Promise<Result<CustomerRow[]>> {
  const auth = await requireOwnerAction();
  if (!auth.ok) return NO_ACCESS(auth);
  const rows = await db.select().from(gosCustomers).orderBy(desc(gosCustomers.updatedAt));
  return { ok: true, value: withDuplicates(rows) };
}

export async function getCustomer(id: string): Promise<Result<{ customer: CustomerRow; activity: GosActivity[]; adName: string | null }>> {
  const auth = await requireOwnerAction();
  if (!auth.ok) return NO_ACCESS(auth);
  const c = await getRow(id);
  if (!c) return { ok: false, error: "Customer not found." };
  const all = await db.select().from(gosCustomers);
  const customer = withDuplicates(all).find((r) => r.id === id)!;
  const activity = await db.select().from(gosActivity).where(eq(gosActivity.customerId, id)).orderBy(desc(gosActivity.createdAt)).limit(200);
  let adName: string | null = null;
  if (c.adId) {
    const r = await db.execute(sql`select name from gos_ads where id = ${c.adId}`);
    adName = (r.rows[0] as { name?: string } | undefined)?.name ?? null;
  }
  return { ok: true, value: { customer, activity, adName } };
}

/** Search by name, area, phone or note; typo-tolerant. Empty text returns nothing (the page shows recent). */
export async function searchCustomers(text: string): Promise<Result<CustomerRow[]>> {
  const auth = await requireOwnerAction();
  if (!auth.ok) return NO_ACCESS(auth);
  const q = text.trim().slice(0, 60);
  if (!q) return { ok: true, value: [] };
  const rows = withDuplicates(await db.select().from(gosCustomers));
  const scored = rows
    .map((r) => ({ r, s: Math.max(searchScore(q, r.name), searchScore(q, r.area ?? ""), searchScore(q, r.phone ?? ""), searchScore(q, r.note) / 2) }))
    .filter((x) => x.s > 0)
    .sort((x, y) => y.s - x.s);
  return { ok: true, value: scored.slice(0, 50).map((x) => x.r) };
}

/** Today: customers still waiting for a reply, oldest first. */
export async function listWaiting(): Promise<Result<{ rows: GosCustomer[]; noReplyMinutes: number }>> {
  const auth = await requireOwnerAction();
  if (!auth.ok) return NO_ACCESS(auth);
  const settings = await loadGosSettings();
  if (!settings.ok) return settings;
  const rows = await db.select().from(gosCustomers).where(and(eq(gosCustomers.status, "New"), ne(gosCustomers.status, "Lost"))).orderBy(gosCustomers.inquiryAt);
  return { ok: true, value: { rows, noReplyMinutes: settings.value.reminders.noReplyMinutes } };
}
