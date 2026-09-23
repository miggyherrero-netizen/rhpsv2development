import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getInvoiceDetail } from "@/server/service-data";
import { getSharedDocument } from "@/server/service-document-data";
import ServiceDocument from "@/components/service-document";
import ServiceDocumentActions from "@/components/service-document-actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Shared document", robots: { index: false, follow: false }, referrer: "no-referrer" };

export default async function SharedServiceDocumentPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const share = await getSharedDocument(token);
  if (!share) notFound();
  const detail = await getInvoiceDetail(share.invoiceId, share.ownerId);
  if (!detail || detail.invoice.voidedAt) notFound();
  if (share.kind === "invoice" && share.paymentId !== null) notFound();
  if (share.kind === "receipt" && share.paymentId === null) notFound();
  const payment = share.paymentId ? detail.payments.find(p => p.id === share.paymentId) : undefined;
  if (share.kind === "receipt" && !payment) notFound();
  return <ServiceDocument detail={detail} payment={payment} actions={<ServiceDocumentActions/>}/>;
}
