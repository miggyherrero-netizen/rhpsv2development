import { requireUser } from "@/lib/auth";
import { getCatalog, getInvoices, getJobs, getCustomerOptions, getReceivablesSnapshot, getServiceSettings } from "@/server/service-data";
import { jobCode } from "@/lib/service";
import InvoicesClient from "@/components/service-invoices";

export const dynamic = "force-dynamic";

export default async function ServiceInvoicesPage({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  const user = await requireUser();
  const { filter } = await searchParams;
  const [settings] = await Promise.all([getServiceSettings(user.id)]);
  // The list is paginated; the headline money numbers come from a full-table snapshot so they never lose old invoices.
  const [invoices, customers, snapshot, catalog, jobs] = await Promise.all([getInvoices({ limit: 500 }), getCustomerOptions(), getReceivablesSnapshot(), getCatalog(true), getJobs({ limit: 300 })]);
  return (
    <InvoicesClient
      invoices={invoices}
      customers={customers}
      invoicePrefix={settings.invoicePrefix}
      vatEnabled={settings.vatEnabled}
      catalog={catalog.filter((c) => c.kind !== "package").map((c) => ({ id: c.id, name: c.name, unitPriceCents: c.unitPriceCents, taxable: c.taxable }))}
      jobOptions={jobs.filter((j) => j.jobType !== "sale").map((j) => ({ id: j.id, customerId: j.customerId, label: `${jobCode(settings.jobPrefix, j.jobNumber, j.createdAt)} · ${j.title}` }))}
      termsDays={settings.defaultTermsDays}
      aging={snapshot.aging}
      drafts={snapshot.drafts}
      totals={{ invoiced: snapshot.billedCents, collected: snapshot.collectedCents, outstanding: snapshot.aging.totalOutstandingCents }}
      initialFilter={filter}
    />
  );
}
