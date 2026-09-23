"use client";

import { useMemo, useState } from "react";
import { AlarmClock, CalendarX2 } from "lucide-react";
import { overdueTasksFrom, missedEvents, deserializeOwnerBundle, type OwnerBundle } from "@/lib/owner-utils";
import { ymd } from "@/lib/dates";
import { fmtTime } from "@/lib/format";
import { TaskCheck, PriorityDot, CategoryChip } from "@/components/owner-ui";
import { EmptyState } from "@/components/ui";
import { setOwnerTaskDone, postponeOwnerTask, cancelOwnerTask, completeOwnerEvent, deleteOwnerEvent } from "@/server/owner";

export default function OwnerOverdueClient({ bundle: rawBundle }: { bundle: OwnerBundle }) {
  const bundle = useMemo(() => deserializeOwnerBundle(rawBundle), [rawBundle]);
  const [reschedId, setReschedId] = useState<string | null>(null);
  const catMap = useMemo(() => new Map(bundle.categories.map((c) => [c.id, c])), [bundle.categories]);
  const [nowMs] = useState(() => Date.now());
  const overdue = overdueTasksFrom(bundle.tasks);
  const missed = missedEvents(bundle.items).filter((i) => !i.recurring);

  return (
    <div className="p-4 sm:p-7 max-w-3xl mx-auto">
      <div className="mb-6">
        <h1 className="font-serif text-2xl sm:text-3xl text-[var(--color-ow-text)]">Overdue</h1>
        <p className="text-[var(--color-ow-text-dim)] text-[12.5px] mt-1">Unfinished work never disappears silently — catch up, reschedule, or consciously cancel.</p>
      </div>

      <p className="text-[10.5px] uppercase tracking-[0.22em] mb-3 flex items-center gap-1.5" style={{ color: "var(--color-ow-rose)" }}><AlarmClock size={12} /> Overdue tasks · {overdue.length}</p>
      {overdue.length === 0 ? (
        <EmptyState title="Nothing overdue" body="Every task is on its schedule or consciously cancelled." />
      ) : (
        <ul className="card-ow ow-divide mb-8">
          {overdue
            .sort((a, b) => (a.dueDate?.getTime() ?? 0) - (b.dueDate?.getTime() ?? 0))
            .map((t) => {
              const days = Math.floor((nowMs - (t.dueDate ?? t.scheduledStart ?? t.createdAt).getTime()) / 86_400_000);
              return (
                <li key={t.id} className="px-4 py-3.5">
                  <div className="flex items-start gap-2.5">
                    <TaskCheck done={false} onToggle={() => setOwnerTaskDone(t.id, true)} />
                    <div className="flex-1 min-w-0">
                      <p className="text-[13.5px] leading-snug flex items-center gap-1.5 text-[var(--color-ow-text)]"><PriorityDot priority={t.priority} /> {t.title}</p>
                      <p className="text-[10.5px] mt-0.5" style={{ color: "var(--color-ow-rose)" }}>
                        {t.dueDate ? `due ${ymd(new Date(t.dueDate))}` : `scheduled ${ymd(new Date(t.scheduledStart!))}`} · {days}d late
                      </p>
                      <p className="text-[10.5px] text-[var(--color-ow-text-dim)] mt-0.5"><CategoryChip category={catMap.get(t.categoryId ?? "")} /></p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5 mt-2.5 ml-7">
                    <button onClick={() => postponeOwnerTask(t.id, new Date().toISOString())} className="chip-ow text-[11px] rounded-lg px-2.5 py-1.5 transition hover:text-[var(--color-ow-text)]">Move to today</button>
                    <button onClick={() => setReschedId(reschedId === t.id ? null : t.id)} className="chip-ow text-[11px] rounded-lg px-2.5 py-1.5 transition hover:text-[var(--color-ow-text)]">Reschedule…</button>
                    <button onClick={() => cancelOwnerTask(t.id)} className="text-[11px] rounded-lg px-2.5 py-1.5 transition" style={{ color: "var(--color-ow-rose)" }}>Cancel task</button>
                    {reschedId === t.id && (
                      <input type="date" autoFocus className="input-ow !w-auto !py-1 !text-[11.5px]"
                        onChange={(e) => { if (e.target.value) { postponeOwnerTask(t.id, new Date(`${e.target.value}T18:00`).toISOString()); setReschedId(null); } }} />
                    )}
                  </div>
                </li>
              );
            })}
        </ul>
      )}

      <p className="text-[10.5px] uppercase tracking-[0.22em] text-[var(--color-ow-text-faint)] mb-3 flex items-center gap-1.5"><CalendarX2 size={12} /> Missed appointments · {missed.length}</p>
      {missed.length === 0 ? <p className="text-[12px] text-[var(--color-ow-text-dim)]">No unattended appointments in the past two months.</p> : (
        <ul className="card-ow ow-divide">
          {missed.slice(0, 12).map((i) => (
            <li key={i.key} className="px-4 py-3 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-[13px] truncate text-[var(--color-ow-text)]">{i.title}</p>
                <p className="text-[10.5px] text-[var(--color-ow-text-faint)] mt-0.5 tnum">{ymd(i.start)} {fmtTime(i.start)}{i.person ? ` · ${i.person}` : ""}</p>
              </div>
              <button onClick={() => completeOwnerEvent(i.sourceId, "series")} className="text-[11px] rounded-lg px-2.5 py-1.5 transition shrink-0"
                style={{ background: "var(--color-ow-accent-soft)", color: "var(--color-ow-accent)", border: "1px solid rgba(79,184,171,0.3)" }}>It happened</button>
              <button onClick={() => deleteOwnerEvent(i.sourceId, "series")} className="text-[11px] px-2 py-1.5 transition shrink-0 text-[var(--color-ow-text-faint)] hover:text-[var(--color-ow-rose)]">Dismiss</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
