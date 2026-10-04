import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { canViewFinance } from "@/lib/service-flow";
import { parseRange, resolveRange } from "@/lib/service-reports";
import { getExpenses, getJobs, getServiceSettings } from "@/server/service-data";
import { jobCode } from "@/lib/service";
import ExpensesClient from "@/components/service-expenses";

export const dynamic = "force-dynamic";

export default async function ServiceExpensesPage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const user = await requireUser();
  // Server-side gate: hiding the menu link is not access control.
  if (!canViewFinance(user)) redirect("/service/today");
  const { range: rawRange } = await searchParams;
  const rangeKey = parseRange(rawRange);
  const range = resolveRange(rangeKey);
  // One range drives the list, the totals and the category breakdown — they can never disagree.
  const [expenses, settings, jobs] = await Promise.all([
    getExpenses(range.from ?? undefined, range.to, 1000),
    getServiceSettings(user.id),
    getJobs({ limit: 300 }),
  ]);
  return <ExpensesClient expenses={expenses} rangeKey={rangeKey} rangeLabel={range.label} showFinance={settings.showFinance}
      jobOptions={jobs.map((j) => ({ id: j.id, label: `${jobCode(settings.jobPrefix, j.jobNumber, j.createdAt)} · ${j.title}` }))} />;
}
