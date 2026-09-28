import { getAccountsPage } from "@/server/accounting-data";
import AccountingAccounts from "@/components/accounting-accounts";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Accounts" };
export const dynamic = "force-dynamic";

export default async function AccountsPage() {
  const data = await getAccountsPage();
  return <AccountingAccounts accounts={data.accounts} />;
}
