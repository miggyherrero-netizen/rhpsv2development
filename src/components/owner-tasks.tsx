"use client";

import { useMemo, useState } from "react";
import { Plus, Sun, Repeat2, Trash2, CalendarClock } from "lucide-react";
import type { OwnerBundle } from "@/lib/owner-utils";
import { deserializeOwnerBundle } from "@/lib/owner-utils";
import type { OwnerTask } from "@/db/schema";
import { ymd, startOfDay } from "@/lib/dates";
import { fmtTime } from "@/lib/format";
import { ItemModal, TaskCheck, CategoryChip, PriorityDot, taskToEdit, type ItemEdit } from "@/components/owner-ui";
import { setOwnerTaskDone, deleteOwnerTask, toggleOnToday } from "@/server/owner";
import { EmptyState } from "@/components/ui";

export default function OwnerTasksClient({ bundle: rawBundle }: { bundle: OwnerBundle }) {
  const bundle = useMemo(() => deserializeOwnerBundle(rawBundle), [rawBundle]);
  const [statusF, setStatusF] = useState("active");
  const [prioF, setPrioF] = useState("all");
  const [catF, setCatF] = useState("all");
  const [q, setQ] = useState("");
  const [modal, setModal] = useState<null | { edit?: ItemEdit }>(null);

  const catMap = useMemo(() => new Map(bundle.categories.map((c) => [c.id, c])), [bundle.categories]);
  const today = startOfDay(new Date());
  const tf = (bundle.prefs?.timeFormat as "12h" | "24h") ?? "12h";

  const tasks = bundle.tasks.filter((t) => {
    if (statusF === "active" && (t.status === "done" || t.status === "cancelled")) return false;
    if (statusF === "done" && t.status !== "done") return false;
    if (prioF !== "all" && t.priority !== prioF) return false;
    if (catF !== "all" && t.categoryId !== catF) return false;
    const needle = q.trim().toLowerCase();
    if (needle && ![t.title, t.notes, t.description].filter(Boolean).join(" ").toLowerCase().includes(needle)) return false;
    return true;
  });

  const groups: { label: string; tasks: OwnerTask[]; cls: string }[] = [
    { label: "Overdue", cls: "text-[var(--color-ow-rose)]", tasks: tasks.filter((t) => !t.recurrence && ((t.dueDate && startOfDay(new Date(t.dueDate)) < today) || (t.scheduledStart && startOfDay(new Date(t.scheduledStart)) < today))) },
    { label: "Today", cls: "text-[var(--color-ow-text-dim)]", tasks: tasks.filter((t) => !groupsFilter(t, "overdue") && (t.onToday || (t.dueDate && ymd(new Date(t.dueDate)) === ymd(today)) || (t.scheduledStart && ymd(new Date(t.scheduledStart)) === ymd(today)))) },
    { label: "Upcoming", cls: "text-[var(--color-ow-text-dim)]", tasks: tasks.filter((t) => !groupsFilter(t, "overdue") && !groupsFilter(t, "today") && (t.dueDate || t.scheduledStart)) },
    { label: "Someday · no date", cls: "text-[var(--color-ow-text-faint)]", tasks: tasks.filter((t) => !groupsFilter(t, "overdue") && !groupsFilter(t, "today") && !t.dueDate && !t.scheduledStart) },
  ];

  function groupsFilter(t: OwnerTask, what: "overdue" | "today") {
    if (t.recurrence) return false;
    const od = (t.dueDate && startOfDay(new Date(t.dueDate)) < today) || (t.scheduledStart && startOfDay(new Date(t.scheduledStart)) < today);
    if (what === "overdue") return !!od;
    return !od && (t.onToday || (t.dueDate && ymd(new Date(t.dueDate)) === ymd(today)) || (t.scheduledStart && ymd(new Date(t.scheduledStart)) === ymd(today)));
  }

  const inp = "input-ow";

  return (
    <div className="p-4 sm:p-7 app-page app-page-list [--page-w:768px]">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div>
          <h1 className="font-serif text-2xl sm:text-3xl text-[var(--color-ow-text)]">Tasks</h1>
          <p className="text-[var(--color-ow-text-dim)] text-[13px] mt-1">Your personal action list — dates optional, never lost.</p>
        </div>
        <button onClick={() => setModal({})} className="btn-ow-primary flex items-center gap-1.5 text-[14px] rounded-[10px] px-5 shrink-0">
          <Plus size={14} /> Add task
        </button>
      </div>

      <div className="flex flex-wrap gap-2 mb-5">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search tasks…" aria-label="Search tasks" className={`${inp} flex-1 min-w-[160px]`} />
        <select aria-label="Status filter" value={statusF} onChange={(e) => setStatusF(e.target.value)} className={`${inp} !w-auto`}>
          <option value="active">Active</option>
          <option value="done">Completed</option>
          <option value="all">Everything</option>
        </select>
        <select aria-label="Priority filter" value={prioF} onChange={(e) => setPrioF(e.target.value)} className={`${inp} !w-auto`}>
          <option value="all">Any priority</option>
          <option value="urgent">Urgent</option><option value="high">High</option><option value="normal">Normal</option><option value="low">Low</option>
        </select>
        <select aria-label="Category filter" value={catF} onChange={(e) => setCatF(e.target.value)} className={`${inp} !w-auto`}>
          <option value="all">All categories</option>
          {bundle.categories.filter((c) => !c.hidden).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      {tasks.length === 0 ? (
        <EmptyState title="Nothing here" body="Add a task, or capture thoughts in the Inbox and convert them later."
          action={<button onClick={() => setModal({})} className="btn-ow-primary text-[14px] rounded-[10px] px-5">Add task</button>} />
      ) : (
        <div className="space-y-6">
          {groups.map((g) => g.tasks.length > 0 && (
            <section key={g.label}>
              <p className={`text-[12px] uppercase tracking-[0.1em] mb-2.5 ${g.cls}`}>{g.label} · {g.tasks.length}</p>
              <ul className="card-ow ow-divide">
                {g.tasks
                  .sort((a, b) => (a.dueDate?.getTime() ?? a.scheduledStart?.getTime() ?? Infinity) - (b.dueDate?.getTime() ?? b.scheduledStart?.getTime() ?? Infinity))
                  .map((t) => {
                    const overdue = (t.dueDate && startOfDay(new Date(t.dueDate)) < today) || (t.scheduledStart && startOfDay(new Date(t.scheduledStart)) < today);
                    const done = t.status === "done";
                    return (
                      <li key={t.id} className={`flex items-center gap-1 px-3 py-1.5 group ${done ? "ow-done" : ""}`}>
                        <TaskCheck done={done} onToggle={() => setOwnerTaskDone(t.id, !done)} />
                        <div className="flex-1 min-w-0 cursor-pointer rounded-lg" role="button" tabIndex={0} onClick={() => setModal({ edit: taskToEdit(t) })} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setModal({ edit: taskToEdit(t) }); } }}>
                          <p className={`text-[14px] leading-snug flex items-center gap-1.5 text-[var(--color-ow-text)] ${done ? "line-through" : ""}`}>
                            <PriorityDot priority={t.priority} /> {t.title}
                            {t.recurrence && <Repeat2 size={11} className="text-[var(--color-ow-text-faint)]" />}
                          </p>
                          <p className="text-[12px] text-[var(--color-ow-text-dim)] mt-0.5 flex items-center gap-2 flex-wrap">
                            <CategoryChip category={catMap.get(t.categoryId ?? "")} />
                            {t.dueDate && <span style={overdue && !done ? { color: "var(--color-ow-rose)", fontWeight: 500 } : undefined}>due {ymd(new Date(t.dueDate))}</span>}
                            {t.scheduledStart && (
                              <span className="flex items-center gap-1"><CalendarClock size={10} /> {ymd(new Date(t.scheduledStart))} {fmtTime(new Date(t.scheduledStart), tf)}</span>
                            )}
                            {!t.dueDate && !t.scheduledStart && !done && <span className="text-[var(--color-ow-text-faint)]">no date — drag onto calendar</span>}
                          </p>
                        </div>
                        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 pointer-coarse:opacity-100 transition shrink-0">
                          <button title={t.onToday ? "Remove from today" : "Focus today"} aria-label={t.onToday ? "Remove from today" : "Focus today"} onClick={() => toggleOnToday(t.id, !t.onToday)}
                            className="ow-icon-btn transition" style={{ color: t.onToday ? "var(--color-ow-accent-text)" : "var(--color-ow-text-faint)" }}><Sun size={14} /></button>
                          <button title="Delete" aria-label="Delete" onClick={() => deleteOwnerTask(t.id)} className="ow-icon-btn transition text-[var(--color-ow-text-faint)] hover:text-[var(--color-ow-rose)]"><Trash2 size={14} /></button>
                        </div>
                      </li>
                    );
                  })}
              </ul>
            </section>
          ))}
        </div>
      )}

      <ItemModal open={!!modal} onClose={() => setModal(null)} categories={bundle.categories} edit={modal?.edit} />
    </div>
  );
}
