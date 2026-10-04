import { notFound } from "next/navigation";
import CustomerRecord from "@/components/gos/customer-record";
import { fillTemplate, templateKeyFor, type CustomerStatus } from "@/lib/gos/customers";
import { manilaTime, manilaDateTime } from "@/lib/gos/format";
import { getCustomer } from "@/server/gos/customers";
import { loadGosSettings } from "@/server/gos/settings";
import { replyDue } from "@/lib/gos/customers";

export default async function CustomerPage({
  params, searchParams,
}: { params: Promise<{ id: string }>; searchParams: Promise<{ added?: string }> }) {
  const { id } = await params;
  const { added } = await searchParams;
  const [res, settings] = await Promise.all([getCustomer(id), loadGosSettings()]);
  if (!res.ok) notFound();
  if (!settings.ok) return <p role="alert" className="gos-card mt-4">{settings.error}</p>;
  const { customer, activity, adName } = res.value;
  const text = fillTemplate(settings.value.templates[templateKeyFor(customer.status as CustomerStatus)], { name: customer.name, area: customer.area });
  const toast = added
    ? `${added.slice(0, 60)} added. Reply reminder set for ${manilaTime(replyDue(customer.inquiryAt, settings.value.reminders.noReplyMinutes))}.`
    : null;
  return (
    <CustomerRecord
      customer={JSON.parse(JSON.stringify(customer))}
      activity={activity.map((a) => ({ id: a.id, kind: a.kind, text: a.text, when: manilaDateTime(a.createdAt), undoable: !!a.undoData && !a.undoneAt }))}
      adName={adName}
      replyText={text}
      lostReasons={settings.value.lostReasons}
      toast={toast}
    />
  );
}
