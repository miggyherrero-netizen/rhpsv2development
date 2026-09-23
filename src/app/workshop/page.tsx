import { getKioskWorkers } from "@/server/workshop";
import WorkshopKiosk from "@/components/workshop-kiosk";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Workshop" };

export default async function WorkshopPage() {
  const workers = await getKioskWorkers();
  return <WorkshopKiosk workers={workers} />;
}
