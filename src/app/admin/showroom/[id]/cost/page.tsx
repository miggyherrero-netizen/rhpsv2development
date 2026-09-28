import { notFound } from "next/navigation";
import { getPianoCost } from "@/server/data";
import { getPianoSale } from "@/server/accounting-data";
import ShowroomCostClient from "@/components/showroom-cost-client";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Costs & Sale" };
export const dynamic = "force-dynamic";

export default async function PianoCostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [piano, sale] = await Promise.all([getPianoCost(id), getPianoSale(id)]);
  if (!piano || !sale) notFound();
  return <ShowroomCostClient piano={piano} sale={sale} />;
}
