import { requireUser } from "@/lib/auth";
import { getTodayBoard, getCustomerOptions, getPianoOptions } from "@/server/service-data";
import TodayClient from "@/components/service-today";
import { getFollowUpsDue, getTemplates, getTripPrompts } from "@/server/service-waitlist-data";
import { getRemindersDue } from "@/server/service-reminders-data";

export const dynamic = "force-dynamic";

export default async function ServiceTodayPage() {
  const user = await requireUser();
  const [board, customers, showroomPianos, followUps, tripPrompts, templates, reminders] = await Promise.all([getTodayBoard(user.id), getCustomerOptions(), getPianoOptions(), getFollowUpsDue(), getTripPrompts(), getTemplates(), getRemindersDue()]);
  return <TodayClient board={board} customers={customers} showroomPianos={showroomPianos} waitlistFollowUps={followUps} reminders={reminders} tripPrompts={tripPrompts} templates={templates} />;
}
