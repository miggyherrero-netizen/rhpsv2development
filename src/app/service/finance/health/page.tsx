import { redirect } from "next/navigation";
import { getFinanceHealth } from "@/server/service-finance-audit-data";
import FinanceHealthView from "@/components/service-finance-health";

export const dynamic = "force-dynamic";

// Read-only. The loader enforces the owner-only finance gate; a denied user is sent away.
export default async function ServiceFinanceHealthPage() {
  const health = await getFinanceHealth();
  if (!health) redirect("/service/today");
  return <FinanceHealthView health={health} />;
}
