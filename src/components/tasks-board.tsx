"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { LayoutGrid, Rows3, Search, Plus, Clock3, CalendarDays, Trash2, X } from "lucide-react";
import type { TaskRow } from "@/server/data";
import type { Worker } from "@/db/schema";
import { TASK_COLUMNS, TASK_LABEL, PRIORITY_STYLE } from "@/lib/config";
import { fmtDate, fmtDuration, toDateInput } from "@/lib/format";
import { matchesTaskFilter, parseTaskFilter } from "@/lib/dashboard";
import { Modal, Field, Spinner, EmptyState, Avatar } from "@/components/ui";
import {
  createTask, updateTask, deleteTask, archiveTask, restoreTask, setTaskStatus, type TaskInput,
  createAssignedWork, createProjectWork, createOpenWork,
} from "@/server/admin";

/** Compact "Jun +1" style label for a list of assignee names — keeps single/none display unchanged. */
function assigneeLabel(names: string[]): string | null {
  if (names.length === 0) return null;
  if (names.length === 1) return names[0];
  return `${names[0].split(" ")[0]} +${names.length - 1}`;
}

type ProjOpt = { id: string; clientName: string; pianoBrand: string; pianoModel: string };

const BLANK: TaskInput = { title: "", priority: "normal", estimatedMinutes: 60, status: "available", projectId: null, assignedWorkerId: null, dueDate: "" };

type BoardProps = { tasks: TaskRow[]; workers: Worker[]; projects: ProjOpt[] };

export default function TasksBoard(props: BoardProps) {
  const sp = useSearchParams();
  return <TaskBoardContent key={sp.toString()} {...props} />;
}

function TaskBoardContent({ tasks, workers, projects }: BoardProps) {
  const sp = useSearchParams();
  const selected = tasks.find((t) => t.id === sp.get("sel"));

  // Dashboard links arrive as /admin/tasks?status=available|overdue|parts — a cross-cutting list view.
  const urlFilter = parseTaskFilter(sp.get("status"));
  const [nowMs] = useState(() => Date.now());
  const [view, setView] = useState<"kanban" | "list">(urlFilter ? "list" : "kanban");
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<"standalone" | "project">(!urlFilter && selected?.projectId ? "project" : "standalone");
  const [archived, setArchived] = useState(!urlFilter && !!selected?.archivedAt);
  const [error, setError] = useState("");
  const [projectFilter, setProjectFilter] = useState("all");
  const [workerFilter, setWorkerFilter] = useState("all");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [modal, setModal] = useState<null | { id?: string; data: TaskInput }>(() => selected ? { id: selected.id, data: toInput(selected) } : sp.get("new") === "1" ? { data: { ...BLANK, kind: "standalone" } } : null);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [bulkMode, setBulkMode] = useState<null | "assign" | "project" | "open">(null);

  function toInput(t: TaskRow): TaskInput {
    return {
      kind: t.projectId ? "project" : "standalone",
      projectId: t.projectId, title: t.title, description: t.description ?? "",
      priority: t.priority, assignedWorkerId: t.assignedWorkerId, estimatedMinutes: t.estimatedMinutes,
      dueDate: t.dueDate ? toDateInput(new Date(t.dueDate)) : "", status: t.status, waitingParts: t.waitingParts,
    };
  }

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return tasks.filter((t) => {
      if (urlFilter) {
        if (t.archivedAt || !matchesTaskFilter(t, urlFilter, nowMs)) return false;
      } else if (!!t.projectId !== (kind === "project") || !!t.archivedAt !== archived) return false;
      if (kind === "project" && projectFilter !== "all" && t.projectId !== projectFilter) return false;
      if (workerFilter !== "all" && t.assignedWorkerId !== workerFilter && t.claimedByWorkerId !== workerFilter) return false;
      if (priorityFilter !== "all" && t.priority !== priorityFilter) return false;
      if (!needle) return true;
      return [t.title, t.description, t.projectName, t.pianoName].filter(Boolean).join(" ").toLowerCase().includes(needle);
    });
  }, [tasks, q, projectFilter, workerFilter, priorityFilter, kind, archived, urlFilter, nowMs]);

  async function moveTask(id: string, status: string) {
    if (busy || archived) return;
    setBusy(true); setError("");
    try {
      const result = await setTaskStatus(id, status);
      if (!result.ok) { setError(result.error); return; }
    } catch { setError("Could not move task. Please try again."); }
    finally { setBusy(false); }
  }

  async function save() {
    if (!modal) return;
    setBusy(true); setError("");
    try {
      const result = modal.id ? await updateTask(modal.id, modal.data) : await createTask(modal.data);
      if (!result.ok) { setError(result.error); return; }
      if (!modal.id) setArchived(false);
      setModal(null);
    } catch { setError("Could not save task. Check the fields and try again."); }
    finally { setBusy(false); }
  }

  async function manage(action: "archive" | "restore" | "delete") {
    if (!modal?.id || busy) return;
    setBusy(true); setError("");
    try {
      const result = await (action === "archive" ? archiveTask(modal.id) : action === "restore" ? restoreTask(modal.id) : deleteTask(modal.id));
      if (!result.ok) { setError("error" in result ? String(result.error) : "Action failed."); return; }
      setModal(null);
    } catch { setError("Could not update this task. Please try again."); }
    finally { setBusy(false); }
  }

  const modalArchived = !!tasks.find((t) => t.id === modal?.id)?.archivedAt;

  const inp = "input-dark";
  const activeWorkers = workers.filter((w) => w.active);

  const card = (t: TaskRow) => {
    const p = PRIORITY_STYLE[t.priority] ?? PRIORITY_STYLE.normal;
    const overdue = t.status !== "done" && t.dueDate && new Date(t.dueDate) < new Date();
    return (
      <button
        key={t.id}
        draggable={!archived && !busy}
        onDragStart={(e) => e.dataTransfer.setData("text/plain", t.id)}
        onClick={() => setModal({ id: t.id, data: toInput(t) })}
        className={`card-dark w-full text-left p-3.5 hover:border-white/25 transition cursor-grab active:cursor-grabbing ${t.status === "done" ? "opacity-50" : ""}`}
      >
        <div className="flex items-start justify-between gap-2">
          <p className={`text-[13px] leading-snug ${t.status === "done" ? "line-through text-mist" : "text-white"}`}>{t.title}</p>
          <span className={`mt-1 w-1.5 h-1.5 rounded-full shrink-0 ${p.dot}`} title={p.label} />
        </div>
        <p className="text-xs text-mist mt-1">{t.pianoName ?? "Shop-wide"}{t.projectName ? ` · ${t.projectName}` : ""}</p>
        <div className="flex items-center flex-wrap gap-x-3 gap-y-1 mt-2.5 text-xs text-mist">
          <span className="flex items-center gap-1"><Clock3 size={11} /> {fmtDuration(t.estimatedMinutes * 60000)}</span>
          {t.dueDate && <span className={`flex items-center gap-1 ${overdue ? "text-rose-400" : ""}`}><CalendarDays size={11} /> {fmtDate(new Date(t.dueDate))}</span>}
          {t.waitingParts && <span className="text-amber-300 uppercase tracking-wide">parts</span>}
        </div>
        {(t.claimedName || t.assigneeNames.length > 0) && (
          <div className="flex items-center gap-2 mt-2.5">
            <Avatar name={(t.claimedName ?? t.assigneeNames[0])!} size={18} />
            <span className="text-xs text-chrome/80">{t.claimedName ? `${t.claimedName.split(" ")[0]} (claimed)` : assigneeLabel(t.assigneeNames)}</span>
          </div>
        )}
      </button>
    );
  };

  return (
    <div className="p-4 sm:p-7 max-w-[1600px] mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div>
          <h1 className="font-serif text-2xl sm:text-3xl text-white">Tasks</h1>
          <p className="text-mist text-[12.5px] mt-1">The heartbeat of the shop — what happens next, and who does it.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => setBulkMode("assign")}
            className="flex items-center gap-2 rounded-xl border border-white/20 text-[12.5px] px-4 py-2.5 text-chrome hover:bg-white/[0.06] transition">
            <Plus size={15} /> Assign Work
          </button>
          <button onClick={() => setBulkMode("project")}
            className="flex items-center gap-2 rounded-xl border border-white/20 text-[12.5px] px-4 py-2.5 text-chrome hover:bg-white/[0.06] transition">
            <Plus size={15} /> Project Work
          </button>
          <button onClick={() => setBulkMode("open")}
            className="flex items-center gap-2 rounded-xl border border-white/20 text-[12.5px] px-4 py-2.5 text-chrome hover:bg-white/[0.06] transition">
            <Plus size={15} /> Open Work for All
          </button>
          <button onClick={() => { setError(""); setModal({ data: { ...BLANK, kind, projectId: kind === "project" && projectFilter !== "all" ? projectFilter : null } }); }}
            className="flex items-center gap-2 bg-[#22C55E] text-[#04210F] min-h-11 cursor-pointer text-[12.5px] font-medium rounded-xl px-4 py-2.5 hover:brightness-110 transition">
            <Plus size={15} /> Create Task
          </button>
        </div>
      </div>

      {urlFilter && (
        <div className="flex flex-wrap items-center gap-3 mb-5 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-[13px]">
          <span className="text-chrome">
            Showing {{ available: "unclaimed tasks", overdue: "overdue tasks", parts: "tasks waiting on parts" }[urlFilter]} · {filtered.length}
          </span>
          <Link href="/admin/tasks" className="ml-auto inline-flex items-center gap-1.5 text-white underline underline-offset-4 decoration-white/30 hover:decoration-white">
            <X size={13} /> Show all tasks
          </Link>
        </div>
      )}
      <div className={`flex flex-wrap items-center gap-3 mb-5 ${urlFilter ? "hidden" : ""}`}>
        <div className="flex rounded-xl border border-white/10 bg-white/[0.04] p-1" aria-label="Task type">
          {([['standalone', 'Task'], ['project', 'Project + Task']] as const).map(([value, label]) => (
            <button key={value} aria-pressed={kind === value} onClick={() => { setKind(value); setProjectFilter("all"); setError(""); }}
              className={`rounded-lg px-4 py-2 text-[13px] transition ${kind === value ? "bg-[#22C55E] text-[#04210F] min-h-11 cursor-pointer font-medium" : "text-mist hover:text-white"}`}>
              {label} <span className="ml-1.5 opacity-60">{tasks.filter((t) => !!t.projectId === (value === "project") && !!t.archivedAt === archived).length}</span>
            </button>
          ))}
        </div>
        <div className="flex gap-1 ml-auto" aria-label="Task archive filter">
          {([false, true] as const).map((value) => <button key={String(value)} aria-pressed={archived === value} onClick={() => setArchived(value)}
            className={`rounded-lg px-3 py-2 text-xs ${archived === value ? "bg-white/10 text-white" : "text-mist"}`}>{value ? "Archived" : "Current"}</button>)}
        </div>
      </div>
      <p className="text-xs text-mist mb-4">{archived ? "Reviewed tasks kept for reference. Restore returns them to Done." : "Done tasks stay crossed out until you review and archive or delete them."}</p>
      {error && !modal && <p role="alert" className="text-rose-400 text-sm mb-4">{error}</p>}

      <div className="flex flex-wrap items-center gap-2.5 mb-5">
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-mist" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search tasks…" className="input-dark pl-9!" />
        </div>
        {kind === "project" && <select aria-label="Filter project" value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)} className="input-dark sm:w-auto! sm:max-w-[200px]">
          <option value="all">All projects</option>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.pianoBrand} {p.pianoModel} — {p.clientName}</option>)}
        </select>}
        <select aria-label="Filter worker" value={workerFilter} onChange={(e) => setWorkerFilter(e.target.value)} className="input-dark sm:w-auto!">
          <option value="all">All workers</option>
          {activeWorkers.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
        <select aria-label="Filter priority" value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)} className="input-dark sm:w-auto!">
          <option value="all">Any priority</option>
          <option value="urgent">Urgent</option><option value="high">High</option><option value="normal">Normal</option><option value="low">Low</option>
        </select>
        {!archived && <div className="ml-auto flex bg-white/[0.05] border border-white/10 rounded-xl p-1">
          {([["kanban", LayoutGrid], ["list", Rows3]] as const).map(([v, Icon]) => (
            <button key={v} onClick={() => setView(v)}
              className={`px-3.5 py-1.5 rounded-lg text-[12px] flex items-center gap-1.5 transition ${view === v ? "bg-[#22C55E] text-[#04210F] min-h-11 cursor-pointer font-medium" : "text-mist hover:text-white"}`}>
              <Icon size={13} /> {v === "kanban" ? "Kanban" : "List"}
            </button>
          ))}
        </div>}
      </div>

      {filtered.length === 0 && <EmptyState title="No tasks match" body="Create a task or relax the filters." />}

      {!archived && view === "kanban" && filtered.length > 0 && (
        <div className="flex gap-3.5 overflow-x-auto pb-4 no-scrollbar anim-fade-in">
          {TASK_COLUMNS.map((col) => {
            const cards = filtered.filter((t) => t.status === col.key);
            return (
              <div key={col.key}
                className={`w-[272px] shrink-0 ${dragOver === col.key ? "kb-col-dragover" : ""}`}
                onDragOver={(e) => { e.preventDefault(); setDragOver(col.key); }}
                onDragLeave={() => setDragOver((d) => (d === col.key ? null : d))}
                onDrop={(e) => { e.preventDefault(); setDragOver(null); const id = e.dataTransfer.getData("text/plain"); if (id) moveTask(id, col.key); }}
              >
                <div className="flex items-center justify-between px-1.5 mb-2.5">
                  <p className="text-xs uppercase tracking-[0.18em] text-mist">{col.label}</p>
                  <span className="text-xs text-mist tnum">{cards.length}</span>
                </div>
                <div className="space-y-2.5 min-h-[120px]">{cards.map(card)}</div>
              </div>
            );
          })}
        </div>
      )}

      {(view === "list" || archived) && filtered.length > 0 && (
        <div className="card-dark overflow-x-auto anim-fade-in thin-scroll">
          <table className="w-full text-[12.5px] min-w-[900px]">
            <thead>
              <tr className="text-left text-xs uppercase tracking-[0.16em] text-mist border-b border-white/[0.07]">
                {["Task", "Project / Piano", "Status", "Priority", "Est.", "Due", "Assigned", "Claimed by"].map((h) => (
                  <th key={h} className="px-4 py-3 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((t) => {
                const p = PRIORITY_STYLE[t.priority] ?? PRIORITY_STYLE.normal;
                const overdue = t.status !== "done" && t.dueDate && new Date(t.dueDate) < new Date();
                return (
                  <tr key={t.id} onClick={() => setModal({ id: t.id, data: toInput(t) })} className="border-b border-white/[0.04] hover:bg-white/[0.035] cursor-pointer transition-colors">
                    <td className={`px-4 py-3.5 max-w-[260px] ${t.status === "done" ? "line-through text-mist" : "text-white"}`}>{t.title}</td>
                    <td className="px-4 py-3.5 text-mist">{t.pianoName ?? "Shop"}{t.projectName ? ` · ${t.projectName}` : ""}</td>
                    <td className="px-4 py-3.5"><span className="bg-white/[0.07] border border-white/10 rounded-full px-2.5 py-1 text-xs">{TASK_LABEL[t.status]}</span></td>
                    <td className="px-4 py-3.5"><span className={`flex items-center gap-1.5 text-xs ${p.text}`}><span className={`w-1.5 h-1.5 rounded-full ${p.dot}`} />{p.label}</span></td>
                    <td className="px-4 py-3.5 text-mist tnum">{fmtDuration(t.estimatedMinutes * 60000)}</td>
                    <td className={`px-4 py-3.5 tnum ${overdue ? "text-rose-400" : "text-mist"}`}>{t.dueDate ? fmtDate(new Date(t.dueDate)) : "—"}</td>
                    <td className="px-4 py-3.5 text-chrome">{assigneeLabel(t.assigneeNames) ?? "—"}</td>
                    <td className="px-4 py-3.5 text-chrome">{t.claimedName ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* create / edit modal */}
      <Modal open={!!modal} onClose={() => { if (!busy) { setModal(null); setError(""); } }} title={modalArchived ? "Archived task" : modal?.id ? "Review / edit task" : kind === "project" ? "Create project task" : "Create task"} wide>
        {modal && (
          <div className="grid sm:grid-cols-2 gap-3.5">
            <fieldset disabled={busy || modalArchived} className="contents">
            <div className="sm:col-span-2"><Field label="Title"><input className={inp} value={modal.data.title} onChange={(e) => setModal({ ...modal, data: { ...modal.data, title: e.target.value } })} placeholder="e.g. Hang bass strings" /></Field></div>
            {(modal.data.kind === "project" || !!modal.data.projectId) && <Field label="Project">
              <select className={inp} value={modal.data.projectId ?? ""} onChange={(e) => setModal({ ...modal, data: { ...modal.data, projectId: e.target.value || null } })}>
                <option value="">Choose a project</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.pianoBrand} {p.pianoModel} — {p.clientName}</option>)}
              </select>
            </Field>}
            <Field label="Status">
              <select className={inp} value={modal.data.status} onChange={(e) => setModal({ ...modal, data: { ...modal.data, status: e.target.value } })}>
                {TASK_COLUMNS.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
              </select>
            </Field>
            <Field label="Priority">
              <select className={inp} value={modal.data.priority} onChange={(e) => setModal({ ...modal, data: { ...modal.data, priority: e.target.value } })}>
                <option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option>
              </select>
            </Field>
            <Field label="Assign to">
              <select className={inp} value={modal.data.assignedWorkerId ?? ""} onChange={(e) => setModal({ ...modal, data: { ...modal.data, assignedWorkerId: e.target.value || null } })}>
                <option value="">Anyone (leave in pool)</option>
                {activeWorkers.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </Field>
            <Field label="Estimated minutes"><input className={inp} type="number" min={5} step={5} value={modal.data.estimatedMinutes ?? 60} onChange={(e) => setModal({ ...modal, data: { ...modal.data, estimatedMinutes: Number(e.target.value) } })} /></Field>
            <Field label="Due date"><input className={inp} type="date" value={modal.data.dueDate ?? ""} onChange={(e) => setModal({ ...modal, data: { ...modal.data, dueDate: e.target.value } })} /></Field>
            <div className="sm:col-span-2"><Field label="Description"><textarea className={`${inp} min-h-[70px]`} value={modal.data.description ?? ""} onChange={(e) => setModal({ ...modal, data: { ...modal.data, description: e.target.value } })} /></Field></div>
            <label className="sm:col-span-2 flex items-center gap-2.5 text-[12.5px] text-chrome cursor-pointer">
              <input type="checkbox" checked={modal.data.waitingParts ?? false} onChange={(e) => setModal({ ...modal, data: { ...modal.data, waitingParts: e.target.checked } })} className="accent-white" />
              This task is waiting on parts
            </label>
            </fieldset>
            {error && <p role="alert" className="sm:col-span-2 text-rose-400 text-xs">{error}</p>}
            <div className="sm:col-span-2 flex flex-wrap gap-2 mt-1">
              {!modalArchived && <button onClick={save} disabled={busy || !modal.data.title.trim() || (modal.data.kind === "project" && !modal.data.projectId)}
                className="flex-1 bg-[#22C55E] text-[#04210F] min-h-11 cursor-pointer text-[13px] font-medium rounded-xl py-3 hover:brightness-110 transition disabled:opacity-50 flex items-center justify-center gap-2">
                {busy && <Spinner className="text-black" />} {modal.id ? "Save changes" : "Create task"}
              </button>}
              {modal.id && (modalArchived ? (
                <button disabled={busy} onClick={() => manage("restore")} className="rounded-xl border border-white/20 px-4 py-3 text-sm disabled:opacity-50">Restore to Done</button>
              ) : tasks.find((t) => t.id === modal.id)?.status === "done" && (
                <button disabled={busy} onClick={() => manage("archive")} className="rounded-xl border border-white/20 px-4 py-3 text-sm disabled:opacity-50">Archive reviewed task</button>
              ))}
              {modal.id && (
                <button disabled={busy} onClick={() => manage("delete")}
                  className="px-4 py-3 rounded-xl border border-rose-500/25 text-rose-400 hover:bg-rose-500/10 transition disabled:opacity-50 flex items-center gap-2 text-xs"><Trash2 size={15} /> Delete permanently</button>
              )}
            </div>
          </div>
        )}
      </Modal>

      {bulkMode && (
        <RapidWorkModal
          mode={bulkMode}
          workers={activeWorkers}
          projects={projects}
          onClose={() => setBulkMode(null)}
        />
      )}
    </div>
  );
}

type RapidWorkMode = "assign" | "project" | "open";

function RapidWorkModal({
  mode, workers, projects, onClose,
}: {
  mode: RapidWorkMode;
  workers: Worker[];
  projects: ProjOpt[];
  onClose: () => void;
}) {
  const [items, setItems] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [workerIds, setWorkerIds] = useState<string[]>([]);
  const [projectId, setProjectId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  function commitDraft() {
    const value = draft.trim();
    if (!value) return;
    setItems((prev) => [...prev, value]);
    setDraft("");
    inputRef.current?.focus();
  }

  function toggleWorker(id: string) {
    setWorkerIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  const needsWorkers = mode === "assign" || mode === "project";
  const canSubmit = items.length > 0 && (!needsWorkers || workerIds.length > 0) && (mode !== "project" || !!projectId);

  async function submit() {
    if (!canSubmit || busy) return;
    setBusy(true); setError("");
    try {
      const result =
        mode === "assign" ? await createAssignedWork({ titles: items, workerIds })
        : mode === "project" ? await createProjectWork({ projectId, titles: items, workerIds })
        : await createOpenWork({ titles: items });
      if (!result.ok) { setError(result.error); return; }
      onClose();
    } catch { setError("Could not create work. Please try again."); }
    finally { setBusy(false); }
  }

  const title = mode === "assign" ? "Assign work" : mode === "project" ? "Project work" : "Open work for all";
  const inp = "input-dark";

  return (
    <Modal open onClose={() => { if (!busy) onClose(); }} title={title}>
      <div className="space-y-3.5">
        {mode === "project" && (
          <Field label="Project">
            <select className={inp} value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">Choose a project</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.pianoBrand} {p.pianoModel} — {p.clientName}</option>)}
            </select>
          </Field>
        )}

        {needsWorkers && (
          <Field label="Assign to">
            <div className="flex flex-wrap gap-1.5">
              {workers.map((w) => (
                <button
                  key={w.id}
                  type="button"
                  onClick={() => toggleWorker(w.id)}
                  aria-pressed={workerIds.includes(w.id)}
                  className={`flex items-center gap-1.5 rounded-full pl-1 pr-3 py-1 text-[12px] border transition ${
                    workerIds.includes(w.id) ? "bg-[#22C55E] text-[#04210F] border-[#22C55E] font-medium" : "border-white/15 text-mist hover:text-white"
                  }`}
                >
                  <Avatar name={w.name} url={w.avatarUrl} size={20} />
                  {w.name.split(" ")[0]}
                </button>
              ))}
            </div>
          </Field>
        )}

        <Field label="Work items">
          <input
            ref={inputRef}
            className={inp}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commitDraft(); } }}
            placeholder="Type an item and press Enter…"
          />
        </Field>
        {items.length > 0 && (
          <ul className="flex flex-col gap-1.5">
            {items.map((item, i) => (
              <li key={i} className="flex items-center justify-between gap-2 bg-white/[0.05] border border-white/10 rounded-lg px-3 py-2 text-[12.5px] text-chrome">
                <span className="flex-1">{item}</span>
                <button type="button" onClick={() => setItems((prev) => prev.filter((_, idx) => idx !== i))} className="text-mist hover:text-white">
                  <X size={13} />
                </button>
              </li>
            ))}
          </ul>
        )}

        {error && <p role="alert" className="text-rose-400 text-xs">{error}</p>}

        <button
          onClick={submit}
          disabled={busy || !canSubmit}
          className="w-full bg-[#22C55E] text-[#04210F] min-h-11 cursor-pointer text-[13px] font-medium rounded-xl py-3 hover:brightness-110 transition disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {busy && <Spinner className="text-black" />} Assign
        </button>
      </div>
    </Modal>
  );
}
