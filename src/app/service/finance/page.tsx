import { requireUser } from "@/lib/auth";
import { parseRange } from "@/lib/service-reports";
import { getFinanceReport, getServiceSettings } from "@/server/service-data";
import FinanceClient from "@/components/service-finance";

export const dynamic = "force-dynamic";

// Hiding Finance in settings only removes menu links; this route stays reachable by URL.
export default async function ServiceFinancePage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const user = await requireUser();
  const { range } = await searchParams;
  const settings = await getServiceSettings(user.id);
  const report = await getFinanceReport(settings, parseRange(range));
  return <FinanceClient report={report} />;
}
