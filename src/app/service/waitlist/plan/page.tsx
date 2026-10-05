import { requireUser } from "@/lib/auth";
import { getTechnicians } from "@/server/service-data";
import { getGeoSettings, getTemplates, getTripPlan, getGeoCity } from "@/server/service-waitlist-data";
import { placeLabel } from "@/lib/service-geo";
import PlanTripClient from "@/components/service-waitlist-plan";

export const dynamic = "force-dynamic";

export default async function PlanTripPage({ searchParams }: { searchParams: Promise<{ city?: string; km?: string; trip?: string }> }) {
  const user = await requireUser();
  const { city, km } = await searchParams;
  const [settings, technicians, templates] = await Promise.all([getGeoSettings(user.id), getTechnicians(true), getTemplates()]);
  const radius = Number(km) > 0 ? Number(km) : settings.tripRadiusKm;
  const plan = city ? await getTripPlan(user.id, city, radius) : null;
  const dest = city ? await getGeoCity(city) : null;
  return (
    <PlanTripClient
      plan={plan}
      destLabel={dest ? placeLabel({ city: dest.name, province: dest.provinceName, regionShort: dest.regionShort }) : null}
      destCode={dest?.code ?? null}
      radiusKm={radius}
      technicians={technicians.map((t) => ({ id: t.id, name: t.name }))}
      templates={templates}
    />
  );
}
