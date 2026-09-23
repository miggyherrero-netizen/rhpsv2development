import { getShowroomAdmin } from "@/server/data";
import ShowroomClient from "@/components/showroom-client";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Showroom Editor" };

export default async function ShowroomPage() {
  const items = await getShowroomAdmin();
  // Strip costCents here — the main editor list/UI never shows cost or margin, only the separate cost page does.
  const withoutCost = items.map(({ costCents, ...rest }) => rest);
  return <ShowroomClient pianos={withoutCost} />;
}
