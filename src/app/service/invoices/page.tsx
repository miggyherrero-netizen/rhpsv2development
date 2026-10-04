import { requireUser } from "@/lib/auth";
import { getInvoices, getCustomerOptions, getServiceSettings } from "@/server/service-data";
import { draftSummary, receivables } from "@/lib/service-reports";
import InvoicesClient from "@/components/service-invoices";

export const dynamic = "force-dynamic";

export default async function ServiceInvoicesPage({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  const user = await requireUser();
  const { filter } = await searchParams;
  const [settings] = await Promise.all([getServiceSettings(user.id)]);
  const [invoices, customers] = await Promise.all([getInvoices({ limit: 500 }), getCustomerOptions()]);
  // Receivables count sent / part-paid / paid invoices only — drafts and voids are never "unpaid".
  const aging = receivables(invoices);
  const drafts = draftSummary(invoices);
  return (
    <InvoicesClient
      invoices={invoices}
      customers={customers}
      invoicePrefix={settings.invoicePrefix}
      vatEnabled={settings.vatEnabled}
      aging={aging}
      drafts={drafts}
      initialFilter={filter}
    />
  );
}
