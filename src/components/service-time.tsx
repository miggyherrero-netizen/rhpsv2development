"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { Timer, Square, Navigation, Play, Trash2, Pencil } from "lucide-react";
import { fmtDate, fmtTime } from "@/lib/format";
import { TIME_KIND_LABEL, fmtMinutes, elapsedMinutes, utilizationPct } from "@/lib/service";
import type { TimeLogRow } from "@/server/service-data";
import { stopTimer, deleteTimeLog, updateTimeLog } from "@/server/service";
import { TimeEditModal } from "@/components/service-forms";
import { timeSourceLabel } from "@/lib/service-time-events";
import {
  Bar, Chip, Dot, EmptyState, ErrorLine, FilterPills, GhostButton, Money, SectionCard,
  StatCard, TONE_TEXT,
} from "@/components/service-ui";

const RANGES = [
  { key: "week", label: "This week" },
  { key: "last", label: "Last week" },
  { key: "month", label: "This month" },
];

export default function TimeClient({
  logs,
  running,
  technicians,
  range,
}: {
  logs: TimeLogRow[];
  running: TimeLogRow[];
  technicians: { id: string; name: string; color: string; hourlyRateCents: number }[];
  range: string;
}) {
  const [pending, startTransition] = useTransition();
  const [editLogId, setEditLogId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (res && !res.ok) setError(res.error ?? "Something went wrong.");
    });
  };

  const byTech = useMemo(() => {
    return technicians.map((t) => {
      const mine = logs.filter((l) => l.technicianId === t.id);
      const work = mine.filter((l) => l.kind === "work").reduce((s, l) => s + (l.minutes ?? 0), 0);
      const travel = mine.filter((l) => l.kind === "travel").reduce((s, l) => s + (l.minutes ?? 0), 0);
      const breakM = mine.filter((l) => l.kind === "break").reduce((s, l) => s + (l.minutes ?? 0), 0);
      const jobs = new Set(mine.map((l) => l.jobId)).size;
      return {
        ...t,
        work,
        travel,
        break: breakM,
        jobs,
        laborCents: mine
          .filter((l) => l.kind === "work")
          .reduce((s, l) => s + Math.round(((l.minutes ?? 0) / 60) * l.hourlyRateCents), 0),
        utilization: utilizationPct(work, work + travel + breakM),
      };
    });
  }, [logs, technicians]);

  const totals = useMemo(() => {
    const work = logs.filter((l) => l.kind === "work").reduce((s, l) => s + (l.minutes ?? 0), 0);
    const travel = logs.filter((l) => l.kind === "travel").reduce((s, l) => s + (l.minutes ?? 0), 0);
    const breaks = logs.filter((l) => l.kind === "break").reduce((s, l) => s + (l.minutes ?? 0), 0);
    const laborCents = logs
      .filter((l) => l.kind === "work")
      .reduce((s, l) => s + Math.round(((l.minutes ?? 0) / 60) * l.hourlyRateCents), 0);
    return { work, travel, breaks, laborCents, jobs: new Set(logs.map((l) => l.jobId)).size };
  }, [logs]);

  const maxMinutes = Math.max(1, ...byTech.map((t) => t.work + t.travel));

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-6 lg:py-8 max-w-[1300px] mx-auto space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[12px] uppercase tracking-[0.2em]" style={{ color: "var(--color-svc-text-faint)" }}>
            Home Service
          </p>
          <h1 className="font-serif text-3xl mt-1" style={{ color: "var(--color-svc-text)" }}>
            Time
          </h1>
          <p className="text-[13px] mt-1" style={{ color: "var(--color-svc-text-dim)" }}>
            Travel, on-site, and break minutes across the crew
          </p>
        </div>
        <FilterPills options={RANGES} value={range} onChange={(key) => {
          window.location.href = `/service/time?range=${key}`;
        }} />
      </header>

      <ErrorLine>{error}</ErrorLine>

      <div className="svc-tiles">
        <StatCard label="On site" value={fmtMinutes(totals.work)} tone="azure" icon={<Timer size={15} />} />
        <StatCard label="Travel" value={fmtMinutes(totals.travel)} tone="violet" icon={<Navigation size={15} />} />
        <StatCard label="Breaks" value={fmtMinutes(totals.breaks)} />
        <StatCard label="Jobs touched" value={totals.jobs} />
        <StatCard label="Labor cost" value={<Money cents={totals.laborCents} />} tone="warn" sub="at crew rates" />
      </div>

      {running.length > 0 && (
        <SectionCard title="Running now">
          <div className="svc-divide">
            {running.map((log) => (
              <div key={log.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <span className="w-2 h-2 rounded-full anim-pulse-soft" style={{ background: "var(--color-svc-warn)" }} />
                <div className="flex-1 min-w-0">
                  <Link href={`/service/jobs/${log.jobId}`} className="text-[14px] hover:underline" style={{ color: "var(--color-svc-text)" }}>
                    {log.jobTitle}
                  </Link>
                  <p className="text-[12px]" style={{ color: "var(--color-svc-text-faint)" }}>
                    {log.customerName} · {log.technicianName ?? "Unassigned"} · since {fmtTime(new Date(log.startedAt))}
                  </p>
                </div>
                <span className="text-[14px] tnum" style={{ color: "var(--color-svc-warn)" }}>
                  {fmtMinutes(elapsedMinutes(log.startedAt))}
                </span>
                <GhostButton disabled={pending} onClick={() => run(() => stopTimer(log.id))} className="inline-flex items-center gap-1.5">
                  <Square size={12} /> Stop
                </GhostButton>
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-5">
        <SectionCard title="Time entries">
          {logs.length === 0 ? (
            <EmptyState
              icon={<Timer size={19} strokeWidth={1.7} />}
              title="No time logged in this range"
              hint="Start timers from a job, or add time manually on the job screen."
            />
          ) : (
            <div className="svc-table-wrap thin-scroll">
              <table className="svc-table w-full text-left">
                <thead>
                  <tr style={{ color: "var(--color-svc-text-faint)" }}>
                    {["Date", "Technician", "Job", "Type", "Window", "Minutes", ""].map((h) => (
                      <th key={h} className="px-5 py-2.5 text-[12px] uppercase tracking-[0.08em] font-normal">{h || <span className="sr-only">Actions</span>}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="svc-divide">
                  {logs.map((log) => (
                    <tr key={log.id} className="group hover:bg-white/[0.02] transition">
                      <td className="px-5 py-2.5 text-[13px] whitespace-nowrap" style={{ color: "var(--color-svc-text-dim)" }}>
                        {fmtDate(new Date(log.startedAt))}
                      </td>
                      <td className="px-5 py-2.5 whitespace-nowrap">
                        <span className="inline-flex items-center gap-1.5 text-[13px]" style={{ color: "var(--color-svc-text-dim)" }}>
                          <Dot color={log.technicianColor ?? "#64748b"} /> {log.technicianName ?? "Unassigned"}
                        </span>
                      </td>
                      <td className="px-5 py-2.5 text-[13px] max-w-[220px] truncate">
                        <Link href={`/service/jobs/${log.jobId}`} className="hover:underline" style={{ color: "var(--color-svc-text)" }}>
                          {log.jobTitle}
                        </Link>
                        <span style={{ color: "var(--color-svc-text-faint)" }}> · {log.customerName}</span>
                      </td>
                      <td className="px-5 py-2.5">
                        <Chip tone={log.kind === "work" ? "azure" : log.kind === "travel" ? "violet" : "slate"}>
                          {TIME_KIND_LABEL[log.kind] ?? log.kind}
                        </Chip>
                        <p className="text-[12px] mt-1" style={{ color: "var(--color-svc-text-faint)" }}>{timeSourceLabel(log)}</p>
                      </td>
                      <td className="px-5 py-2.5 text-[12px] tnum whitespace-nowrap" style={{ color: "var(--color-svc-text-dim)" }}>
                        {fmtTime(new Date(log.startedAt))}
                        {log.endedAt ? ` – ${fmtTime(new Date(log.endedAt))}` : " · running"}
                      </td>
                      <td className="px-5 py-2.5 text-[14px] tnum" style={{ color: "var(--color-svc-text)" }}>
                        {log.endedAt ? fmtMinutes(log.minutes) : fmtMinutes(elapsedMinutes(log.startedAt))}
                      </td>
                      <td className="px-5 py-2.5 text-right whitespace-nowrap">
                        <button
                          onClick={() => setEditLogId(log.id)}
                          className="inline-flex items-center justify-center min-w-11 min-h-11 rounded-lg opacity-0 group-hover:opacity-100 focus-visible:opacity-100 [@media(pointer:coarse)]:opacity-100 hover:bg-white/[0.06]"
                          style={{ color: "var(--color-svc-text-faint)" }}
                          aria-label="Edit entry"
                        >
                          <Pencil size={13} />
                        </button>
                        <button
                          onClick={() => run(() => deleteTimeLog(log.id))}
                          className="inline-flex items-center justify-center min-w-11 min-h-11 rounded-lg opacity-0 group-hover:opacity-100 focus-visible:opacity-100 [@media(pointer:coarse)]:opacity-100 hover:bg-white/[0.06]"
                          style={{ color: "var(--color-svc-text-faint)" }}
                          aria-label="Delete entry"
                        >
                          <Trash2 size={13} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>

        <SectionCard title="Crew utilization">
          <div className="px-5 py-4 space-y-4">
            {byTech.length === 0 ? (
              <p className="text-[12px]" style={{ color: "var(--color-svc-text-faint)" }}>
                Add technicians in Settings to see utilization.
              </p>
            ) : (
              byTech.map((t) => (
                <div key={t.id}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5 text-[13px]" style={{ color: "var(--color-svc-text)" }}>
                      <Dot color={t.color} /> {t.name}
                    </span>
                    <span className="text-[12px] tnum" style={{ color: "var(--color-svc-text-dim)" }}>
                      {t.utilization}%
                    </span>
                  </div>
                  <div className="mt-1.5">
                    <Bar pct={((t.work + t.travel) / maxMinutes) * 100} color={t.color} />
                  </div>
                  <p className="text-[12px] mt-1" style={{ color: "var(--color-svc-text-faint)" }}>
                    {fmtMinutes(t.work)} on site · {fmtMinutes(t.travel)} travel · {fmtMinutes(t.break)} break ·{" "}
                    {t.jobs} job{t.jobs === 1 ? "" : "s"}
                  </p>
                </div>
              ))
            )}
          </div>
        </SectionCard>
      </div>

      <p className="text-[12px]" style={{ color: "var(--color-svc-text-faint)" }}>
        Tip: tap Start travel / Arrived on <Link href="/service/today" className="inline-flex items-center min-h-11 px-1 hover:underline" style={{ color: TONE_TEXT.azure }}>Today</Link> — the
        travel and on-site minutes fill in by themselves.
      </p>

      <TimeEditModal
        open={!!editLogId}
        onClose={() => setEditLogId(null)}
        pending={pending}
        log={(() => { const l = logs.find((x) => x.id === editLogId); return l ? { id: l.id, kind: l.kind, startedAt: l.startedAt, endedAt: l.endedAt, note: l.note, fromStatus: l.source === "event" } : null; })()}
        onSubmit={(id, v) => run(() => updateTimeLog(id, v))}
      />
    </div>
  );
}
