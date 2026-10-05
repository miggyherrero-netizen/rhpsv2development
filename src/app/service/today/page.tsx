import { requireUser } from "@/lib/auth";
import { getTodayBoard, getCustomerOptions, getPianoOptions } from "@/server/service-data";
import TodayClient from "@/components/service-today";
import { getFollowUpsDue, getTemplates, getTripPrompts } from "@/server/service-waitlist-data";

export const dynamic = "force-dynamic";

export default async function ServiceTodayPage() {
  const user = await requireUser();
  const [board, customers, showroomPianos, followUps, tripPrompts, templates] = await Promise.all([getTodayBoard(user.id), getCustomerOptions(), getPianoOptions(), getFollowUpsDue(), getTripPrompts(), getTemplates()]);
  return <TodayClient board={board} customers={customers} showroomPianos={showroomPianos} waitlistFollowUps={followUps} tripPrompts={tripPrompts} templates={templates} />;
}
