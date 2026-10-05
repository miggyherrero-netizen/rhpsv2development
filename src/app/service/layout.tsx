import type { ReactNode } from "react";
import { requireUser } from "@/lib/auth";
import { canViewFinance } from "@/lib/service-flow";
import { getServiceSettings } from "@/server/service-data";
import ServiceShell from "@/components/service-shell";
import { getRemindersDue } from "@/server/service-reminders-data";

export const dynamic = "force-dynamic";

export default async function ServiceLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();
  const [settings, dueReminders] = await Promise.all([getServiceSettings(user.id), getRemindersDue()]);
  return (
    <ServiceShell businessName={settings.businessName} showFinance={settings.showFinance} canFinance={canViewFinance(user)} dueReminders={dueReminders.length}>
      {children}
    </ServiceShell>
  );
}
