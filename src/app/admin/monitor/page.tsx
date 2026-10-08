import { getLiveOps, getTodayTimesheet } from "@/server/data";
import LiveOpsPanel from "@/components/live-ops";
import TodayTimesheet from "@/components/today-timesheet";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Live Monitor" };

export default async function MonitorPage() {
  const [live, timesheet] = await Promise.all([getLiveOps(), getTodayTimesheet()]);
  return (
    <div className="p-4 sm:p-7 app-page app-page-narrow [--page-w:896px] space-y-6">
      <div className="mb-2">
        <h1 className="font-serif text-2xl sm:text-3xl text-white">Live Monitor</h1>
        <p className="text-mist text-[12.5px] mt-1">Every hour worked, earning in real time. Leave this on a shop display.</p>
      </div>
      <LiveOpsPanel initial={live} hero />
      <TodayTimesheet initial={timesheet} />
    </div>
  );
}
