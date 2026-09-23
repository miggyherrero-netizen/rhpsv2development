import { notFound } from "next/navigation";
import { getPianoCost } from "@/server/data";
import ShowroomCostClient from "@/components/showroom-cost-client";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Cost & Margin" };

export default async function PianoCostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const piano = await getPianoCost(id);
  if (!piano) notFound();
  return <ShowroomCostClient piano={piano} />;
}
