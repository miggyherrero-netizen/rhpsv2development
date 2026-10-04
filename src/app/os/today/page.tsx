import GosEmpty from "@/components/gos/empty";
import TodayReply from "@/components/gos/today-reply";
import { fillTemplate, replyDue, replyState } from "@/lib/gos/customers";
import { manilaTime } from "@/lib/gos/format";
import { describeError } from "@/lib/gos/diagnose";
import { listCustomers, listWaiting } from "@/server/gos/customers";
import { loadGosSettings } from "@/server/gos/settings";

export const dynamic = "force-dynamic";

export default async function TodayPage() {
  let loaded;
  try {
    loaded = await Promise.all([listWaiting(), listCustomers(), loadGosSettings()]);
  } catch (err) {
    console.error("[gos] today failed:", describeError(err));
    return (
      <p role="alert" className="gos-card mt-4">
        Couldn&apos;t update. Try again (reload this page).
        <span className="mt-1 block text-sm">{describeError(err)}</span>
      </p>
    );
  }
  const [waiting, all, settings] = loaded;
  if (!waiting.ok || !all.ok || !settings.ok) {
    return (
      <p role="alert" className="gos-card mt-4">
        Couldn&apos;t update. Try again (reload this page).
      </p>
    );
  }
  if (all.value.length === 0) {
    return <GosEmpty title="Today" text="No customers yet. Tap + Add inquiry when someone messages you." />;
  }
  const now = new Date();
  const rows = waiting.value.rows.map((c) => ({
    id: c.id,
    name: c.name,
    area: c.area,
    inquiryAt: c.inquiryAt.toISOString(),
    dueLabel: manilaTime(replyDue(c.inquiryAt, waiting.value.noReplyMinutes)),
    state: replyState(c.inquiryAt, waiting.value.noReplyMinutes, now),
    text: fillTemplate(settings.value.templates.newInquiry, { name: c.name, area: c.area }),
  }));
  return (
    <div className="mt-2 space-y-4">
      <h1 className="text-2xl font-bold">Today</h1>
      {rows.length === 0 ? (
        <p className="gos-card">All replied ✓</p>
      ) : (
        <TodayReply rows={rows} />
      )}
    </div>
  );
}
