"use server";

/**
 * "Create job / invoice for a customer who isn't saved yet": thin Server Actions over `withNewCustomer`
 * (service-new-customer.ts). Each one calls `requireUser()` before anything else. The existing actions
 * (`createJob`, `createInvoice`) are unchanged and still used for customers picked from the list.
 * The waitlist version lives next to `addWaitlistEntry` in service-waitlist.ts.
 */

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { canCreateNew } from "@/lib/service-customer-match";
import { isBatchCustomer, titleCaseName } from "@/lib/service-reports";
import { createInvoice, createJob, type JobInput } from "@/server/service";
import { withNewCustomer, type NewCustomerInput, type NewPianoInput } from "@/server/service-new-customer";

export type NewCustomerOutcome<T> =
  | { ok: true; data: T & { customerId: string; customerName: string } }
  | { ok: false; error: string; duplicateOf?: { id: string; name: string } };

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const BAD_NAME: NewCustomerOutcome<never> = { ok: false, error: "Type the customer's name — it needs at least one letter." };

/**
 * New job for a customer typed in the form. A regular home-service visit gets the customer's first piano (brand "N/A" when none was typed,
 * shown as "Needs piano info"), created in the same call (customer -> piano -> job) and linked to the job. A piano sale and a
 * trip / batch name get no piano. If the job is refused, the customer and piano are removed again.
 */
export async function createJobWithNewCustomer(
  newCustomer: NewCustomerInput,
  piano: NewPianoInput | null,
  values: Omit<JobInput, "customerId">,
): Promise<NewCustomerOutcome<{ id: string }>> {
  await requireUser();
  if (!isObj(newCustomer) || !canCreateNew(newCustomer.name)) return BAD_NAME;
  if (!isObj(values)) return { ok: false, error: "The job details are missing. Reopen the form and try again." };
  const sale = values.jobType === "sale";
  // A trip / batch placeholder is not one client's piano, and a piano sale has none: no piano is created for them.
  const batch = isBatchCustomer([], titleCaseName(newCustomer.name));
  const res = await withNewCustomer(newCustomer, sale || batch ? null : isObj(piano) ? piano : { brand: "" }, async (ctx) => {
    const job = await createJob({ ...values, customerId: ctx.customerId, locationId: null, pianoId: ctx.pianoId });
    return job.ok ? { ok: true as const, data: { id: job.data!.id } } : { ok: false as const, error: job.error };
  });
  if (!res.ok) return res;
  revalidatePath("/service", "layout");
  return { ok: true, data: { id: res.data!.id, customerId: res.customerId, customerName: res.customerName } };
}

/** New invoice for a customer typed in the form (a brand-new customer has no jobs, so it is never linked to one). */
export async function createInvoiceWithNewCustomer(
  newCustomer: NewCustomerInput,
  input: Omit<Parameters<typeof createInvoice>[0], "customerId" | "jobId">,
): Promise<NewCustomerOutcome<{ id: string }>> {
  await requireUser();
  if (!isObj(newCustomer) || !canCreateNew(newCustomer.name)) return BAD_NAME;
  if (!isObj(input)) return { ok: false, error: "The invoice details are missing. Reopen the form and try again." };
  const res = await withNewCustomer(newCustomer, null, async (ctx) => {
    const inv = await createInvoice({ ...input, customerId: ctx.customerId, jobId: null });
    return inv.ok ? { ok: true as const, data: { id: inv.data!.id } } : { ok: false as const, error: inv.error };
  });
  if (!res.ok) return res;
  revalidatePath("/service", "layout");
  return { ok: true, data: { id: res.data!.id, customerId: res.customerId, customerName: res.customerName } };
}
