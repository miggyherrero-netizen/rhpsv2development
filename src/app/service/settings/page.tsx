import { requireUser } from "@/lib/auth";
import {
  getServiceSettings, getTechnicians, getCatalog, getCustomersBundle,
} from "@/server/service-data";
import SettingsClient from "@/components/service-settings";
import { getGeoCities, getGeoSettings, getRoutes, getTemplates } from "@/server/service-waitlist-data";
import { placeLabel } from "@/lib/service-geo";

export const dynamic = "force-dynamic";

export default async function ServiceSettingsPage() {
  const user = await requireUser();
  const [settings, technicians, catalog, customers, geo, routes, templates, cities] = await Promise.all([
    getServiceSettings(user.id),
    getTechnicians(),
    getCatalog(),
    getCustomersBundle(),
    getGeoSettings(user.id),
    getRoutes(),
    getTemplates(),
    getGeoCities(),
  ]);
  const used = new Set([geo.homeBaseCityCode, ...routes.flatMap((r) => r.cityCodes)]);
  const cityLabels = Object.fromEntries(cities.filter((c) => used.has(c.code)).map((c) => [c.code, placeLabel({ city: c.name, province: c.provinceName, regionShort: c.regionShort })]));
  return (
    <SettingsClient
      settings={settings}
      technicians={technicians}
      catalog={catalog}
      hasData={customers.length > 0}
      homeBase={geo.homeBaseCityCode}
      radiusKm={geo.tripRadiusKm}
      routes={routes}
      templates={templates}
      cityLabels={cityLabels}
    />
  );
}
