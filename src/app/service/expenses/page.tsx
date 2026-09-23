import { requireUser } from "@/lib/auth";
import { addDays } from "@/lib/dates";
import { getExpenses, getExpenseTotalsByCategory } from "@/server/service-data";
import ExpensesClient from "@/components/service-expenses";

export const dynamic = "force-dynamic";

export default async function ServiceExpensesPage() {
  await requireUser();
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const [expenses, categoryTotals, monthRows] = await Promise.all([
    getExpenses(undefined, undefined, 500),
    getExpenseTotalsByCategory(addDays(now, -90), addDays(now, 1)),
    getExpenses(monthStart, addDays(now, 1), 500),
  ]);
  return (
    <ExpensesClient
      expenses={expenses}
      categoryTotals={categoryTotals}
      monthTotalCents={monthRows.reduce((s, e) => s + e.amountCents, 0)}
      monthCount={monthRows.length}
    />
  );
}
