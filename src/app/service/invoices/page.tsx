import { requireUser } from "@/lib/auth";
import { getInvoices, getCustomerOptions, getServiceSettings } from "@/server/service-data";
import { agingSummary } from "@/lib/service";
import InvoicesClient from "@/components/service-invoices";

export const dynamic = "force-dynamic";

export default async function ServiceInvoicesPage() {
  const user = await requireUser();
  const [settings] = await Promise.all([getServiceSettings(user.id)]);
  const [invoices, customers] = await Promise.all([getInvoices({ limit: 500 }), getCustomerOptions()]);
  const aging = agingSummary(invoices);
  return (
    <InvoicesClient
      invoices={invoices}
      customers={customers}
      invoicePrefix={settings.invoicePrefix}
      vatEnabled={settings.vatEnabled}
      aging={aging}
    />
  );
}
