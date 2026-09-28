import { notFound } from "next/navigation";
import { getAccountDetail } from "@/server/accounting-data";
import AccountingAccountDetail from "@/components/accounting-account-detail";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Account" };
export const dynamic = "force-dynamic";

export default async function AccountDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await getAccountDetail(id);
  if (!data) notFound();
  return <AccountingAccountDetail data={data} />;
}
