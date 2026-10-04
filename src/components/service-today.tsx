"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import {
  Sun, MapPin, Navigation, Play, Square, CheckCircle2, Clock3, Phone, Wallet,
  Gauge, BellRing, Plus, ArrowUpRight, Timer as TimerIcon, AlertTriangle, FileClock, CalendarClock,
} from "lucide-react";
import { fmtTime, fmtDateLong, fmtDate, peso } from "@/lib/format";
import { hasQuote, jobHeading } from "@/lib/service-reports";
import {
  JOB_STATUS_LABEL, JOB_STATUS_TONE, SERVICE_TYPE_LABEL, fmtMinutes,
} from "@/lib/service";
import type { TodayBoard } from "@/server/service-data";
import { startTimer, stopTimer, setJobStatus, createJob } from "@/server/service";
import {
  Chip, Dot, EmptyState, ErrorLine, Field, GhostButton, Money, PrimaryButton, SectionCard,
  Select, StatCard, SvcModal, TextInput, TONE_TEXT, useNow,
} from "@/components/service-ui";

function Elapsed({ startedAt, now }: { startedAt: Date; now: Date | null }) {
  if (!now) {
    return <span className="tnum text-[13px]" style={{ color: "var(--color-svc-text-faint)" }}>—</span>;
  }
  const mins = Math.max(0, Math.round((now.getTime() - new Date(startedAt).getTime()) / 60_000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return (
    <span className="tnum text-[13px]" style={{ color: "var(--color-svc-warn)" }}>
      {h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`}
    </span>
  );
}

export default function TodayClient({
  board: initialBoard,
  customers,
}: {
  board: TodayBoard;
  customers: { id: string; name: string }[];
}) {
  const board = initialBoard;
  // `clock` is null until mount — anything time-sensitive waits for it so the server and
  // client markup agree.
  const clock = useNow(1_000);
  const now = clock ?? new Date();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [quickOpen, setQuickOpen] = useState(false);

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (res && !res.ok) setError(res.error ?? "Something went wrong.");
    });
  };

  const timed = useMemo(
    () => board.jobs.filter((j) => j.scheduledStart).sort((a, b) => +new Date(a.scheduledStart!) - +new Date(b.scheduledStart!)),
    [board.jobs],
  );
  const unscheduledToday = board.jobs.filter((j) => !j.scheduledStart);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  const nextJob = timed.find((j) => new Date(j.scheduledStart!) > now && j.status !== "completed" && j.status !== "cancelled");
  const inFlight = timed.filter((j) => j.status === "in_progress" || j.status === "en_route");

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-6 lg:py-8 max-w-[1400px] mx-auto space-y-6">
      {/* Header */}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[10px] uppercase tracking-[0.3em]" style={{ color: "var(--color-svc-text-faint)" }}>
            Home Service
          </p>
          <h1 className="font-serif text-3xl mt-1" style={{ color: "var(--color-svc-text)" }}>
            Today&apos;s run sheet
          </h1>
          <p className="text-[12.5px] mt-1" style={{ color: "var(--color-svc-text-dim)" }}>
            {fmtDateLong(board.date)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/service/schedule" className="btn-svc-ghost rounded-xl px-3.5 py-2 text-[12.5px]">
            Schedule
          </Link>
          <PrimaryButton onClick={() => setQuickOpen(true)}>
            <Plus size={15} /> New job
          </PrimaryButton>
        </div>
      </header>

      <ErrorLine>{error}</ErrorLine>

      {/* Needs attention — what to act on before anything else */}
      <NeedsAttention board={board} />

      {/* Stats — tiles with nothing to show collapse into one quiet line */}
      <Stats board={board} />

      {/* Running timers */}
      {board.running.length > 0 && (
        <SectionCard title="Timers running">
          <div className="svc-divide">
            {board.running.map((log) => (
              <div key={log.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                <span className="w-2 h-2 rounded-full anim-pulse-soft" style={{ background: "var(--color-svc-warn)" }} />
                <div className="min-w-0 flex-1">
                  <p className="text-[13.5px] truncate" style={{ color: "var(--color-svc-text)" }}>
                    {log.jobTitle}
                    <span style={{ color: "var(--color-svc-text-faint)" }}> · {log.customerName}</span>
                  </p>
                  <p className="text-[11.5px] mt-0.5" style={{ color: "var(--color-svc-text-faint)" }}>
                    {log.technicianName ?? "Unassigned"} · {log.kind} since {fmtTime(new Date(log.startedAt))}
                  </p>
                </div>
                <Elapsed startedAt={new Date(log.startedAt)} now={clock} />
                <GhostButton
                  disabled={pending}
                  onClick={() => run(() => stopTimer(log.id))}
                  className="inline-flex items-center gap-1.5"
                >
                  <Square size={12} /> Stop
                </GhostButton>
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Timeline */}
        <div className="xl:col-span-2 space-y-4">
          <SectionCard
            title="Scheduled today"
            action={
              <span className="text-[11.5px]" style={{ color: "var(--color-svc-text-faint)" }}>
                {inFlight.length} in flight
              </span>
            }
          >
            {timed.length === 0 && unscheduledToday.length === 0 ? (
              <EmptyState
                icon={<Sun size={19} strokeWidth={1.7} />}
                title="Nothing scheduled today"
                hint="Add a job or open the dispatch board to fill the day."
                action={
                  <PrimaryButton onClick={() => setQuickOpen(true)}>
                    <Plus size={15} /> New job
                  </PrimaryButton>
                }
              />
            ) : (
              <div className="svc-divide">
                {timed.map((job, index) => {
                  const start = new Date(job.scheduledStart!);
                  const end = job.scheduledEnd ? new Date(job.scheduledEnd) : null;
                  const prev = index > 0 ? timed[index - 1] : null;
                  const prevEnd = prev?.scheduledEnd ? new Date(prev.scheduledEnd) : null;
                  const gap = prevEnd ? Math.round((start.getTime() - prevEnd.getTime()) / 60_000) : null;
                  const tightTravel = gap !== null && job.travelMinutes > 0 && gap < job.travelMinutes;
                  const isPast = !!clock && !!end && end < now;
                  const isNow = !!clock && start <= now && (!end || end >= now);

                  return (
                    <div key={job.id}>
                      {tightTravel && (
                        <div
                          className="px-5 py-2 text-[11.5px] flex items-center gap-2"
                          style={{ background: "var(--color-svc-warn-soft)", color: "var(--color-svc-warn)" }}
                        >
                          <Navigation size={12} />
                          {gap}m gap but {job.travelMinutes}m travel to {job.area ?? "the next visit"}
                        </div>
                      )}
                      <div
                        className="flex items-start gap-4 px-5 py-4"
                        style={isNow ? { background: "rgba(77,141,240,0.05)" } : undefined}
                      >
                        <div className="w-[68px] shrink-0 pt-0.5">
                          <p className="text-[13.5px] tnum" style={{ color: "var(--color-svc-text)" }}>
                            {fmtTime(start)}
                          </p>
                          <p className="text-[11px] tnum" style={{ color: "var(--color-svc-text-faint)" }}>
                            {end ? fmtTime(end) : `${job.estimatedMinutes}m`}
                          </p>
                        </div>
                        <div
                          className="w-[3px] self-stretch rounded-full shrink-0"
                          style={{ background: isPast ? "var(--color-svc-border)" : "var(--color-svc-accent)" }}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <Link
                              href={`/service/jobs/${job.id}`}
                              className="text-[14px] font-medium hover:underline truncate"
                              style={{ color: "var(--color-svc-text)" }}
                            >
                              {jobHeading(job.title, job.serviceType).heading}
                            </Link>
                            <Chip tone={JOB_STATUS_TONE[job.status] ?? "slate"}>
                              {JOB_STATUS_LABEL[job.status] ?? job.status}
                            </Chip>
                            {isNow && <Chip tone="azure">now</Chip>}
                          </div>
                          <p className="text-[12.5px] mt-1" style={{ color: "var(--color-svc-text-dim)" }}>
                            {job.customerName}
                            {job.area ? ` · ${job.area}` : ""}
                            {job.technicianName ? (
                              <>
                                {" · "}
                                <span className="inline-flex items-center gap-1.5 align-middle">
                                  <Dot color={job.technicianColor ?? "#64748b"} /> {job.technicianName}
                                </span>
                              </>
                            ) : (
                              " · unassigned"
                            )}
                          </p>
                          <div className="flex flex-wrap items-center gap-3 mt-1.5 text-[11.5px]" style={{ color: "var(--color-svc-text-faint)" }}>
                            <span className="inline-flex items-center gap-1">
                              <Clock3 size={12} /> {SERVICE_TYPE_LABEL[job.serviceType] ?? job.serviceType}
                            </span>
                            {job.addressLine && (
                              <a
                                href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(
                                  job.addressLine,
                                )}`}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 hover:underline"
                              >
                                <MapPin size={12} /> {job.addressLine}
                              </a>
                            )}
                            {job.customerPhone && (
                              <a href={`tel:${job.customerPhone}`} className="inline-flex items-center gap-1 hover:underline">
                                <Phone size={12} /> {job.customerPhone}
                              </a>
                            )}
                          </div>

                          {job.runningLog ? (
                            <div className="flex items-center gap-2 mt-3">
                              <span className="text-[11.5px]" style={{ color: "var(--color-svc-warn)" }}>
                                {job.runningLog.kind} · <Elapsed startedAt={new Date(job.runningLog.startedAt)} now={clock} />
                              </span>
                              <GhostButton
                                disabled={pending}
                                onClick={() => run(() => stopTimer(job.runningLog!.id))}
                                className="!py-1.5 !text-[11.5px] inline-flex items-center gap-1.5"
                              >
                                <Square size={11} /> Stop
                              </GhostButton>
                            </div>
                          ) : (
                            <div className="flex flex-wrap gap-2 mt-3">
                              {job.status !== "completed" && job.status !== "cancelled" && job.status !== "paid" && (
                                <>
                                  <GhostButton
                                    disabled={pending}
                                    onClick={() => run(() => startTimer(job.id, "travel", job.technicianId))}
                                    className="!py-1.5 !text-[11.5px] inline-flex items-center gap-1.5"
                                  >
                                    <Navigation size={11} /> Travel
                                  </GhostButton>
                                  <GhostButton
                                    disabled={pending}
                                    onClick={() => run(() => startTimer(job.id, "work", job.technicianId))}
                                    className="!py-1.5 !text-[11.5px] inline-flex items-center gap-1.5"
                                  >
                                    <Play size={11} /> On site
                                  </GhostButton>
                                </>
                              )}
                              {job.status !== "completed" &&
                                job.status !== "cancelled" &&
                                job.status !== "invoiced" &&
                                job.status !== "paid" && (
                                  <GhostButton
                                    disabled={pending}
                                    onClick={() => run(() => setJobStatus(job.id, "completed"))}
                                    className="!py-1.5 !text-[11.5px] inline-flex items-center gap-1.5"
                                  >
                                    <CheckCircle2 size={11} /> Complete
                                  </GhostButton>
                                )}
                            </div>
                          )}
                        </div>
                        <div className="text-right shrink-0">
                          {hasQuote(job.quotedCents)
                            ? <Money cents={job.quotedCents} className="text-[13.5px]" />
                            : <span className="text-[12.5px]" style={{ color: "var(--color-svc-text-faint)" }}>No quote</span>}
                          <p className="text-[11px] mt-0.5" style={{ color: "var(--color-svc-text-faint)" }}>
                            {fmtMinutes(job.estimatedMinutes)} est.
                          </p>
                        </div>
                      </div>
                    </div>
                  );
                })}

                {unscheduledToday.length > 0 && (
                  <div className="px-5 py-4">
                    <p
                      className="text-[10.5px] uppercase tracking-[0.18em] mb-2"
                      style={{ color: "var(--color-svc-text-faint)" }}
                    >
                      Unscheduled
                    </p>
                    <div className="space-y-2">
                      {unscheduledToday.map((job) => (
                        <Link
                          key={job.id}
                          href={`/service/jobs/${job.id}`}
                          className="flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-xl transition"
                          style={{ background: "var(--color-svc-surface-2)" }}
                        >
                          <span className="text-[13px] truncate" style={{ color: "var(--color-svc-text)" }}>
                            {job.title} · {job.customerName}
                          </span>
                          <ArrowUpRight size={14} style={{ color: "var(--color-svc-text-faint)" }} />
                        </Link>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </SectionCard>
        </div>

        {/* Side column */}
        <div className="space-y-6">
          <SectionCard title="Crew">
            {board.technicians.length === 0 ? (
              <EmptyState title="No technicians yet" hint="Add your field crew in Settings." />
            ) : (
              <div className="svc-divide">
                {board.technicians.map((t) => {
                  const running = board.running.find((r) => r.technicianId === t.id);
                  const todayJobs = board.jobs.filter((j) => j.technicianId === t.id);
                  return (
                    <div key={t.id} className="flex items-center gap-3 px-5 py-3">
                      <Dot color={t.color} size={9} />
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] truncate" style={{ color: "var(--color-svc-text)" }}>
                          {t.name}
                        </p>
                        <p className="text-[11.5px]" style={{ color: "var(--color-svc-text-faint)" }}>
                          {todayJobs.length} visit{todayJobs.length === 1 ? "" : "s"} today
                          {running ? ` · on ${running.kind}` : ""}
                        </p>
                      </div>
                      {running ? (
                        <Elapsed startedAt={new Date(running.startedAt)} now={clock} />
                      ) : (
                        <Chip tone="slate">idle</Chip>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </SectionCard>

          {nextJob && (
            <SectionCard title="Up next">
              <div className="px-5 py-4">
                <p className="text-[13.5px]" style={{ color: "var(--color-svc-text)" }}>
                  {nextJob.title}
                </p>
                <p className="text-[12px] mt-1" style={{ color: "var(--color-svc-text-dim)" }}>
                  {fmtTime(new Date(nextJob.scheduledStart!))} · {nextJob.customerName}
                  {nextJob.area ? ` · ${nextJob.area}` : ""}
                </p>
                <p className="text-[11.5px] mt-2" style={{ color: "var(--color-svc-text-faint)" }}>
                  {jobGapLabel(nowMinutes, new Date(nextJob.scheduledStart!).getHours() * 60 + new Date(nextJob.scheduledStart!).getMinutes())}
                </p>
              </div>
            </SectionCard>
          )}
        </div>
      </div>

      <QuickJobModal
        open={quickOpen}
        onClose={() => setQuickOpen(false)}
        customers={customers}
        technicians={board.technicians.map((t) => ({ id: t.id, name: t.name }))}
        onCreate={(input) => run(() => createJob(input))}
        onDone={() => setQuickOpen(false)}
        pending={pending}
      />
    </div>
  );
}

function Stats({ board }: { board: TodayBoard }) {
  const st = board.stats;
  const quiet: string[] = [];
  const tiles: React.ReactNode[] = [
    <StatCard key="visits" label="Visits today" value={st.jobsToday} sub={`${st.completedToday} completed`} icon={<Sun size={15} />} />,
  ];
  if (st.minutesWorked > 0 || st.minutesTravel > 0) {
    tiles.push(<StatCard key="onsite" label="On site" value={fmtMinutes(st.minutesWorked)} sub={`${fmtMinutes(st.minutesTravel)} travel`} tone="azure" icon={<TimerIcon size={15} />} />);
  } else quiet.push("no time logged yet");
  if (st.collectedTodayCents > 0) {
    tiles.push(<StatCard key="collected" label="Collected today" value={peso(st.collectedTodayCents)} tone="success" icon={<Wallet size={15} />} />);
  } else quiet.push("₱0 collected today");
  if (st.outstandingCents > 0) {
    tiles.push(
      <StatCard
        key="out" href="/service/invoices?filter=open" label="Outstanding" value={peso(st.outstandingCents)} tone="warn" icon={<Gauge size={15} />}
        sub={`${st.outstandingCount} unpaid · ${peso(st.overdueCents)} overdue`}
      />,
    );
  } else quiet.push("nothing outstanding");
  if (st.openQuotesCents > 0) {
    tiles.push(<StatCard key="quotes" label="Open quotes" value={peso(st.openQuotesCents)} tone="violet" sub="lead + quoted jobs" icon={<BellRing size={15} />} />);
  } else quiet.push("no open quotes");

  return (
    <div className="space-y-2.5">
      <div className="svc-tiles">{tiles}</div>
      {quiet.length > 0 && (
        <p className="text-[12.5px]" style={{ color: "var(--color-svc-text-faint)" }}>Nothing yet: {quiet.join(" · ")}.</p>
      )}
      {st.draftCount > 0 && (
        <Link href="/service/invoices?filter=draft" className="inline-flex items-center gap-2 min-h-10 text-[12.5px] hover:underline" style={{ color: "var(--color-svc-text-dim)" }}>
          <FileClock size={14} /> <span className="svc-num">{st.draftCount} draft{st.draftCount === 1 ? "" : "s"} · {peso(st.draftCents)} not yet sent</span>
        </Link>
      )}
    </div>
  );
}

function NeedsAttention({ board }: { board: TodayBoard }) {
  const unfinished = board.unfinished;
  const followUps = board.followUps;
  const recalls = board.recalls;
  if (unfinished.length === 0 && followUps.length === 0 && recalls.length === 0) {
    return (
      <p className="flex items-center gap-2 text-[13px]" style={{ color: "var(--color-svc-text-dim)" }}>
        <CheckCircle2 size={16} style={{ color: "var(--color-svc-success)" }} /> All clear — no unfinished jobs, invoices to chase, or recalls due.
      </p>
    );
  }
  const sections = [unfinished.length, followUps.length, recalls.length].filter(Boolean).length;
  return (
    <div className={`grid grid-cols-1 gap-4 ${sections >= 3 ? "xl:grid-cols-3" : sections === 2 ? "lg:grid-cols-2" : ""}`}>
      {unfinished.length > 0 && (
        <SectionCard
          title={<span className="inline-flex items-center gap-2"><AlertTriangle size={14} style={{ color: "var(--color-svc-warn)" }} /> Unfinished · {unfinished.length}</span>}
          action={<span className="text-[12px]" style={{ color: "var(--color-svc-text-faint)" }}>past visits not closed out</span>}
        >
          <ul className="svc-divide">
            {unfinished.slice(0, 6).map((j) => {
              const h = jobHeading(j.title, j.serviceType);
              return (
                <li key={j.id} className="flex items-start justify-between gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <Link href={`/service/jobs/${j.id}`} className="text-[13px] hover:underline" style={{ color: "var(--color-svc-text)" }}>{h.heading}</Link>
                    <p className="text-[12px] mt-0.5 truncate" style={{ color: "var(--color-svc-text-dim)" }}>
                      {j.customerName} · {fmtDate(new Date(j.scheduledStart!))}
                    </p>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      <Chip tone="warn">Needs closing</Chip>
                      <Chip tone={JOB_STATUS_TONE[j.status] ?? "slate"}>{JOB_STATUS_LABEL[j.status] ?? j.status}</Chip>
                    </div>
                  </div>
                  <Link href={`/service/jobs/${j.id}`} className="btn-svc-ghost rounded-lg px-3 min-h-10 inline-flex items-center text-[12px] shrink-0">Close out</Link>
                </li>
              );
            })}
          </ul>
          {unfinished.length > 6 && (
            <Link href="/service/jobs?filter=closing" className="block px-5 py-2.5 text-[12px] hover:underline" style={{ color: TONE_TEXT.azure }}>
              + {unfinished.length - 6} more
            </Link>
          )}
        </SectionCard>
      )}

      {followUps.length > 0 && (
        <SectionCard
          title={<span className="inline-flex items-center gap-2"><Wallet size={14} style={{ color: "var(--color-svc-warn)" }} /> Invoices to follow up · {followUps.length}</span>}
          action={<Link href="/service/invoices?filter=open" className="text-[12px] hover:underline" style={{ color: TONE_TEXT.azure }}>All unpaid</Link>}
        >
          <ul className="svc-divide">
            {followUps.slice(0, 6).map((inv) => (
              <li key={inv.id} className="flex items-start justify-between gap-3 px-5 py-3">
                <div className="min-w-0">
                  <Link href={`/service/invoices/${inv.id}`} className="text-[13px] hover:underline" style={{ color: "var(--color-svc-text)" }}>{inv.customerName}</Link>
                  <p className="text-[12px] mt-0.5" style={{ color: inv.daysOverdue > 0 ? "var(--color-svc-danger)" : "var(--color-svc-text-dim)" }}>
                    {inv.daysOverdue > 0 ? `${inv.daysOverdue}d overdue` : inv.dueDate ? `due ${fmtDate(new Date(inv.dueDate))}` : "no due date"}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <Money cents={inv.balanceCents} className="text-[13px]" />
                  {inv.customerPhone && (
                    <a href={`tel:${inv.customerPhone.replace(/[^\d+]/g, "")}`} className="mt-0.5 flex items-center justify-end gap-1 text-[12px] hover:underline min-h-8" style={{ color: TONE_TEXT.azure }}>
                      <Phone size={11} /> Call
                    </a>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </SectionCard>
      )}

      {recalls.length > 0 && (
        <SectionCard
          title={<span className="inline-flex items-center gap-2"><CalendarClock size={14} style={{ color: TONE_TEXT.azure }} /> Recalls due · {recalls.length}</span>}
          action={<Link href="/service/customers" className="text-[12px] hover:underline" style={{ color: TONE_TEXT.azure }}>All</Link>}
        >
          <ul className="svc-divide">
            {recalls.slice(0, 6).map((r) => (
              <li key={r.pianoId} className="flex items-start justify-between gap-3 px-5 py-3">
                <div className="min-w-0">
                  <p className="text-[13px] truncate" style={{ color: "var(--color-svc-text)" }}>{r.customerName}</p>
                  <p className="text-[12px] mt-0.5 truncate" style={{ color: "var(--color-svc-text-dim)" }}>{r.pianoLabel} · {r.area ?? "—"}</p>
                  <div className="mt-1.5">
                    <Chip tone={r.daysUntilDue < 0 ? "danger" : r.daysUntilDue <= 14 ? "warn" : "slate"}>
                      {r.daysUntilDue < 0 ? `${Math.abs(r.daysUntilDue)}d overdue` : `in ${r.daysUntilDue}d`}
                    </Chip>
                  </div>
                </div>
                <Link href={`/service/jobs?customer=${r.customerId}&piano=${r.pianoId}`} className="btn-svc-ghost rounded-lg px-3 min-h-10 inline-flex items-center text-[12px] shrink-0">Schedule</Link>
              </li>
            ))}
          </ul>
        </SectionCard>
      )}
    </div>
  );
}

function jobGapLabel(nowMinutes: number, startMinutes: number): string {
  const diff = startMinutes - nowMinutes;
  if (diff <= 0) return "starting now";
  if (diff < 60) return `in ${diff} minutes`;
  const h = Math.floor(diff / 60);
  const m = diff % 60;
  return `in ${h}h ${m}m`;
}

function QuickJobModal({
  open,
  onClose,
  customers,
  technicians,
  onCreate,
  onDone,
  pending,
}: {
  open: boolean;
  onClose: () => void;
  customers: { id: string; name: string }[];
  technicians: { id: string; name: string }[];
  onCreate: (input: {
    customerId: string; title: string; serviceType: string; technicianId: string | null;
    scheduledStart: string; priority: string;
  }) => void;
  onDone: () => void;
  pending: boolean;
}) {
  const [customerId, setCustomerId] = useState("");
  const [title, setTitle] = useState("");
  const [serviceType, setServiceType] = useState("tuning");
  const [technicianId, setTechnicianId] = useState("");
  const [date, setDate] = useState(() => todayInputValue());
  const [time, setTime] = useState("09:00");
  const [priority, setPriority] = useState("normal");

  const submit = () => {
    if (!customerId) return;
    onCreate({
      customerId,
      title: title.trim() || "Home service visit",
      serviceType,
      technicianId: technicianId || null,
      scheduledStart: `${date}T${time}`,
      priority,
    });
    onDone();
  };

  return (
    <SvcModal open={open} onClose={onClose} title="New job" subtitle="Create and place it on today's board">
      <div className="space-y-3.5">
        <Field label="Customer">
          <Select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
            <option value="">Select a customer…</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </Select>
        </Field>
        <Field label="Job title" hint="Leave blank to use a generic title">
          <TextInput value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Standard tuning — Yamaha U1" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Service type">
            <Select value={serviceType} onChange={(e) => setServiceType(e.target.value)}>
              {Object.entries(SERVICE_TYPE_LABEL).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </Select>
          </Field>
          <Field label="Technician">
            <Select value={technicianId} onChange={(e) => setTechnicianId(e.target.value)}>
              <option value="">Unassigned</option>
              {technicians.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date">
            <TextInput type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Start">
            <TextInput type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </Field>
        </div>
        <Field label="Priority">
          <Select value={priority} onChange={(e) => setPriority(e.target.value)}>
            <option value="low">Low</option>
            <option value="normal">Normal</option>
            <option value="high">High</option>
            <option value="urgent">Urgent</option>
          </Select>
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <GhostButton onClick={onClose}>Cancel</GhostButton>
          <PrimaryButton pending={pending} disabled={!customerId} onClick={submit}>
            Create job
          </PrimaryButton>
        </div>
      </div>
    </SvcModal>
  );
}

function todayInputValue(): string {
  // Mirror the business timezone (UTC+8) so the date input opens on the Manila day.
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
  return parts;
}
