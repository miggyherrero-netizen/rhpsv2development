import { requireUser } from "@/lib/auth";
import { getOverview } from "@/server/accounting-data";
import AccountingOverview from "@/components/accounting-overview";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Accounting" };
export const dynamic = "force-dynamic";

export default async function AccountingPage() {
  const user = await requireUser();
  const data = await getOverview(user);
  return <AccountingOverview data={data} />;
}
