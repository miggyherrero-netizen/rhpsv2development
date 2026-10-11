import type { ReactNode } from "react";
import { requireUser } from "@/lib/auth";
import { canViewFinance } from "@/lib/service-flow";
import { getServiceSettings } from "@/server/service-data";
import ServiceShell from "@/components/service-shell";
import { SVC_FONT_VARS } from "@/lib/service-fonts";
import { getFollowUpDueCountSafe } from "@/server/service-followups-data";

export const dynamic = "force-dynamic";

export default async function ServiceLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();
  const [settings, dueFollowUps] = await Promise.all([getServiceSettings(user.id), getFollowUpDueCountSafe()]);
  return (
    <div className={SVC_FONT_VARS}>
      <ServiceShell businessName={settings.businessName} showFinance={settings.showFinance} canFinance={canViewFinance(user)} dueFollowUps={dueFollowUps}>
        {children}
      </ServiceShell>
    </div>
  );
}
