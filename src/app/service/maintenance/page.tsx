import { requireUser } from "@/lib/auth";
import { getMaintenanceOverview } from "@/server/maintenance-data";
import MaintenanceView from "@/components/service-maintenance";

export const dynamic = "force-dynamic";

/** Maintenance (Phase 1): read-only preview of reminder stages and channel eligibility. Writes and sends nothing. */
export default async function ServiceMaintenancePage() {
  await requireUser();
  return <MaintenanceView overview={await getMaintenanceOverview()} />;
}
