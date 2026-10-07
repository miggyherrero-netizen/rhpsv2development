import { requireUser } from "@/lib/auth";
import { canViewFinance } from "@/lib/service-flow";
import { getCustomerOptions, getPianoOptions } from "@/server/service-data";
import { getDashboardBoard } from "@/server/service-dashboard-data";
import DashboardClient from "@/components/service-dashboard";
import { getFollowUpsDue, getTemplates, getTripPrompts } from "@/server/service-waitlist-data";
import { getRemindersDue } from "@/server/service-reminders-data";

export const dynamic = "force-dynamic";

// Route stays /service/today (links and redirects point here); the page is the Home Service Dashboard.
export default async function ServiceTodayPage() {
  const user = await requireUser();
  // Money (and the finance health check) is composed on the server only for users who may open Finance.
  const [dash, customers, showroomPianos, followUps, tripPrompts, templates, reminders] = await Promise.all([getDashboardBoard(user.id, canViewFinance(user)), getCustomerOptions(), getPianoOptions(), getFollowUpsDue(), getTripPrompts(), getTemplates(), getRemindersDue()]);
  return <DashboardClient dash={dash} customers={customers} showroomPianos={showroomPianos} waitlistFollowUps={followUps} reminders={reminders} tripPrompts={tripPrompts} templates={templates} />;
}
