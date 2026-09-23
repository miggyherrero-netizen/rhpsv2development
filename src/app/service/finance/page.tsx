import { requireUser } from "@/lib/auth";
import { getFinanceReport } from "@/server/service-data";
import FinanceClient from "@/components/service-finance";

export const dynamic = "force-dynamic";

export default async function ServiceFinancePage() {
  await requireUser();
  const report = await getFinanceReport(6);
  return <FinanceClient report={report} />;
}
