import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { canViewFinance } from "@/lib/service-flow";
import { getJobDetail, getPianoOptions, getServiceSettings } from "@/server/service-data";
import JobDetailClient from "@/components/service-job-detail";

export const dynamic = "force-dynamic";

export default async function ServiceJobPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const settings = await getServiceSettings(user.id);
  const [detail, showroomPianos] = await Promise.all([getJobDetail(id, settings), getPianoOptions()]);
  if (!detail) notFound();
  return (
    <JobDetailClient
      detail={detail}
      showroomPianos={showroomPianos}
      jobPrefix={settings.jobPrefix}
      taxRateBps={settings.taxRateBps}
      taxLabel={settings.taxLabel}
      vatEnabled={settings.vatEnabled}
      marginExcludesVat={settings.marginExcludesVat}
      includeLaborCost={settings.includeLaborCost}
      showJobMargins={settings.showJobMargins && canViewFinance(user)}
    />
  );
}
