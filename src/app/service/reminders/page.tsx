import { requireUser } from "@/lib/auth";
import { getCustomerOptions, getTechnicians } from "@/server/service-data";
import { getFollowUpQueue } from "@/server/service-followups-data";
import { getTemplates } from "@/server/service-waitlist-data";
import RemindersClient from "@/components/service-reminders-page";

export const dynamic = "force-dynamic";

/** The one follow-up queue (route kept as /service/reminders): manual reminders and waitlist follow-ups together. */
export default async function ServiceRemindersPage() {
  await requireUser();
  const [queue, customers, templates, technicians] = await Promise.all([getFollowUpQueue(), getCustomerOptions(), getTemplates(), getTechnicians(true)]);
  return (
    <RemindersClient
      queue={queue} customers={customers.map((c) => ({ id: c.id, name: c.name }))} templates={templates}
      technicians={technicians.map((t) => ({ id: t.id, name: t.name }))}
    />
  );
}
