import { requireUser } from "@/lib/auth";
import { getInvoices, getCustomerOptions, getReceivablesSnapshot, getServiceSettings } from "@/server/service-data";
import InvoicesClient from "@/components/service-invoices";

export const dynamic = "force-dynamic";

export default async function ServiceInvoicesPage({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  const user = await requireUser();
  const { filter } = await searchParams;
  const [settings] = await Promise.all([getServiceSettings(user.id)]);
  // The list is paginated; the headline money numbers come from a full-table snapshot so they never lose old invoices.
  const [invoices, customers, snapshot] = await Promise.all([getInvoices({ limit: 500 }), getCustomerOptions(), getReceivablesSnapshot()]);
  return (
    <InvoicesClient
      invoices={invoices}
      customers={customers}
      invoicePrefix={settings.invoicePrefix}
      vatEnabled={settings.vatEnabled}
      aging={snapshot.aging}
      drafts={snapshot.drafts}
      totals={{ invoiced: snapshot.billedCents, collected: snapshot.collectedCents, outstanding: snapshot.aging.totalOutstandingCents }}
      initialFilter={filter}
    />
  );
}
