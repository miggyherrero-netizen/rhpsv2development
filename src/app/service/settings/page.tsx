import { requireUser } from "@/lib/auth";
import {
  getServiceSettings, getTechnicians, getCatalog, getCustomersBundle,
} from "@/server/service-data";
import SettingsClient from "@/components/service-settings";

export const dynamic = "force-dynamic";

export default async function ServiceSettingsPage() {
  const user = await requireUser();
  const [settings, technicians, catalog, customers] = await Promise.all([
    getServiceSettings(user.id),
    getTechnicians(),
    getCatalog(),
    getCustomersBundle(),
  ]);
  return (
    <SettingsClient
      settings={settings}
      technicians={technicians}
      catalog={catalog}
      hasData={customers.length > 0}
    />
  );
}
