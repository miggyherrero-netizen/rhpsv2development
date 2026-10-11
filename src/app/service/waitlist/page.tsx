import { requireUser } from "@/lib/auth";
import { getCustomerOptions, getTechnicians } from "@/server/service-data";
import { getRoutes, getTemplates, getWaitlist } from "@/server/service-waitlist-data";
import WaitlistClient from "@/components/service-waitlist";

export const dynamic = "force-dynamic";

export default async function ServiceWaitlistPage() {
  await requireUser();
  const [data, customers, templates, routes, technicians] = await Promise.all([getWaitlist(), getCustomerOptions(), getTemplates(), getRoutes(), getTechnicians(true)]);
  return <WaitlistClient data={data} customers={customers} templates={templates} routes={routes} technicians={technicians.map((t) => ({ id: t.id, name: t.name }))} />;
}
