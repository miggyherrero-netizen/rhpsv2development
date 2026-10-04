import { requireUser } from "@/lib/auth";
import { parseRange, resolveRange } from "@/lib/service-reports";
import { getExpenses, getServiceSettings } from "@/server/service-data";
import ExpensesClient from "@/components/service-expenses";

export const dynamic = "force-dynamic";

export default async function ServiceExpensesPage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const user = await requireUser();
  const { range: rawRange } = await searchParams;
  const rangeKey = parseRange(rawRange);
  const range = resolveRange(rangeKey);
  // One range drives the list, the totals and the category breakdown — they can never disagree.
  const [expenses, settings] = await Promise.all([
    getExpenses(range.from ?? undefined, range.to, 1000),
    getServiceSettings(user.id),
  ]);
  return <ExpensesClient expenses={expenses} rangeKey={rangeKey} rangeLabel={range.label} showFinance={settings.showFinance} />;
}
