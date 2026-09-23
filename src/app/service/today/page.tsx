import { requireUser } from "@/lib/auth";
import { getTodayBoard, getCustomerOptions } from "@/server/service-data";
import TodayClient from "@/components/service-today";

export const dynamic = "force-dynamic";

export default async function ServiceTodayPage() {
  await requireUser();
  const [board, customers] = await Promise.all([getTodayBoard(), getCustomerOptions()]);
  return <TodayClient board={board} customers={customers} />;
}
