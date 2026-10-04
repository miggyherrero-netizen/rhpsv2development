import type { ReactNode } from "react";
import { requireUser } from "@/lib/auth";
import { canViewFinance } from "@/lib/service-flow";
import { getServiceSettings } from "@/server/service-data";
import ServiceShell from "@/components/service-shell";

export const dynamic = "force-dynamic";

export default async function ServiceLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();
  const settings = await getServiceSettings(user.id);
  return (
    <ServiceShell businessName={settings.businessName} showFinance={settings.showFinance} canFinance={canViewFinance(user)}>
      {children}
    </ServiceShell>
  );
}
