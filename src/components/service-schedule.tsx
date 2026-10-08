"use client";

import { useMemo, useState, useTransition, type DragEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, GripVertical, CalendarDays, Inbox } from "lucide-react";
import { ymd, addDays, startOfWeek } from "@/lib/dates";
import { fmtDate, toLocalInput } from "@/lib/format";
import { JOB_STATUS_TONE, SERVICE_TYPE_LABEL, fmtMinuteOfDay, fmtHourShort } from "@/lib/service";
import type { ScheduleBoard } from "@/server/service-data";
import { rescheduleJob } from "@/server/service";
import {
  Chip, Dot, EmptyState, ErrorLine, GhostButton, SectionCard, Select, TONE_BAR, TONE_TEXT,
} from "@/components/service-ui";

const DEFAULT_DAY_START = 7 * 60; // 07:00
const DEFAULT_DAY_END = 20 * 60; // 20:00
const HOUR_PX = 56;
const SNAP = 15; // minutes

export default function ScheduleClient({
  board,
  weekStartIso,
}: {
  board: ScheduleBoard;
  weekStartIso: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [technician, setTechnician] = useState("all");

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(board.from, i)), [board.from]);
  const today = ymd(new Date());

  const visible = useMemo(
    () => board.scheduled.filter((j) => technician === "all" || j.technicianId === technician),
    [board.scheduled, technician],
  );

  // The grid shows 07:00-20:00, and grows by whole hours when a visit falls outside it, so nothing is
  // drawn past the card and the card never needs a scrollbar of its own.
  const { dayStart, dayEnd } = useMemo(() => {
    let lo = DEFAULT_DAY_START;
    let hi = DEFAULT_DAY_END;
    for (const j of board.scheduled) {
      if (!j.scheduledStart) continue;
      const parts = manilaParts(new Date(j.scheduledStart));
      const startMin = parts.hour * 60 + parts.minute;
      const endMin = startMin + Math.max(20, j.estimatedMinutes || 60);
      lo = Math.min(lo, Math.floor(startMin / 60) * 60);
      hi = Math.max(hi, Math.ceil(endMin / 60) * 60);
    }
    return { dayStart: Math.max(0, lo), dayEnd: Math.min(24 * 60, hi) };
  }, [board.scheduled]);

  const move = (jobId: string, dayIndex: number, minutes: number) => {
    const day = days[dayIndex]!;
    const snapped = Math.max(dayStart, Math.min(dayEnd - 15, Math.round(minutes / SNAP) * SNAP));
    // Build a Manila wall-clock string; the server parses it back to a UTC instant.
    const p = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(day);
    const get = (t: string) => p.find((x) => x.type === t)!.value;
    const start = `${get("year")}-${get("month")}-${get("day")}T${String(Math.floor(snapped / 60)).padStart(2, "0")}:${String(snapped % 60).padStart(2, "0")}`;
    setError(null);
    startTransition(async () => {
      const res = await rescheduleJob(jobId, start);
      if (!res.ok) setError(res.error);
    });
  };

  const onDrop = (e: DragEvent<HTMLDivElement>, dayIndex: number) => {
    e.preventDefault();
    const jobId = e.dataTransfer.getData("text/plain") || dragging;
    if (!jobId) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const offsetY = e.clientY - rect.top;
    move(jobId, dayIndex, dayStart + (offsetY / HOUR_PX) * 60);
    setDragging(null);
  };

  const goWeek = (delta: number) => {
    const base = new Date(`${weekStartIso}T00:00:00`);
    const next = startOfWeek(addDays(base, delta * 7), 1);
    router.push(`/service/schedule?week=${ymd(next)}`);
  };

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-6 lg:py-8 app-page [--page-w:1500px] space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[12px] uppercase tracking-[0.2em]" style={{ color: "var(--color-svc-text-faint)" }}>
            Home Service
          </p>
          <h1 className="font-serif text-3xl mt-1" style={{ color: "var(--color-svc-text)" }}>
            Schedule
          </h1>
          <p className="text-[13px] mt-1" style={{ color: "var(--color-svc-text-dim)" }}>
            {fmtDate(board.from)} – {fmtDate(addDays(board.from, 6))} · drag a visit to reschedule
          </p>
        </div>
        <div className="flex items-center gap-2">
          <GhostButton onClick={() => goWeek(-1)} aria-label="Previous week">
            <ChevronLeft size={15} />
          </GhostButton>
          <GhostButton onClick={() => router.push("/service/schedule")}>This week</GhostButton>
          <GhostButton onClick={() => goWeek(1)} aria-label="Next week">
            <ChevronRight size={15} />
          </GhostButton>
          <Select value={technician} onChange={(e) => setTechnician(e.target.value)} aria-label="Filter by crew" className="!w-auto">
            <option value="all">All crew</option>
            {board.technicians.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </Select>
        </div>
      </header>

      <ErrorLine>{error}</ErrorLine>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_260px] gap-5">
        <SectionCard className="overflow-hidden">
          <div className="overflow-x-auto overflow-y-hidden thin-scroll">
            <div className="min-w-[860px] pb-3">
              {/* Day header */}
              <div className="grid" style={{ gridTemplateColumns: `60px repeat(7, minmax(0, 1fr))` }}>
                <div style={{ borderBottom: "1px solid var(--color-svc-border)" }} />
                {days.map((d) => {
                  const isToday = ymd(d) === today;
                  return (
                    <div
                      key={d.toISOString()}
                      className="px-2 py-2.5 text-center svc-col-line"
                      style={{
                        borderBottom: "1px solid var(--color-svc-border)",
                        background: isToday ? "var(--color-svc-accent-soft)" : undefined,
                      }}
                    >
                      <p
                        className="text-[12px] uppercase tracking-[0.14em]"
                        style={{ color: isToday ? TONE_TEXT.azure : "var(--color-svc-text-faint)" }}
                      >
                        {d.toLocaleDateString("en-US", { weekday: "short", timeZone: "Asia/Manila" })}
                      </p>
                      <p
                        className="text-[15px] tnum mt-0.5"
                        style={{ color: isToday ? TONE_TEXT.azure : "var(--color-svc-text)" }}
                      >
                        {d.toLocaleDateString("en-US", { day: "numeric", timeZone: "Asia/Manila" })}
                      </p>
                    </div>
                  );
                })}
              </div>

              {/* Grid body */}
              <div className="grid relative" style={{ gridTemplateColumns: `60px repeat(7, minmax(0, 1fr))` }}>
                {/* Hour gutter */}
                <div className="relative" style={{ height: ((dayEnd - dayStart) / 60) * HOUR_PX }}>
                  {Array.from({ length: (dayEnd - dayStart) / 60 + 1 }, (_, i) => (
                    <div
                      key={i}
                      className="absolute right-2 text-[12px] svc-num whitespace-nowrap -translate-y-1/2"
                      style={{ top: i * HOUR_PX, color: "var(--color-svc-text-faint)" }}
                    >
                      {i === 0 ? "" : fmtHourShort(dayStart + i * 60)}
                    </div>
                  ))}
                </div>

                {days.map((day, dayIndex) => {
                  const key = ymd(day);
                  const dayJobs = visible.filter((j) => j.scheduledStart && ymd(new Date(j.scheduledStart)) === key);
                  const lanes = packLanes(dayJobs);
                  return (
                    <div
                      key={key}
                      className="relative svc-col-line"
                      style={{
                        height: ((dayEnd - dayStart) / 60) * HOUR_PX,
                        background: ymd(day) === today ? "rgba(77,141,240,0.03)" : undefined,
                      }}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => onDrop(e, dayIndex)}
                    >
                      {Array.from({ length: (dayEnd - dayStart) / 60 }, (_, i) => (
                        <div key={i} className="svc-grid-line absolute inset-x-0" style={{ top: i * HOUR_PX }} />
                      ))}
                      {dayJobs.map((job) => {
                        const start = new Date(job.scheduledStart!);
                        const parts = manilaParts(start);
                        const startMin = parts.hour * 60 + parts.minute;
                        const duration = Math.max(20, job.estimatedMinutes || 60);
                        const lane = lanes.get(job.id) ?? { index: 0, count: 1 };
                        const width = 100 / lane.count;
                        const tone = JOB_STATUS_TONE[job.status] ?? "azure";
                        return (
                          <div
                            key={job.id}
                            draggable
                            onDragStart={(e) => {
                              e.dataTransfer.setData("text/plain", job.id);
                              setDragging(job.id);
                            }}
                            onDragEnd={() => setDragging(null)}
                            className="absolute rounded-xl px-2 py-1.5 overflow-hidden cursor-grab active:cursor-grabbing group"
                            style={{
                              top: ((startMin - dayStart) / 60) * HOUR_PX,
                              height: Math.max(30, (duration / 60) * HOUR_PX - 3),
                              left: `calc(${lane.index * width}% + 3px)`,
                              width: `calc(${width}% - 6px)`,
                              background: "var(--color-svc-surface-2)",
                              border: `1px solid ${TONE_BAR[tone]}`,
                              opacity: dragging === job.id ? 0.45 : 1,
                            }}
                            title={`${job.customerName} — ${job.title}`}
                          >
                            <div className="flex items-start gap-1">
                              <span
                                className="w-1 h-full rounded-full shrink-0 absolute left-0 top-0 bottom-0"
                                style={{ background: TONE_BAR[tone] }}
                              />
                              <div className="min-w-0 pl-1.5">
                                <p className="text-[12px] font-medium truncate" style={{ color: "var(--color-svc-text)" }}>
                                  {fmtMinuteOfDay(startMin)} · {job.customerName}
                                </p>
                                <p className="text-[12px] truncate" style={{ color: "var(--color-svc-text-dim)" }}>
                                  {job.title}
                                </p>
                                {job.technicianName && (
                                  <p className="text-[12px] mt-0.5 inline-flex items-center gap-1 truncate">
                                    <Dot color={job.technicianColor ?? "#64748b"} size={5} />
                                    <span style={{ color: "var(--color-svc-text-faint)" }}>{job.technicianName}</span>
                                  </p>
                                )}
                              </div>
                              <Link
                                href={`/service/jobs/${job.id}`}
                                className="absolute right-1 top-1 opacity-0 group-hover:opacity-100 transition"
                                style={{ color: "var(--color-svc-text-faint)" }}
                                aria-label="Open job"
                              >
                                <GripVertical size={12} />
                              </Link>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </SectionCard>

        {/* Unscheduled tray */}
        <SectionCard
          title="Unscheduled"
          action={
            <span className="text-[12px]" style={{ color: "var(--color-svc-text-faint)" }}>
              {board.unscheduled.length}
            </span>
          }
        >
          {board.unscheduled.length === 0 ? (
            <EmptyState
              icon={<CalendarDays size={19} strokeWidth={1.7} />}
              title="Everything is scheduled"
              hint="New leads and quotes land here."
            />
          ) : (
            <div className="svc-divide max-h-[560px] overflow-y-auto thin-scroll">
              {board.unscheduled.map((job) => (
                <div key={job.id} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <Link href={`/service/jobs/${job.id}`} className="text-[14px] hover:underline" style={{ color: "var(--color-svc-text)" }}>
                      {job.title}
                    </Link>
                    <Chip tone={JOB_STATUS_TONE[job.status] ?? "slate"}>{job.status.replace(/_/g, " ")}</Chip>
                  </div>
                  <p className="text-[12px] mt-0.5" style={{ color: "var(--color-svc-text-dim)" }}>
                    {job.customerName} · {SERVICE_TYPE_LABEL[job.serviceType] ?? job.serviceType}
                  </p>
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {days.slice(0, 7).map((d, i) => (
                      <button
                        key={d.toISOString()}
                        disabled={pending}
                        onClick={() => move(job.id, i, 9 * 60)}
                        className="min-w-11 min-h-11 rounded-[10px] text-[13px] font-medium transition-colors hover:brightness-125 disabled:opacity-50"
                        style={{ background: "var(--color-svc-surface-2)", color: "var(--color-svc-text-dim)" }}
                        title={`Schedule on ${fmtDate(d)} at 9:00 AM`}
                      >
                        {d.toLocaleDateString("en-US", { weekday: "narrow", timeZone: "Asia/Manila" })}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
          <div
            className="px-4 py-3 text-[12px] flex items-center gap-2"
            style={{ color: "var(--color-svc-text-faint)", borderTop: "1px solid var(--color-svc-border)" }}
          >
            <Inbox size={13} /> Click a weekday to drop it at 9:00 AM, then drag to fine-tune.
          </div>
        </SectionCard>
      </div>
    </div>
  );
}

/** Simple lane packing so overlapping visits sit side by side instead of hiding each other. */
function packLanes(jobs: { id: string; scheduledStart: Date | null; estimatedMinutes: number }[]) {
  const lanes: { id: string; start: number; end: number; lane: number }[] = [];
  const result = new Map<string, { index: number; count: number }>();
  const sorted = [...jobs].sort((a, b) => +new Date(a.scheduledStart!) - +new Date(b.scheduledStart!));

  for (const job of sorted) {
    const p = manilaParts(new Date(job.scheduledStart!));
    const start = p.hour * 60 + p.minute;
    const end = start + Math.max(20, job.estimatedMinutes || 60);
    let lane = 0;
    while (lanes.some((l) => l.lane === lane && start < l.end && end > l.start)) lane++;
    lanes.push({ id: job.id, start, end, lane });
  }

  // Normalize: within a cluster of overlapping jobs, split the column evenly.
  for (const item of lanes) {
    const overlapping = lanes.filter((l) => item.start < l.end && l.start < item.end);
    const count = Math.max(...overlapping.map((l) => l.lane)) + 1;
    result.set(item.id, { index: item.lane, count });
  }
  return result;
}

function manilaParts(d: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return { hour: Number(get("hour") === "24" ? "0" : get("hour")), minute: Number(get("minute")) };
}
