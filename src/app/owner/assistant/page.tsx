import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { getOpsSummary } from "@/server/ops-summary-data";
import { aiConfigured } from "@/server/ops-ai";
import { LOADER_BUDGET_MS, withBudget } from "@/server/ops-report-handler";
import OwnerAssistantClient from "@/components/owner-assistant";
import type { OpsSummary } from "@/lib/ops-summary";

export const metadata: Metadata = { title: "AI Assistant" };
export const dynamic = "force-dynamic";

export default async function OwnerAssistantPage() {
  const user = await requireUser();
  if (user.role !== "owner") redirect("/owner/today");
  // The verified summary has no AI dependency; if even it fails, the page still opens with a plain error.
  let summary: OpsSummary | null = null;
  try {
    summary = await withBudget(getOpsSummary(user.id), LOADER_BUDGET_MS);
  } catch (err) {
    console.error("[ops-assistant] page summary failed:", (err as Error).name);
  }
  return <OwnerAssistantClient summary={summary} aiAvailable={aiConfigured()} />;
}
