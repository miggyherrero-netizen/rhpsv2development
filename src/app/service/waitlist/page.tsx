import { requireUser } from "@/lib/auth";
import { getCustomerOptions } from "@/server/service-data";
import { getRoutes, getTemplates, getWaitlist } from "@/server/service-waitlist-data";
import WaitlistClient from "@/components/service-waitlist";

export const dynamic = "force-dynamic";

export default async function ServiceWaitlistPage() {
  await requireUser();
  const [data, customers, templates, routes] = await Promise.all([getWaitlist(), getCustomerOptions(), getTemplates(), getRoutes()]);
  return <WaitlistClient data={data} customers={customers} templates={templates} routes={routes} />;
}
