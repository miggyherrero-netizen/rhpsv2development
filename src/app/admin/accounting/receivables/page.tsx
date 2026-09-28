import { getReceivables } from "@/server/accounting-data";
import AccountingReceivables from "@/components/accounting-receivables";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Receivables" };
export const dynamic = "force-dynamic";

export default async function ReceivablesPage() {
  const data = await getReceivables();
  return <AccountingReceivables data={data} />;
}
