import { requireUser } from "@/lib/auth";
import { getAccountingSettings } from "@/server/accounting-data";
import AccountingSettings from "@/components/accounting-settings";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Accounting Settings" };
export const dynamic = "force-dynamic";

export default async function AccountingSettingsPage() {
  const user = await requireUser();
  const data = await getAccountingSettings(user.id);
  return <AccountingSettings data={data} />;
}
