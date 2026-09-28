"use client";

import { useMemo, useState, useEffect } from "react";
import Link from "next/link";
import {
  Plus, AlarmClock, Inbox, CalendarPlus, Trash2, CheckCheck, ArrowRight, AlertTriangle, Repeat2,
} from "lucide-react";
import type { OwnerBundle } from "@/lib/owner-utils";
import { computeWorkload, findConflicts, deserializeOwnerBundle, type CalItem } from "@/lib/owner-utils";
import type { OwnerTask } from "@/db/schema";
import { ymd, startOfManilaDayUTC, startOfDay } from "@/lib/dates";
import { fmtTime, fmtDateLong, fmtDuration } from "@/lib/format";
import { EmptyState } from "@/components/ui";
import { ItemModal, TaskCheck, KindGlyph, CategoryChip, PriorityDot, type ItemEdit } from "@/components/owner-ui";
import {
  setOwnerTaskDone, cancelOwnerTask, postponeOwnerTask, toggleOnToday,
  completeOwnerEvent, deleteOwnerEvent, addInboxItem, createOwnerTask,
} from "@/server/owner";

function ScopeModal({ open, onChoose, action }: { open: boolean; onChoose: (m: "occurrence" | "series" | null) => void; action: string }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-5">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm anim-fade-in" onClick={() => onChoose(null)} />
      <div className="relative card-ow p-6 max-w-xs w-full anim-sheet">
        <p className="font-serif text-lg text-[var(--color-ow-text)]">This is a recurring item</p>
        <p className="text-[12.5px] text-[var(--color-ow-text-dim)] mt-1.5">{action} — apply to?</p>
        <div className="mt-4 space-y-2">
          <button onClick={() => onChoose("occurrence")} className="w-full text-[13px] rounded-xl py-2.5 transition text-[var(--color-ow-text-dim)] hover:text-[var(--color-ow-text)]"
            style={{ border: "1px solid var(--color-ow-border)" }}>Just this occurrence</button>
          <button onClick={() => onChoose("series")} className="btn-ow-primary w-full text-[13px] rounded-xl py-2.5">The whole series</button>
        </div>
      </div>
    </div>
  );
}

export function nowClock() {
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true }).format(new Date());
}

export default function TodayClient({ bundle: rawBundle }: { bundle: OwnerBundle }) {
  const bundle = useMemo(() => deserializeOwnerBundle(rawBundle), [rawBundle]);
  const [clock, setClock] = useState<string | null>(() => nowClock());
  const [modal, setModal] = useState<null | { edit?: ItemEdit; time?: string }>(null);
  const [quick, setQuick] = useState("");
  const [quickType, setQuickType] = useState<"task" | "inbox">("task");
  const [quickPriority, setQuickPriority] = useState("normal");
  const [quickError, setQuickError] = useState<string | null>(null);
  const [scope, setScope] = useState<null | { item: CalItem; action: "complete" | "delete" }>(null);
  const [reschedId, setReschedId] = useState<string | null>(null);

  useEffect(() => {
    const t = setInterval(() => setClock(nowClock()), 1000);
    return () => clearInterval(t);
  }, []);

  const today = useMemo(() => new Date(), []);
  const overdue = useMemo(() => {
    const todayStart = startOfDay(today);
    return bundle.tasks.filter(
      (t) =>
        t.status !== "done" &&
        t.status !== "cancelled" &&
        !t.recurrence &&
        ((t.dueDate && startOfDay(t.dueDate) < todayStart) ||
          (t.scheduledStart && startOfDay(t.scheduledStart) < todayStart))
    );
  }, [bundle.tasks, today]);
  const [nowMs] = useState(() => Date.now());
  const key = ymd(today);
  const catMap = useMemo(() => new Map(bundle.categories.map((c) => [c.id, c])), [bundle.categories]);
  const tf = (bundle.prefs?.timeFormat as "12h" | "24h") ?? "12h";

  const todays = bundle.items.filter((i) => ymd(i.start) === key && i.status !== "done");
  const timed = todays.filter((i) => !i.allDay).sort((a, b) => a.start.getTime() - b.start.getTime());
  const allDay = todays.filter((i) => i.allDay);
  const doneToday = bundle.items.filter((i) => ymd(i.start) === key && i.status === "done").length
    + bundle.tasks.filter((t) => t.completedAt && ymd(new Date(t.completedAt)) === key).length;
  const wh = (bundle.prefs?.workingHours ?? null) as Record<number, [number, number] | null> | null;
  const workload = computeWorkload(bundle.items, today, wh);
  const conflicts = findConflicts(bundle.items, today);

  const myDayTasks = bundle.tasks.filter((t) => t.status !== "done" && t.status !== "cancelled" && (t.onToday || (t.dueDate && ymd(new Date(t.dueDate)) === key) || (t.scheduledStart && ymd(new Date(t.scheduledStart)) === key)));
  const remaining = myDayTasks.length + timed.filter((i) => i.kind.startsWith("task")).length;

  const next = [...bundle.items]
    .filter((i) => i.start.getTime() > nowMs && i.status !== "cancelled")
    .sort((a, b) => a.start.getTime() - b.start.getTime())[0];

  async function quickAdd() {
    if (!quick.trim()) return;
    setQuickError(null);
    try {
      if (quickType === "inbox") await addInboxItem(quick.trim(), quickPriority);
      else await createOwnerTask({ title: quick.trim(), dueDate: startOfManilaDayUTC().toISOString(), priority: quickPriority });
      setQuick("");
      setQuickPriority("normal");
      setTimeout(() => setQuickError(null), 2000);
    } catch (e) {
      setQuickError(e instanceof Error ? e.message : "Failed to add item");
    }
  }

  async function completeEvent(item: CalItem, mode: "occurrence" | "series") {
    await completeOwnerEvent(item.sourceId, mode, ymd(item.start));
  }

  const loadState = workload.minutes <= 240 ? "Light day" : workload.minutes <= 480 ? "Normal day" : "Busy day";

  return (
    <div className="p-4 sm:p-7 max-w-[1400px] mx-auto">
      {/* header */}
      <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
        <div>
          <p className="text-[10.5px] uppercase tracking-[0.3em] text-[var(--color-ow-text-faint)]">{fmtDateLong(today)}</p>
          <h1 className="font-serif text-3xl sm:text-[2.6rem] leading-tight mt-1 text-[var(--color-ow-text)]">Today at a glance</h1>
        </div>
        <p className="font-serif text-2xl tnum text-[var(--color-ow-text)]">{clock}</p>
      </div>

      {/* stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-2.5 mb-6 anim-fade-up">
        {[
          ["Scheduled work", fmtDuration(workload.minutes * 60000)],
          ["Appointments", String(workload.appointments)],
          ["Tasks remaining", String(remaining)],
          ["Completed", String(doneToday)],
          ["Overdue", String(overdue.length)],
          ["Day load", loadState],
        ].map(([l, v]) => (
          <div key={l} className="card-ow px-4 py-3.5">
            <p className="text-[17px] font-medium tnum" style={{ color: l === "Overdue" && overdue.length ? "var(--color-ow-rose)" : "var(--color-ow-text)" }}>{v}</p>
            <p className="text-[9.5px] uppercase tracking-[0.16em] text-[var(--color-ow-text-faint)] mt-1">{l}</p>
          </div>
        ))}
      </div>

      {/* next up */}
      {next && (
        <div className="card-ow p-4 mb-6 flex items-center gap-4">
          <div className="rounded-xl px-3.5 py-2.5 text-center shrink-0" style={{ background: "var(--color-ow-accent-soft)" }}>
            <p className="text-[9px] uppercase tracking-widest text-[var(--color-ow-accent)] opacity-80">Next</p>
            <p className="text-[13px] font-medium tnum mt-0.5 text-[var(--color-ow-accent)]">{next.allDay ? "All day" : fmtTime(next.start, tf)}</p>
          </div>
          <div className="min-w-0">
            <p className="text-[14px] font-medium truncate text-[var(--color-ow-text)]">{next.title}</p>
            <p className="text-[11.5px] text-[var(--color-ow-text-dim)] mt-0.5 truncate">
              {ymd(next.start) === key ? "Today" : ymd(next.start)} {next.location ? `· ${next.location}` : ""} {next.person ? `· ${next.person}` : ""}
            </p>
          </div>
        </div>
      )}

      {/* quick add */}
      <div className="card-ow p-3 mb-6 flex items-center gap-2">
        <Plus size={16} className="text-[var(--color-ow-text-faint)] ml-2 shrink-0" />
        <input
          value={quick} onChange={(e) => setQuick(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && quickAdd()}
          placeholder="Quick capture — “Call Mrs. Santos”, “Check Blüthner pinblock”…"
          className="flex-1 bg-transparent outline-none text-[13.5px] text-[var(--color-ow-text)] placeholder:text-[var(--color-ow-text-faint)] min-w-0"
        />
        <select value={quickType} onChange={(e) => setQuickType(e.target.value as "task" | "inbox")} className="input-ow !w-auto !py-2 text-[12px]">
          <option value="task">→ Task today</option>
          <option value="inbox">→ Inbox</option>
        </select>
        <select value={quickPriority} onChange={(e) => setQuickPriority(e.target.value)} className="input-ow !w-auto !py-2 text-[12px]">
          <option value="low">Low</option>
          <option value="normal">Normal</option>
          <option value="high">High</option>
          <option value="urgent">Urgent</option>
        </select>
        <button onClick={quickAdd} className="btn-ow-primary text-[12px] rounded-lg px-4 py-2 shrink-0">Add</button>
        <button onClick={() => setModal({})} className="flex items-center gap-1.5 text-[12px] text-[var(--color-ow-text-dim)] hover:text-[var(--color-ow-text)] rounded-lg px-3 py-2 transition shrink-0"
          style={{ border: "1px solid var(--color-ow-border)" }}>
          <CalendarPlus size={13} /> <span className="hidden sm:inline">Detailed</span>
        </button>
      </div>

      {conflicts.length > 0 && (
        <div className="mb-6 flex items-center gap-3 rounded-xl px-4 py-3 text-[12.5px]"
          style={{ background: "var(--color-ow-rose-soft)", border: "1px solid rgba(224,138,149,0.3)", color: "var(--color-ow-text)" }}>
          <AlertTriangle size={15} className="shrink-0" style={{ color: "var(--color-ow-rose)" }} />
          Schedule conflict detected — {conflicts.length} overlapping {conflicts.length === 1 ? "pair" : "pairs"} today. Times are yours; adjust when ready.
        </div>
      )}

      <div className="grid xl:grid-cols-[minmax(0,1fr)_330px] gap-5 items-start">
        {/* ============ schedule ============ */}
        <section className="card-ow overflow-hidden">
          <div className="px-5 py-4 flex items-center justify-between" style={{ borderBottom: "1px solid var(--color-ow-border)" }}>
            <p className="text-[10.5px] uppercase tracking-[0.22em] text-[var(--color-ow-text-faint)]">Today&apos;s schedule</p>
            <Link href="/owner/calendar" className="text-[11.5px] text-[var(--color-ow-text-dim)] hover:text-[var(--color-ow-text)] flex items-center gap-1">Open calendar <ArrowRight size={12} /></Link>
          </div>
          {allDay.length > 0 && (
            <div className="px-5 py-3 flex flex-wrap gap-2" style={{ borderBottom: "1px solid var(--color-ow-border)" }}>
              {allDay.map((i) => (
                <span key={i.key} className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11.5px] text-[var(--color-ow-text)]" style={{ background: "var(--color-ow-surface-2)" }}>
                  <KindGlyph kind={i.kind} /> {i.title}
                </span>
              ))}
            </div>
          )}
          {timed.length === 0 ? (
            <div className="p-6"><EmptyState title="Nothing scheduled today" body="A clear runway. Add an appointment, or pull tasks into time blocks from the calendar."
              action={<button onClick={() => setModal({})} className="btn-ow-primary text-[12px] rounded-lg px-4 py-2">Plan your day</button>} /></div>
          ) : (
            <ul>
              {timed.map((i) => {
                const conflicted = conflicts.some((c) => c.a === i.key || c.b === i.key);
                return (
                  <li key={i.key} className="flex items-center gap-4 px-5 py-3.5 last:border-0 group"
                    style={{ borderBottom: "1px solid var(--color-ow-border)", background: conflicted ? "var(--color-ow-rose-soft)" : undefined }}>
                    <div className="w-[86px] shrink-0 tnum">
                      <p className="text-[13px] font-medium text-[var(--color-ow-text)]">{fmtTime(i.start, tf)}</p>
                      {i.end && <p className="text-[10.5px] text-[var(--color-ow-text-faint)]">{fmtTime(i.end, tf)}</p>}
                    </div>
                    <KindGlyph kind={i.kind} />
                    <div className="flex-1 min-w-0">
                      <p className="text-[13.5px] truncate" style={{ color: i.kind === "focus" ? "var(--color-ow-violet)" : "var(--color-ow-text)", fontWeight: i.kind === "focus" ? 500 : 400 }}>
                        {i.title} {i.recurring && <Repeat2 size={11} className="inline ml-1" style={{ color: "var(--color-ow-text-faint)" }} />}
                      </p>
                      <p className="text-[11px] text-[var(--color-ow-text-dim)] mt-0.5 truncate flex items-center gap-2">
                        <CategoryChip category={catMap.get(i.categoryId ?? "")} />
                        {i.location && <span>· {i.location}</span>}
                        {i.person && <span>· {i.person}</span>}
                        {conflicted && <span style={{ color: "var(--color-ow-rose)" }}>· overlaps</span>}
                      </p>
                    </div>
                    <div className="opacity-0 group-hover:opacity-100 transition flex items-center gap-1 shrink-0">
                      {(i.kind === "event" || i.kind === "focus" || i.kind === "reminder") && (
                        <button title="Mark done"
                          onClick={() => (i.recurring ? setScope({ item: i, action: "complete" }) : completeEvent(i, "series"))}
                          className="p-1.5 transition text-[var(--color-ow-text-faint)] hover:text-[var(--color-ow-accent)]"><CheckCheck size={15} /></button>
                      )}
                      {i.kind.startsWith("task") ? (
                        <button title="Mark done" onClick={() => setOwnerTaskDone(i.sourceId, true)}
                          className="p-1.5 transition text-[var(--color-ow-text-faint)] hover:text-[var(--color-ow-accent)]"><CheckCheck size={15} /></button>
                      ) : null}
                      <button title="Delete"
                        onClick={() => (i.kind.startsWith("task") ? cancelOwnerTask(i.sourceId) : i.recurring ? setScope({ item: i, action: "delete" }) : deleteOwnerEvent(i.sourceId, "series"))}
                        className="p-1.5 transition text-[var(--color-ow-text-faint)] hover:text-[var(--color-ow-rose)]"><Trash2 size={15} /></button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* ============ rail ============ */}
        <div className="space-y-4">
          <section className="card-ow p-4">
            <p className="text-[10.5px] uppercase tracking-[0.22em] text-[var(--color-ow-text-faint)] mb-3">Today&apos;s tasks · {myDayTasks.length}</p>
            {myDayTasks.length === 0 ? <p className="text-[12px] text-[var(--color-ow-text-dim)]">Pull tasks into today from the Tasks page, or quick-capture above.</p> : (
              <ul className="space-y-2.5">
                {myDayTasks.map((t) => (
                  <li key={t.id} className="flex items-start gap-2.5 group">
                    <TaskCheck done={false} onToggle={() => setOwnerTaskDone(t.id, true)} />
                    <div className="flex-1 min-w-0">
                      <p className="text-[12.5px] leading-snug flex items-center gap-1.5 text-[var(--color-ow-text)]"><PriorityDot priority={t.priority} /> {t.title}</p>
                      <p className="text-[10.5px] text-[var(--color-ow-text-dim)] mt-0.5 flex items-center gap-2">
                        <CategoryChip category={catMap.get(t.categoryId ?? "")} />
                        {t.scheduledStart && <span>· ⏱ {fmtTime(new Date(t.scheduledStart), tf)}</span>}
                      </p>
                    </div>
                    {t.onToday && (
                      <button title="Remove from today" onClick={() => toggleOnToday(t.id, false)}
                        className="opacity-0 group-hover:opacity-100 transition text-[11px] text-[var(--color-ow-text-faint)] hover:text-[var(--color-ow-text-dim)]">✕</button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <Link href="/owner/tasks" className="block text-[11px] mt-3.5 pt-3 text-[var(--color-ow-text-dim)] hover:text-[var(--color-ow-text)]" style={{ borderTop: "1px solid var(--color-ow-border)" }}>All tasks →</Link>
          </section>

          {overdue.length > 0 && (
            <section className="card-ow p-4" style={{ borderColor: "rgba(224,138,149,0.3)" }}>
              <p className="text-[10.5px] uppercase tracking-[0.22em] mb-3 flex items-center gap-1.5" style={{ color: "var(--color-ow-rose)" }}><AlarmClock size={12} /> Overdue · {overdue.length}</p>
              <ul className="space-y-2.5">
                {overdue.slice(0, 4).map((t) => (
                  <li key={t.id}>
                    <div className="flex items-start gap-2.5">
                      <TaskCheck done={false} onToggle={() => setOwnerTaskDone(t.id, true)} />
                      <div className="flex-1 min-w-0">
                        <p className="text-[12.5px] leading-snug text-[var(--color-ow-text)]">{t.title}</p>
                        <p className="text-[10px] mt-0.5" style={{ color: "var(--color-ow-rose)" }}>due {t.dueDate ? ymd(new Date(t.dueDate)) : t.scheduledStart ? ymd(new Date(t.scheduledStart)) : ""}</p>
                      </div>
                    </div>
                    <div className="flex gap-1.5 mt-1.5 ml-7">
                      <button onClick={() => postponeOwnerTask(t.id, new Date().toISOString())} className="chip-ow text-[10px] rounded-md px-2 py-1 transition hover:text-[var(--color-ow-text)]">Today</button>
                      <button onClick={() => setReschedId(reschedId === t.id ? null : t.id)} className="chip-ow text-[10px] rounded-md px-2 py-1 transition hover:text-[var(--color-ow-text)]">Pick date</button>
                      <button onClick={() => cancelOwnerTask(t.id)} className="text-[10px] rounded-md px-2 py-1 transition" style={{ color: "var(--color-ow-rose)" }}>Cancel</button>
                    </div>
                    {reschedId === t.id && (
                      <input type="date" className="input-ow !py-1.5 !text-[11px] mt-1.5 ml-7 !w-auto"
                        onChange={(e) => { if (e.target.value) { postponeOwnerTask(t.id, new Date(`${e.target.value}T18:00`).toISOString()); setReschedId(null); } }} />
                    )}
                  </li>
                ))}
              </ul>
              <Link href="/owner/overdue" className="block text-[11px] mt-3.5 pt-3 text-[var(--color-ow-text-dim)] hover:text-[var(--color-ow-text)]" style={{ borderTop: "1px solid var(--color-ow-border)" }}>Overdue center →</Link>
            </section>
          )}

          <section className="card-ow p-4">
            <p className="text-[10.5px] uppercase tracking-[0.22em] text-[var(--color-ow-text-faint)] mb-3 flex items-center gap-1.5"><Inbox size={12} /> Inbox to process · {bundle.inbox.filter((i) => !i.processedAt).length}</p>
            <ul className="space-y-2">
              {bundle.inbox.filter((i) => !i.processedAt).slice(0, 3).map((i) => (
                <li key={i.id} className="text-[12.5px] leading-snug text-[var(--color-ow-text)]">• {i.title}</li>
              ))}
              {bundle.inbox.filter((i) => !i.processedAt).length === 0 && <li className="text-[12px] text-[var(--color-ow-text-dim)]">Everything captured has been processed.</li>}
            </ul>
            <Link href="/owner/inbox" className="block text-[11px] mt-3.5 pt-3 text-[var(--color-ow-text-dim)] hover:text-[var(--color-ow-text)]" style={{ borderTop: "1px solid var(--color-ow-border)" }}>Process inbox →</Link>
          </section>
        </div>
      </div>

      <ItemModal open={!!modal} onClose={() => setModal(null)} categories={bundle.categories} edit={modal?.edit} defaultTime={modal?.time} />
      <ScopeModal
        open={!!scope}
        action={scope?.action === "complete" ? "Marking done" : "Deleting"}
        onChoose={(m) => {
          if (m && scope) {
            if (scope.action === "complete") completeEvent(scope.item, m);
            else deleteOwnerEvent(scope.item.sourceId, m, ymd(scope.item.start));
          }
          setScope(null);
        }}
      />
    </div>
  );
}
