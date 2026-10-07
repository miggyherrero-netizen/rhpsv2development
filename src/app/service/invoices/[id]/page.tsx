import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getInvoiceDetail, getServiceSettings } from "@/server/service-data";
import { getInvoiceFinanceHistory } from "@/server/service-finance-history-data";
import InvoiceDetailClient from "@/components/service-invoice-detail";

export const dynamic = "force-dynamic";

export default async function ServiceInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const [detail, settings, history] = await Promise.all([
    getInvoiceDetail(id, user.id), getServiceSettings(user.id), getInvoiceFinanceHistory(id),
  ]);
  if (!detail) notFound();
  return <InvoiceDetailClient detail={detail} invoicePrefix={settings.invoicePrefix} history={history} />;
}
