import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getInvoiceDetail } from "@/server/service-data";
import { getActiveDocumentShares } from "@/server/service-document-data";
import ServiceDocument from "@/components/service-document";
import ServiceDocumentActions from "@/components/service-document-actions";

export const dynamic = "force-dynamic";

export default async function PaymentReceiptPage({ params }: { params: Promise<{ id: string; paymentId: string }> }) {
  const user = await requireUser();
  const { id, paymentId } = await params;
  const detail = await getInvoiceDetail(id, user.id);
  if (!detail) notFound();
  const payment = detail.payments.find(p => p.id === paymentId);
  if (!payment) notFound();
  const shares = user.role === "owner" ? await getActiveDocumentShares(user.id, id, paymentId) : [];
  return <ServiceDocument detail={detail} payment={payment} backHref={`/service/invoices/${id}`}
    actions={<ServiceDocumentActions invoiceId={user.role === "owner" ? id : undefined}
      paymentId={paymentId} shares={shares.map(s => ({ id: s.id, expiresAt: s.expiresAt }))}/>}/>;
}
