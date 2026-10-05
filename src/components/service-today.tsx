"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import {
  Sun, MapPin, Square, CheckCircle2, Phone, Wallet, Plus, Send, Copy, MessageCircle,
  AlertTriangle, CalendarClock, FileClock, Check, TrendingUp, ClipboardCheck, ListChecks,
  Bell,
} from "lucide-react";
import { fmtTime, fmtDateLong, fmtDate, peso } from "@/lib/format";
import { jobHeading } from "@/lib/service-reports";
import { telHref } from "@/lib/dashboard";
import { groupByManilaDay, isAllClear, reminderText } from "@/lib/service-today";
import { ReminderItem } from "@/components/service-reminders";
import type { ReminderRow } from "@/server/service-reminders-data";
import {
  JOB_STATUS_LABEL, JOB_STATUS_TONE, SERVICE_TYPE_LABEL, fmtMinutes,
} from "@/lib/service";
import type { TodayBoard } from "@/server/service-data";
import { stopTimer, createJob, setInvoiceStatus } from "@/server/service";
import { closeTrip } from "@/server/service-waitlist";
import MessageActions from "@/components/service-message-actions";
import { WAIT_STATUS_LABEL } from "@/lib/service-waitlist";
import type { TripPrompt, WaitlistItem } from "@/server/service-waitlist-data";
import StepButton from "@/components/service-step-button";
import { JobFormModal, type ShowroomPiano } from "@/components/service-forms";
import {
  Chip, DateField, Dot, ErrorLine, Field, GhostButton, Money, PrimaryButton, SectionCard,
  Select, StatCard, SvcModal, TextInput, TONE_TEXT, useNow,
} from "@/components/service-ui";

const FAINT = { color: "var(--color-svc-text-faint)" } as const;
const DIM = { color: "var(--color-svc-text-dim)" } as const;
const ROW_BTN = "btn-svc-ghost rounded-lg px-3 min-h-11 inline-flex items-center gap-1.5 text-[12.5px] shrink-0";

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
  board,
  customers,
  showroomPianos,
  waitlistFollowUps,
  reminders,
  tripPrompts,
  templates,
}: {
  board: TodayBoard;
  customers: { id: string; name: string; isBatch?: boolean }[];
  showroomPianos: ShowroomPiano[];
  waitlistFollowUps: WaitlistItem[];
  /** Client reminders due today or earlier. */
  reminders: ReminderRow[];
  tripPrompts: TripPrompt[];
  templates: { key: string; name: string; body: string }[];
}) {
  // `clock` is null until mount — anything time-sensitive waits for it so the server and client markup agree.
  const clock = useNow(1_000);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [quickOpen, setQuickOpen] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (res && !res.ok) setError(res.error ?? "Something went wrong.");
    });
  };

  const visits = useMemo(
    () => [...board.jobs].sort((a, b) => (a.scheduledStart ? +new Date(a.scheduledStart) : Infinity) - (b.scheduledStart ? +new Date(b.scheduledStart) : Infinity)),
    [board.jobs],
  );
  const todayIds = new Set(board.jobs.map((j) => j.id));
  const otherRunning = board.running.filter((r) => !todayIds.has(r.jobId));
  const next7Days = useMemo(() => groupByManilaDay(board.next7, (j) => new Date(j.scheduledStart ?? board.date), board.date), [board.next7, board.date]);

  const week = board.week;
  const weekHasData = [week.booked, week.collected, week.spent, week.profit].some((s) => s.service !== 0 || s.sales !== 0) || week.overheadCents > 0;
  const counts = {
    now: visits.length + otherRunning.length,
    money: board.draftInvoices.length + board.unpaid.length + board.deliveryBalances.length,
    reminders: reminders.length,
    waitlist: waitlistFollowUps.length + tripPrompts.length,
    next7: board.next7.length,
    followUps: board.staleQuotes.length + board.recalls.length + board.unfinished.length,
    week: weekHasData ? 1 : 0,
  };

  const copyReminder = async (inv: TodayBoard["unpaid"][number]) => {
    const text = reminderText({
      customerName: inv.customerName, code: inv.code, balanceCents: inv.balanceCents,
      dueDate: inv.dueDate ? new Date(inv.dueDate) : null, daysOverdue: inv.daysOverdue, businessName: board.businessName,
    });
    try {
      await navigator.clipboard.writeText(text);
      setCopied(inv.id);
      setTimeout(() => setCopied((c) => (c === inv.id ? null : c)), 2500);
    } catch {
      setError("Couldn't copy automatically — long-press the invoice to copy its details.");
    }
  };

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-6 lg:py-8 max-w-[1100px] mx-auto space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[11px] uppercase tracking-[0.2em]" style={FAINT}>Home Service</p>
          <h1 className="font-serif text-3xl mt-1" style={{ color: "var(--color-svc-text)" }}>Today</h1>
          <p className="text-[12.5px] mt-1" style={DIM}>{fmtDateLong(board.date)}</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/service/schedule" className="btn-svc-ghost rounded-xl px-3.5 min-h-11 inline-flex items-center text-[12.5px]">Schedule</Link>
          <PrimaryButton onClick={() => setQuickOpen(true)} className="!min-h-11"><Plus size={15} /> New job</PrimaryButton>
        </div>
      </header>

      <ErrorLine>{error}</ErrorLine>
      <p role="status" aria-live="polite" className="sr-only">{copied ? "Reminder copied to the clipboard" : ""}</p>

      {isAllClear(counts) && (
        <p className="flex items-center gap-2 text-[14px] py-4" style={DIM}>
          <CheckCircle2 size={18} style={{ color: "var(--color-svc-success)" }} aria-hidden="true" />
          All clear — no visits, nothing to send or chase, and nothing coming up. Add a job to get going.
        </p>
      )}

      {/* 1 · NOW */}
      {counts.now > 0 && (
        <SectionCard title="Now" action={<span className="text-[12px]" style={FAINT}>{visits.length} visit{visits.length === 1 ? "" : "s"} today</span>}>
          <ul className="svc-divide">
            {otherRunning.map((log) => (
              <li key={log.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                <span className="w-2 h-2 rounded-full anim-pulse-soft" style={{ background: "var(--color-svc-warn)" }} aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="text-[13.5px] truncate" style={{ color: "var(--color-svc-text)" }}>
                    {log.jobTitle}<span style={FAINT}> · {log.customerName}</span>
                  </p>
                  <p className="text-[11.5px] mt-0.5" style={FAINT}>{log.kind} timer running since {fmtTime(new Date(log.startedAt))}</p>
                </div>
                <Elapsed startedAt={new Date(log.startedAt)} now={clock} />
                <GhostButton disabled={pending} onClick={() => run(() => stopTimer(log.id))} className="!min-h-11 inline-flex items-center gap-1.5"><Square size={12} /> Stop</GhostButton>
              </li>
            ))}
            {visits.map((job) => {
              const start = job.scheduledStart ? new Date(job.scheduledStart) : null;
              const end = job.scheduledEnd ? new Date(job.scheduledEnd) : null;
              const isNow = !!clock && !!start && start <= clock && (!end || end >= clock);
              const done = ["completed", "invoiced", "paid", "cancelled"].includes(job.status);
              return (
                <li key={job.id} className="px-5 py-4" style={isNow ? { background: "rgba(77,141,240,0.05)" } : undefined}>
                  <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
                    <div className="w-16 shrink-0 pt-0.5">
                      <p className="text-[13.5px] tnum" style={{ color: "var(--color-svc-text)" }}>{start ? fmtTime(start) : "Any time"}</p>
                      <p className="text-[11px] tnum" style={FAINT}>{fmtMinutes(job.estimatedMinutes)}</p>
                    </div>
                    <div className="min-w-0 flex-1 basis-56">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link href={`/service/jobs/${job.id}`} className="text-[14px] font-medium hover:underline" style={{ color: "var(--color-svc-text)" }}>
                          {jobHeading(job.title, job.serviceType).heading}
                        </Link>
                        <Chip tone={JOB_STATUS_TONE[job.status] ?? "slate"}>{JOB_STATUS_LABEL[job.status] ?? job.status}</Chip>
                        {isNow && <Chip tone="azure">now</Chip>}
                      </div>
                      <p className="text-[12.5px] mt-1" style={DIM}>
                        {job.customerName}{job.area ? ` · ${job.area}` : ""}
                        {job.technicianName ? (<> · <span className="inline-flex items-center gap-1.5 align-middle"><Dot color={job.technicianColor ?? "#64748b"} /> {job.technicianName}</span></>) : " · unassigned"}
                      </p>
                      <div className="flex flex-wrap items-center gap-x-4 mt-0.5 text-[12px]" style={FAINT}>
                        <span>{SERVICE_TYPE_LABEL[job.serviceType] ?? job.serviceType}</span>
                        {job.addressLine && (
                          <a href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(job.addressLine)}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 min-h-8 hover:underline">
                            <MapPin size={12} aria-hidden="true" /> {job.addressLine}
                          </a>
                        )}
                        {job.customerPhone && (
                          <a href={telHref(job.customerPhone) ?? undefined} className="inline-flex items-center gap-1 min-h-8 hover:underline">
                            <Phone size={12} aria-hidden="true" /> {job.customerPhone}
                          </a>
                        )}
                      </div>
                      {job.runningLog && (
                        <p className="text-[12px] mt-1.5 inline-flex items-center gap-2" style={{ color: "var(--color-svc-warn)" }}>
                          {job.runningLog.kind} timer · <Elapsed startedAt={new Date(job.runningLog.startedAt)} now={clock} />
                          <button type="button" disabled={pending} onClick={() => run(() => stopTimer(job.runningLog!.id))} className="underline min-h-8">Stop timer</button>
                        </p>
                      )}
                    </div>
                    {!done || job.status === "completed" ? (
                      <div className="shrink-0 self-center">
                        <StepButton job={job} invoiceId={board.invoiceByJob[job.id] ?? null} onError={setError} />
                      </div>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </SectionCard>
      )}

      {/* Client reminders — who to follow up with today */}
      {counts.reminders > 0 && (
        <SectionCard title={<span className="inline-flex items-center gap-2"><Bell size={14} style={{ color: "var(--color-svc-accent)" }} aria-hidden="true" /> Reminders ({reminders.length})</span>}>
          <ul className="svc-divide">
            {reminders.map((r) => <ReminderItem key={r.id} r={r} now={board.date} showClient />)}
          </ul>
        </SectionCard>
      )}

      {/* 2 · MONEY TO ACT ON */}
      {counts.money > 0 && (
        <SectionCard
          title={<span className="inline-flex items-center gap-2"><Wallet size={14} style={{ color: "var(--color-svc-warn)" }} aria-hidden="true" /> Money to act on</span>}
          action={<Link href="/service/invoices?filter=open" className="inline-flex items-center min-h-11 text-[12px] hover:underline" style={{ color: TONE_TEXT.azure }}>All invoices</Link>}
        >
          {board.draftInvoices.length > 0 && (
            <div>
              <p className="px-5 pt-3 text-[11px] uppercase tracking-[0.1em]" style={FAINT}>
                <FileClock size={12} className="inline mr-1.5 -mt-0.5" aria-hidden="true" />Drafts to send · {board.draftInvoices.length}
              </p>
              <ul className="svc-divide">
                {board.draftInvoices.map((inv) => (
                  <li key={inv.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                    <div className="min-w-0">
                      <Link href={`/service/invoices/${inv.id}`} className="text-[13px] hover:underline" style={{ color: "var(--color-svc-text)" }}>{inv.customerName}</Link>
                      <p className="text-[12px] mt-0.5" style={DIM}>{inv.code}{inv.jobTitle ? ` · ${inv.jobTitle}` : ""}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <Money cents={inv.totalCents} className="text-[13px]" />
                      <PrimaryButton pending={pending} className="!min-h-11 !px-3.5 text-[12.5px]" onClick={() => run(() => setInvoiceStatus(inv.id, "sent"))}>
                        <Send size={13} aria-hidden="true" /> Send
                      </PrimaryButton>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {board.deliveryBalances.length > 0 && (
            <div>
              <p className="px-5 pt-3 text-[11px] uppercase tracking-[0.1em]" style={{ ...FAINT, borderTop: board.draftInvoices.length ? "1px solid var(--color-svc-border)" : undefined, marginTop: board.draftInvoices.length ? 8 : 0 }}>
                Balance due on delivery · {board.deliveryBalances.length}
              </p>
              <ul className="svc-divide">
                {board.deliveryBalances.map((d) => (
                  <li key={d.jobId} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                    <div className="min-w-0">
                      <Link href={`/service/jobs/${d.jobId}`} className="text-[13px] hover:underline" style={{ color: "var(--color-svc-text)" }}>{d.title}</Link>
                      <p className="text-[12px] mt-0.5" style={DIM}>{d.customerName} · delivery {fmtDate(new Date(d.deliveryAt))}, {fmtTime(new Date(d.deliveryAt))}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Money cents={d.balanceCents} className="text-[13px] mr-1" />
                      {d.customerPhone && <a href={telHref(d.customerPhone) ?? undefined} className={ROW_BTN} aria-label={`Call ${d.customerName}`}><Phone size={13} aria-hidden="true" /> Call</a>}
                      <Link href={`/service/jobs/${d.jobId}`} className={ROW_BTN}>Open sale</Link>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {board.unpaid.length > 0 && (
            <div>
              <p className="px-5 pt-3 text-[11px] uppercase tracking-[0.1em]" style={{ ...FAINT, borderTop: board.draftInvoices.length + board.deliveryBalances.length ? "1px solid var(--color-svc-border)" : undefined, marginTop: board.draftInvoices.length + board.deliveryBalances.length ? 8 : 0 }}>
                Unpaid · {board.unpaid.length}
              </p>
              <ul className="svc-divide">
                {board.unpaid.map((inv) => (
                  <li key={inv.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                    <div className="min-w-0">
                      <Link href={`/service/invoices/${inv.id}`} className="text-[13px] hover:underline" style={{ color: "var(--color-svc-text)" }}>{inv.customerName}</Link>
                      <p className="text-[12px] mt-0.5" style={{ color: inv.daysOverdue > 0 ? "var(--color-svc-danger)" : "var(--color-svc-text-dim)" }}>
                        {inv.code} · {inv.daysOverdue > 0 ? `${inv.daysOverdue}d overdue` : inv.dueDate ? `due ${fmtDate(new Date(inv.dueDate))}` : "no due date"}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Money cents={inv.balanceCents} className="text-[13px] mr-1" />
                      <button type="button" onClick={() => { void copyReminder(inv); }} className={ROW_BTN} aria-label={`Copy Messenger reminder for ${inv.customerName}`}>
                        {copied === inv.id ? <><Check size={13} aria-hidden="true" /> Copied</> : <><Copy size={13} aria-hidden="true" /> Copy reminder</>}
                      </button>
                      {inv.messenger && (
                        <a href={`https://m.me/${inv.messenger}`} target="_blank" rel="noreferrer" className={ROW_BTN} aria-label={`Open Messenger chat with ${inv.customerName}`}>
                          <MessageCircle size={13} aria-hidden="true" /> Messenger
                        </a>
                      )}
                      {inv.customerPhone && (
                        <a href={telHref(inv.customerPhone) ?? undefined} className={ROW_BTN} aria-label={`Call ${inv.customerName}`}><Phone size={13} aria-hidden="true" /> Call</a>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </SectionCard>
      )}

      {/* Waitlist follow-ups */}
      {counts.waitlist > 0 && (
        <SectionCard
          title={<span className="inline-flex items-center gap-2"><ListChecks size={14} style={{ color: "var(--color-svc-accent)" }} aria-hidden="true" /> {waitlistFollowUps.length > 0 ? `Follow up today (${waitlistFollowUps.length})` : "Trips"}</span>}
          action={<Link href="/service/waitlist" className="inline-flex items-center min-h-11 text-[12px] hover:underline" style={{ color: TONE_TEXT.azure }}>Open waitlist</Link>}
        >
          {tripPrompts.length > 0 && (
            <ul className="svc-divide">
              {tripPrompts.map((t) => (
                <li key={t.tripId} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                  <p className="text-[13px]" style={{ color: "var(--color-svc-text)" }}>
                    <b className="font-medium">{t.name}</b> is done.{" "}
                    {t.stillWaiting > 0 ? `${t.stillWaiting} other client${t.stillWaiting === 1 ? "" : "s"} in ${t.cityName ?? "that area"} still waiting — message them?` : "Nobody else is waiting there."}
                  </p>
                  <div className="flex gap-2">
                    {t.stillWaiting > 0 && t.cityCode ? <Link href={`/service/waitlist/plan?city=${t.cityCode}`} onClick={() => { void closeTrip(t.tripId); }} className="btn-svc-ghost rounded-xl px-3.5 min-h-11 inline-flex items-center text-[12.5px]">Message them</Link> : null}
                    <GhostButton className="!min-h-11" disabled={pending} onClick={() => run(() => closeTrip(t.tripId))}>Not now</GhostButton>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <ul className="svc-divide">
            {waitlistFollowUps.map((w) => (
              <li key={w.id} className="px-5 py-3 space-y-2.5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-[13.5px] font-medium" style={{ color: "var(--color-svc-text)" }}>
                    {w.customerName} <span className="text-[12px] font-normal" style={DIM}>· {w.pianoLabel ?? "piano"} · {w.cityName ?? "Unsorted"}</span>
                  </p>
                  <span className="text-[11.5px]" style={{ color: w.nextFollowUpAt.getTime() < board.date.getTime() ? "var(--color-svc-danger)" : "var(--color-svc-text-faint)" }}>
                    {WAIT_STATUS_LABEL[w.status]} · message {w.followUpCount + 1}
                  </span>
                </div>
                <MessageActions
                  entryId={w.id} customerName={w.customerName} phone={w.customerPhone} messenger={w.messenger} compact
                  template={templates.find((t) => t.key === (w.source === "recall" && w.status === "waiting" ? "recall" : "follow_up"))?.body ?? ""}
                  vars={{ area: w.areaLabel, piano: w.pianoLabel ?? "piano" }}
                />
              </li>
            ))}
          </ul>
        </SectionCard>
      )}

      {/* 3 · NEXT 7 DAYS */}
      {counts.next7 > 0 && (
        <SectionCard title="Next 7 days" action={<Link href="/service/schedule" className="inline-flex items-center min-h-11 text-[12px] hover:underline" style={{ color: TONE_TEXT.azure }}>Open schedule</Link>}>
          <div className="svc-divide">
            {next7Days.map((g) => (
              <div key={g.dayStart.toISOString()} className="px-5 py-3">
                <p className="text-[11px] uppercase tracking-[0.1em] mb-1" style={FAINT}>{fmtDate(g.dayStart)}</p>
                <ul>
                  {g.items.map((j) => (
                    <li key={j.id}>
                      <Link href={`/service/jobs/${j.id}`} className="flex items-baseline gap-3 min-h-11 py-1.5 hover:bg-white/[0.03] rounded-lg">
                        <span className="w-16 shrink-0 text-[12.5px] tnum" style={DIM}>{j.scheduledStart ? fmtTime(new Date(j.scheduledStart)) : "—"}</span>
                        <span className="text-[13px] truncate" style={{ color: "var(--color-svc-text)" }}>{jobHeading(j.title, j.serviceType).heading}</span>
                        <span className="text-[12px] truncate" style={FAINT}>{j.customerName}{j.area ? ` · ${j.area}` : ""}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      {/* 4 · FOLLOW-UPS */}
      {counts.followUps > 0 && (
        <SectionCard title={<span className="inline-flex items-center gap-2"><AlertTriangle size={14} style={{ color: "var(--color-svc-warn)" }} aria-hidden="true" /> Follow-ups</span>}>
          {board.staleQuotes.length > 0 && (
            <div>
              <p className="px-5 pt-3 text-[11px] uppercase tracking-[0.1em]" style={FAINT}>Quotes with no answer · {board.staleQuotes.length}</p>
              <ul className="svc-divide">
                {board.staleQuotes.map((q) => (
                  <li key={q.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                    <div className="min-w-0">
                      <Link href={`/service/jobs/${q.id}`} className="text-[13px] hover:underline" style={{ color: "var(--color-svc-text)" }}>{q.title}</Link>
                      <p className="text-[12px] mt-0.5" style={DIM}>{q.customerName} · sent {q.days} days ago · {peso(q.quotedCents)}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {q.customerPhone && <a href={telHref(q.customerPhone) ?? undefined} className={ROW_BTN} aria-label={`Call ${q.customerName}`}><Phone size={13} aria-hidden="true" /> Call</a>}
                      <Link href={`/service/jobs/${q.id}/quote`} className={ROW_BTN}>Open quote</Link>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {board.recalls.length > 0 && (
            <div>
              <p className="px-5 pt-3 text-[11px] uppercase tracking-[0.1em]" style={FAINT}><CalendarClock size={12} className="inline mr-1.5 -mt-0.5" aria-hidden="true" />Recalls due · {board.recalls.length}</p>
              <ul className="svc-divide">
                {board.recalls.slice(0, 6).map((r) => (
                  <li key={r.pianoId} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                    <div className="min-w-0">
                      <p className="text-[13px] truncate" style={{ color: "var(--color-svc-text)" }}>{r.customerName}</p>
                      <p className="text-[12px] mt-0.5 truncate" style={DIM}>{r.pianoLabel} · {r.area ?? "—"}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Chip tone={r.daysUntilDue < 0 ? "danger" : r.daysUntilDue <= 14 ? "warn" : "slate"}>
                        {r.daysUntilDue < 0 ? `${Math.abs(r.daysUntilDue)}d overdue` : `in ${r.daysUntilDue}d`}
                      </Chip>
                      <Link href={`/service/jobs?customer=${r.customerId}&piano=${r.pianoId}`} className={ROW_BTN}>Schedule</Link>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {board.unfinished.length > 0 && (
            <div>
              <p className="px-5 pt-3 text-[11px] uppercase tracking-[0.1em]" style={FAINT}><ClipboardCheck size={12} className="inline mr-1.5 -mt-0.5" aria-hidden="true" />Jobs to close out · {board.unfinished.length}</p>
              <ul className="svc-divide">
                {board.unfinished.slice(0, 6).map((j) => (
                  <li key={j.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                    <div className="min-w-0">
                      <Link href={`/service/jobs/${j.id}`} className="text-[13px] hover:underline" style={{ color: "var(--color-svc-text)" }}>{jobHeading(j.title, j.serviceType).heading}</Link>
                      <p className="text-[12px] mt-0.5 truncate" style={DIM}>{j.customerName} · {fmtDate(new Date(j.scheduledStart!))}</p>
                    </div>
                    <Link href={`/service/jobs/${j.id}`} className={ROW_BTN}>Close out</Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </SectionCard>
      )}

      {/* 5 · THIS WEEK */}
      {weekHasData && (
        <section aria-label="This week" className="space-y-2.5">
          <h2 className="text-[13px] font-medium" style={DIM}>This week</h2>
          <div className="svc-tiles">
            <WeekTile label="Booked" split={week.booked} icon={<CalendarClock size={15} />} />
            <WeekTile label="Collected" split={week.collected} tone="success" icon={<Wallet size={15} />} />
            <WeekTile label="Spent" split={week.spent} icon={<Wallet size={15} />} />
            <WeekTile label="Profit" split={week.profit} tone="azure" icon={<TrendingUp size={15} />} />
          </div>
          <p className="text-[12px]" style={FAINT}>
            Spent = job costs and the cost of pianos sold. {week.overheadCents > 0 ? <>Overhead this week ({peso(week.overheadCents)}) is kept separate. </> : null}
            Piano sales count on the day they are completed.
          </p>
        </section>
      )}

      <JobFormModal
        open={quickOpen}
        mode="new"
        onClose={() => setQuickOpen(false)}
        pending={pending}
        customers={customers}
        showroomPianos={showroomPianos}
        technicians={board.technicians.filter((t) => t.active).map((t) => ({ id: t.id, name: t.name }))}
        onSubmit={(values) => run(() => createJob(values))}
      />
    </div>
  );
}

/** One tile; when piano sales have a figure too, the Service / Piano sales split is spelled out underneath. */
function WeekTile({ label, split, tone, icon }: { label: string; split: { service: number; sales: number }; tone?: "success" | "azure"; icon: React.ReactNode }) {
  const total = split.service + split.sales;
  return (
    <StatCard
      label={label} value={peso(total)} tone={tone} icon={icon}
      sub={split.sales !== 0 ? `Service ${peso(split.service)} · Piano sales ${peso(split.sales)}` : undefined}
    />
  );
}
