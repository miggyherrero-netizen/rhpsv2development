import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getInvoiceDetail } from "@/server/service-data";
import { getActiveDocumentShares } from "@/server/service-document-data";
import ServiceDocument from "@/components/service-document";
import ServiceDocumentActions from "@/components/service-document-actions";

export const dynamic = "force-dynamic";

export default async function InvoiceDocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const detail = await getInvoiceDetail(id, user.id);
  if (!detail) notFound();
  const shares = user.role === "owner" ? await getActiveDocumentShares(user.id, id, null) : [];
  return <ServiceDocument detail={detail} backHref={`/service/invoices/${id}`}
    actions={<ServiceDocumentActions invoiceId={user.role === "owner" ? id : undefined}
      shares={shares.map(s => ({ id: s.id, expiresAt: s.expiresAt }))}/>}/>;
}
