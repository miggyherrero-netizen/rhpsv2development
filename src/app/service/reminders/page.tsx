import { requireUser } from "@/lib/auth";
import { getCustomerOptions } from "@/server/service-data";
import { getOpenReminders } from "@/server/service-reminders-data";
import RemindersClient from "@/components/service-reminders-page";

export const dynamic = "force-dynamic";

export default async function ServiceRemindersPage() {
  await requireUser();
  const [reminders, customers] = await Promise.all([getOpenReminders(), getCustomerOptions()]);
  return <RemindersClient reminders={reminders} customers={customers.map((c) => ({ id: c.id, name: c.name }))} />;
}
