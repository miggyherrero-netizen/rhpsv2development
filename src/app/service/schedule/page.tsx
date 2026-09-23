import { requireUser } from "@/lib/auth";
import { addDays, startOfManilaDayUTC, startOfWeek, ymd } from "@/lib/dates";
import { getScheduleBoard } from "@/server/service-data";
import ScheduleClient from "@/components/service-schedule";

export const dynamic = "force-dynamic";

export default async function ServiceSchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  await requireUser();
  const { week } = await searchParams;
  const anchor = week ? new Date(`${week}T00:00:00`) : new Date();
  const monday = startOfWeek(anchor, 1);
  const from = startOfManilaDayUTC(monday);
  const to = addDays(from, 7);
  const board = await getScheduleBoard(from, to);
  return <ScheduleClient board={board} weekStartIso={ymd(monday)} />;
}
