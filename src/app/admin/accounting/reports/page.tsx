import { requireUser } from "@/lib/auth";
import { getReports } from "@/server/accounting-data";
import AccountingReports from "@/components/accounting-reports";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Reports" };
export const dynamic = "force-dynamic";

export default async function ReportsPage() {
  const user = await requireUser();
  const data = await getReports(user, 12);
  return <AccountingReports data={data} />;
}
