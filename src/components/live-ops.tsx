"use client";

import { useEffect, useState } from "react";
import { Activity, Users, Flame, ListChecks, CircleOff } from "lucide-react";
import type { LiveOps } from "@/server/data";
import { Avatar } from "@/components/ui";
import { LiveEarnings, DurationTicker } from "@/components/tickers";
import { fmtTime, peso } from "@/lib/format";

function Stat({ icon: Icon, label, value, accent }: { icon: typeof Users; label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <div className={`p-2 rounded-lg ${accent ? "bg-emerald-400/15 text-emerald-300" : "bg-white/[0.06] text-mist"}`}>
        <Icon size={15} />
      </div>
      <div>
        <p className={`tnum text-[15px] font-medium leading-none ${accent ? "text-emerald-300" : "text-white"}`}>{value}</p>
        <p className="text-[10px] uppercase tracking-[0.14em] text-mist mt-1">{label}</p>
      </div>
    </div>
  );
}

export default function LiveOpsPanel({ initial, hero = false }: { initial: LiveOps; hero?: boolean }) {
  const [ops, setOps] = useState(initial);

  useEffect(() => {
    const t = setInterval(async () => {
      try {
        const r = await fetch("/api/live", { cache: "no-store" });
        if (r.ok) setOps(await r.json());
      } catch { /* keep last good state */ }
    }, 10_000);
    return () => clearInterval(t);
  }, []);

  return (
    <section className="card-dark overflow-hidden">
      <div className="p-5 sm:p-6 border-b border-white/[0.07] flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="relative flex h-2.5 w-2.5">
            <span className={`absolute inline-flex h-full w-full rounded-full ${ops.clockInCount ? "bg-emerald-400 animate-ping opacity-60" : "bg-slate-500"}`} />
            <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${ops.clockInCount ? "bg-emerald-400" : "bg-slate-500"}`} />
          </span>
          <h2 className={`font-serif text-white ${hero ? "text-2xl" : "text-xl"}`}>Labor — live</h2>
        </div>
        <div className="flex flex-wrap items-center gap-6">
          <Stat icon={Users} label="On the clock" value={String(ops.clockInCount)} accent={ops.clockInCount > 0} />
          <Stat icon={Flame} label="Burn / hour" value={peso(ops.burnRateCentsPerHour)} />
          <Stat icon={ListChecks} label="Active tasks" value={String(ops.activeTaskCount)} />
        </div>
      </div>

      {ops.workers.length === 0 ? (
        <div className="p-10 text-center">
          <CircleOff size={22} className="mx-auto text-mist/50 mb-3" />
          <p className="text-sm text-mist">Nobody is clocked in right now.</p>
          <p className="text-[11.5px] text-mist/60 mt-1">Staff can clock in from the workshop kiosk.</p>
        </div>
      ) : (
        <ul className="divide-y divide-white/[0.06]">
          {ops.workers.map((w) => (
            <li key={w.entryId} className="p-4 sm:p-5 flex items-center gap-4 flex-wrap sm:flex-nowrap">
              <Avatar name={w.name} url={w.avatarUrl} size={hero ? 48 : 40} ring />
              <div className="flex-1 min-w-[170px]">
                <p className="text-white text-[14px] font-medium leading-tight">{w.name}</p>
                <p className="text-mist text-[11.5px] mt-1 truncate">
                  {w.taskTitle ? <span className="text-chrome">{w.taskTitle}</span> : "On the clock — no task attached"}
                  {w.projectName ? <span className="text-mist/70"> · {w.projectName}</span> : null}
                </p>
                <p className="text-[10.5px] text-mist/60 mt-1 uppercase tracking-wider">
                  in at {fmtTime(new Date(w.clockIn))} · <DurationTicker clockIn={w.clockIn} initialNow={ops.generatedAt} />
                  {w.onBreak && <span className="text-amber-300 ml-1.5">· On break</span>}
                </p>
              </div>
              <div className="text-right">
                <LiveEarnings clockIn={w.clockIn} rateCents={w.rateCents} breakMinutes={w.breakMinutes} breakStartedAt={w.breakStartedAt}
                  initialNow={ops.generatedAt}
                  className={`font-medium text-[16px] ${w.onBreak ? "text-amber-300" : "text-emerald-300"}`} />
                <p className="text-[10px] uppercase tracking-[0.14em] text-mist mt-0.5">earned so far</p>
              </div>
            </li>
          ))}
        </ul>
      )}
      {ops.workers.length > 0 && (
        <div className="px-5 py-3.5 bg-white/[0.02] border-t border-white/[0.06] flex items-center justify-between text-[11px] text-mist">
          <span className="flex items-center gap-1.5"><Activity size={12} /> Updating every second locally · refreshes from server every 10s</span>
          <span className="tnum">{ops.clockInCount} active</span>
        </div>
      )}
    </section>
  );
}
