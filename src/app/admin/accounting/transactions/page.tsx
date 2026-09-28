import { getAccountsPage, getJournalPage } from "@/server/accounting-data";
import AccountingTransactions from "@/components/accounting-transactions";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Transactions" };
export const dynamic = "force-dynamic";

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<{ account?: string; kind?: string; stream?: string; month?: string; q?: string }>;
}) {
  const sp = await searchParams;
  const [feed, accounts] = await Promise.all([
    getJournalPage({ accountId: sp.account, kind: sp.kind, stream: sp.stream, monthKey: sp.month, q: sp.q }),
    getAccountsPage(),
  ]);
  return (
    <AccountingTransactions
      items={feed.items}
      wallets={feed.wallets}
      months={feed.months}
      filter={{ accountId: sp.account, kind: sp.kind, stream: sp.stream, monthKey: sp.month, q: sp.q }}
      expenseAccounts={accounts.accounts.filter((a) => a.type === "expense" && a.active)}
      loanAccounts={accounts.accounts.filter((a) => a.type === "liability" && !a.isWallet)}
    />
  );
}
