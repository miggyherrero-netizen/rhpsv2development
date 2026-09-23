import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getJobDetail, getServiceSettings } from "@/server/service-data";
import JobDetailClient from "@/components/service-job-detail";

export const dynamic = "force-dynamic";

export default async function ServiceJobPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const [detail, settings] = await Promise.all([getJobDetail(id), getServiceSettings(user.id)]);
  if (!detail) notFound();
  return (
    <JobDetailClient
      detail={detail}
      jobPrefix={settings.jobPrefix}
      taxRateBps={settings.taxRateBps}
    />
  );
}
