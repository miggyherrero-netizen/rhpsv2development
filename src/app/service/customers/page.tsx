import { requireUser } from "@/lib/auth";
import { getCustomersBundle, getRecalls, getServiceSettings } from "@/server/service-data";
import CustomersClient from "@/components/service-customers";

export const dynamic = "force-dynamic";

export default async function ServiceCustomersPage() {
  const user = await requireUser();
  const [customers, settings] = await Promise.all([getCustomersBundle(true), getServiceSettings(user.id)]);
  const recalls = await getRecalls(new Date(), settings.reminderLeadDays);
  return <CustomersClient customers={customers} recalls={recalls} />;
}
