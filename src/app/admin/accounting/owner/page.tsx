import { requireUser } from "@/lib/auth";
import { getOwnerMoney } from "@/server/accounting-data";
import AccountingOwnerMoney from "@/components/accounting-owner";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Owner Money" };
export const dynamic = "force-dynamic";

export default async function OwnerMoneyPage() {
  const user = await requireUser();
  const data = await getOwnerMoney(user);
  return <AccountingOwnerMoney data={data} />;
}
