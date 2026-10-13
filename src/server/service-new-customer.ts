/**
 * "Type a name, it becomes a new contact when you save": the server half. Plain module (NOT "use server"), so nothing
 * here is callable from the browser. The thin Server Actions that expose it start with `requireUser()` and live in
 * `service-new-customer-actions.ts` (job, invoice) and `service-waitlist.ts` (waitlist entry).
 *
 * Two ways to keep the pair "new customer + the thing being saved" all-or-nothing (createJob and createInvoice each write
 * their rows in ONE transaction, so a refused or failed save leaves no job / invoice; only the customer and piano remain to undo):
 *  - `withNewCustomerTx`: customer, optional piano and the saved record are written in ONE database transaction
 *    (used when the record can be inserted with a transaction handle: the waitlist entry).
 *  - `withNewCustomer`: the customer (and piano) are committed first, then the existing action runs; if it reports an
 *    error or throws, the customer and piano THIS call made are removed again, but only when nothing else points at the
 *    customer (compensating cleanup; used for createJob and createInvoice). A crash between the two steps can leave an
 *    orphan customer: it carries no marker.
 * Both take the duplicate rule from `normalizeName`, under an advisory lock on the normalised name, so two parallel
 * saves of the same new name produce one customer.
 */

import { eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { serviceCustomers, servicePianos } from "@/db/schema";
import { CUSTOMER_NAME_MAX, canCreateNew, normalizeName } from "@/lib/service-customer-match";
import { PIANO_PLACEHOLDER } from "@/lib/service-piano-info";
import { PIANO_TYPES, oneOf, str } from "@/lib/service";
import { titleCaseName } from "@/lib/service-reports";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Exec = typeof db | Tx;

export type NewCustomerInput = {
  name: string;
  phone?: string | null;
  /** The owner chose "Create as new anyway" after being told the name already exists. */
  allowDuplicate?: boolean;
};
export type NewPianoInput = { brand: string; model?: string | null; type?: string | null };

export type NewCustomerFailure = { ok: false; error: string; duplicateOf?: { id: string; name: string } };
export type NewCustomerCtx = { customerId: string; customerName: string; pianoId: string | null };
type CreatedOk = { ok: true } & NewCustomerCtx;

/** What the saved record's own action reports. */
export type StepResult<T> = { ok: true; data?: T } | { ok: false; error: string };

const GENERIC = "Couldn't save. Nothing was added — try again.";

/** Thrown inside a transaction to roll it back with a clean message. */
class Rollback extends Error {
  constructor(public readonly failure: NewCustomerFailure) { super(failure.error); }
}

/** An active (not archived) saved customer whose name is the same once case, spaces, accents and punctuation are ignored. */
export async function findExactCustomer(x: Exec, name: string): Promise<{ id: string; name: string } | null> {
  const want = normalizeName(name);
  if (!want) return null;
  const rows = await x.select({ id: serviceCustomers.id, name: serviceCustomers.name }).from(serviceCustomers).where(isNull(serviceCustomers.archivedAt));
  return rows.find((r) => normalizeName(r.name) === want) ?? null;
}

/**
 * Inside the caller's transaction: lock on the name, refuse an exact duplicate (unless allowed), then insert the
 * customer — with the same field rules as `createCustomer` (title case, source "referral", phone optional) — and
 * their first piano when the caller passes one (same rules as `createPiano`; brand "N/A" when none was typed).
 */
export async function insertNewCustomer(tx: Tx, input: NewCustomerInput, piano?: NewPianoInput | null): Promise<CreatedOk | NewCustomerFailure> {
  if (!input || typeof input !== "object" || !canCreateNew(input.name)) return { ok: false, error: "Type the customer's name — it needs at least one letter." };
  const name = titleCaseName(str(input.name, CUSTOMER_NAME_MAX));
  if (!name) return { ok: false, error: "Type the customer's name — it needs at least one letter." };
  // A piano is created when the caller passes one (even with an empty brand: then it carries the "N/A" placeholder, "Needs piano info").
  // null / undefined = no piano (piano sale, trip / batch name, invoice-only customer).
  const pianoBrand = piano ? str(piano.brand, 120) ?? PIANO_PLACEHOLDER : null;

  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"new-customer:" + normalizeName(name)}))`);
  if (input.allowDuplicate !== true) {
    const hit = await findExactCustomer(tx, name);
    if (hit) return { ok: false, error: `${hit.name} already exists. Pick them from the list.`, duplicateOf: hit };
  }
  const [row] = await tx.insert(serviceCustomers).values({ name, phone: str(input.phone, 60), source: "referral", tags: [] }).returning({ id: serviceCustomers.id });
  let pianoId: string | null = null;
  if (piano && pianoBrand) {
    const [p] = await tx.insert(servicePianos).values({
      customerId: row!.id, brand: pianoBrand, model: str(piano.model, 120), type: oneOf(piano.type, PIANO_TYPES, "Upright"),
      tuningIntervalMonths: 6, nextServiceDueAt: null,
    }).returning({ id: servicePianos.id });
    pianoId = p!.id;
  }
  return { ok: true, customerId: row!.id, customerName: name, pianoId };
}

/**
 * Undo the customer (and the piano) THIS call made, after the save step failed. It deletes nothing else, ever: no job,
 * invoice, payment, entry, reminder or address is removed (so no invoice rule is bypassed and nothing relies on a cascade).
 * The customer row is locked first (concurrent inserts of rows that point at it wait), then, if anything other than our own
 * piano points at it, the customer is left in place. Returns whether it was removed.
 */
export async function removeJustCreatedCustomer(customerId: string, pianoId: string | null): Promise<boolean> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select 1 from service_customers where id = ${customerId} for update`);
    const q = await tx.execute(sql`
      select (
        exists(select 1 from service_jobs where customer_id = ${customerId})
        or exists(select 1 from service_invoices where customer_id = ${customerId})
        or exists(select 1 from service_waitlist_entries where customer_id = ${customerId})
        or exists(select 1 from service_reminders where customer_id = ${customerId})
        or exists(select 1 from service_locations where customer_id = ${customerId})
        or exists(select 1 from service_pianos where customer_id = ${customerId} and (${pianoId}::uuid is null or id <> ${pianoId}::uuid))
      ) as in_use`);
    if ((q.rows[0] as { in_use: boolean } | undefined)?.in_use) return false;
    if (pianoId) await tx.delete(servicePianos).where(eq(servicePianos.id, pianoId));
    await tx.delete(serviceCustomers).where(eq(serviceCustomers.id, customerId));
    return true;
  });
}

/**
 * Create the customer (and piano), run `fn`, and undo the customer if `fn` fails or throws. Returns the customer and
 * whatever `fn` returned, or the error to show (the typed form data is kept by the caller).
 */
export async function withNewCustomer<T>(
  input: NewCustomerInput,
  piano: NewPianoInput | null | undefined,
  fn: (ctx: NewCustomerCtx) => Promise<StepResult<T>>,
): Promise<{ ok: true; customerId: string; customerName: string; data?: T } | NewCustomerFailure> {
  let created: CreatedOk | NewCustomerFailure;
  try {
    created = await db.transaction((tx) => insertNewCustomer(tx, input, piano));
  } catch (err) {
    console.error("withNewCustomer: creating the customer failed", err);
    return { ok: false, error: GENERIC };
  }
  if (!created.ok) return created;
  const ctx: NewCustomerCtx = { customerId: created.customerId, customerName: created.customerName, pianoId: created.pianoId };
  let message: string | null = null;
  try {
    const res = await fn(ctx);
    if (res.ok) return { ok: true, customerId: ctx.customerId, customerName: ctx.customerName, data: res.data };
    message = res.error;
  } catch (err) {
    console.error("withNewCustomer: the step after creating the customer threw", err);
    message = GENERIC;
  }
  const kept = `${message} The new customer “${ctx.customerName}” was saved on its own — check the Customers list.`;
  try {
    return { ok: false, error: (await removeJustCreatedCustomer(ctx.customerId, ctx.pianoId)) ? message : kept };
  } catch (err) {
    console.error("withNewCustomer: cleanup failed; customer left in place", ctx.customerId, err);
    return { ok: false, error: kept };
  }
}

/** Same contract, but everything (customer, piano, `fn`'s writes) is one transaction: any failure leaves nothing behind. */
export async function withNewCustomerTx<T>(
  input: NewCustomerInput,
  piano: NewPianoInput | null | undefined,
  fn: (ctx: NewCustomerCtx, tx: Tx) => Promise<StepResult<T>>,
): Promise<{ ok: true; customerId: string; customerName: string; data?: T } | NewCustomerFailure> {
  try {
    return await db.transaction(async (tx) => {
      const created = await insertNewCustomer(tx, input, piano);
      if (!created.ok) throw new Rollback(created);
      const ctx: NewCustomerCtx = { customerId: created.customerId, customerName: created.customerName, pianoId: created.pianoId };
      const res = await fn(ctx, tx);
      if (!res.ok) throw new Rollback({ ok: false, error: res.error });
      return { ok: true as const, customerId: ctx.customerId, customerName: ctx.customerName, data: res.data };
    });
  } catch (err) {
    if (err instanceof Rollback) return err.failure;
    console.error("withNewCustomerTx failed", err);
    return { ok: false, error: GENERIC };
  }
}
