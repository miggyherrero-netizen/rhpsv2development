import { notFound } from "next/navigation";
import { getProjectBilling } from "@/server/accounting-data";
import ProjectBilling from "@/components/project-billing";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Project Billing" };
export const dynamic = "force-dynamic";

export default async function ProjectBillingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await getProjectBilling(id);
  if (!data) notFound();
  return <ProjectBilling data={data} />;
}
