import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { canViewFinance } from "@/lib/service-flow";
import { getPianoOptions, getUnreviewedExpenses } from "@/server/service-data";
import ExpenseReviewClient from "@/components/service-expense-review";

export const dynamic = "force-dynamic";

export default async function ExpenseReviewPage() {
  const user = await requireUser();
  if (!canViewFinance(user)) redirect("/service/today");
  const [expenses, pianoOptions] = await Promise.all([getUnreviewedExpenses(), getPianoOptions()]);
  return <ExpenseReviewClient expenses={expenses} pianoOptions={pianoOptions} />;
}
