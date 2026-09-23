import { requireUser } from "@/lib/auth";
import { getFinanceReport, getServiceSettings } from "@/server/service-data";
import FinanceClient from "@/components/service-finance";

export const dynamic = "force-dynamic";

// Hiding Finance in settings only removes menu links; this route stays reachable by URL.
export default async function ServiceFinancePage() {
  const user = await requireUser();
  const settings = await getServiceSettings(user.id);
  const report = await getFinanceReport(settings, 6);
  return <FinanceClient report={report} />;
}
