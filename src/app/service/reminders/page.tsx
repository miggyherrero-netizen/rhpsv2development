import { requireUser } from "@/lib/auth";
import { getCustomerOptions } from "@/server/service-data";
import { getOpenReminders } from "@/server/service-reminders-data";
import RemindersClient from "@/components/service-reminders-page";

export const dynamic = "force-dynamic";

/** Follow-ups (route kept as /service/reminders): manual reminders only. The waitlist lives on its own page. */
export default async function ServiceRemindersPage() {
  await requireUser();
  const [reminders, customers] = await Promise.all([getOpenReminders(), getCustomerOptions()]);
  return <RemindersClient reminders={reminders} customers={customers.map((c) => ({ id: c.id, name: c.name }))} />;
}
