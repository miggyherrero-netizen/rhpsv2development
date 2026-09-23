import type { ReactNode } from "react";
import { requireUser } from "@/lib/auth";
import { getServiceSettings } from "@/server/service-data";
import ServiceShell from "@/components/service-shell";

export const dynamic = "force-dynamic";

export default async function ServiceLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();
  const settings = await getServiceSettings(user.id);
  return (
    <ServiceShell businessName={settings.businessName} showFinance={settings.showFinance}>
      {children}
    </ServiceShell>
  );
}
