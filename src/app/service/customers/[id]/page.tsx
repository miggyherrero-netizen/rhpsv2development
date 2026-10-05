import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { canViewFinance } from "@/lib/service-flow";
import { getCustomerDetail, getPianoOptions, getServiceSettings, getTechnicians } from "@/server/service-data";
import CustomerDetailClient from "@/components/service-customer-detail";
import { getCustomerReminders } from "@/server/service-reminders-data";

export const dynamic = "force-dynamic";

export default async function ServiceCustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const [detail, settings, technicians, showroomPianos, reminders] = await Promise.all([getCustomerDetail(id), getServiceSettings(user.id), getTechnicians(true), getPianoOptions(), getCustomerReminders(id)]);
  if (!detail) notFound();
  return (
    <CustomerDetailClient
      detail={detail}
      reminders={reminders}
      invoicePrefix={settings.invoicePrefix}
      jobPrefix={settings.jobPrefix}
      showroomPianos={showroomPianos}
      technicians={technicians.map((t) => ({ id: t.id, name: t.name }))}
      canSeeMoney={canViewFinance(user)}
    />
  );
}
