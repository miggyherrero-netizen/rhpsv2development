import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getJobDetail, getServiceSettings } from "@/server/service-data";
import ServiceQuote from "@/components/service-quote";

export const dynamic = "force-dynamic";

export default async function ServiceQuotePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const settings = await getServiceSettings(user.id);
  const detail = await getJobDetail(id, settings);
  if (!detail) notFound();
  return <ServiceQuote detail={detail} settings={settings} />;
}
