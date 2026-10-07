"use client";

import { useEffect, useMemo, useState, useRef } from "react";
import { useSearchParams } from "next/navigation";
import {
  LayoutGrid, Rows3, Search, Plus, ArrowUpDown, Copy, Check, Trash2, Pencil, Link2, ChevronRight,
} from "lucide-react";
import type { ProjectRow } from "@/server/data";
import type { Worker } from "@/db/schema";
import { PROJECT_STAGES, STAGE_LABEL } from "@/lib/config";
import { fmtDate, peso, toDateInput, timeAgo } from "@/lib/format";
import { Modal, Drawer, Field, Spinner, Avatar, EmptyState } from "@/components/ui";
import {
  createProject, updateProject, deleteProject, setProjectStatus, fetchProjectDetail,
  type ProjectInput,
} from "@/server/admin";

type Detail = NonNullable<Awaited<ReturnType<typeof fetchProjectDetail>>>;

const BLANK: ProjectInput = { clientName: "", pianoBrand: "", pianoModel: "", serviceType: "Full Restoration" };

export default function ProjectsBoard({ projects: initial, workers }: { projects: ProjectRow[]; workers: Worker[] }) {
  const sp = useSearchParams();
  const [projects, setProjects] = useState(initial);
  useEffect(() => {
    queueMicrotask(() => setProjects(initial));
  }, [initial]);

  const [view, setView] = useState<"kanban" | "list">("kanban");
  const [q, setQ] = useState("");
  const [stageFilter, setStageFilter] = useState(() => { const s = sp.get("stage"); return s && PROJECT_STAGES.some((x) => x.key === s) ? s : "all"; });
  const [sort, setSort] = useState<"updated" | "due" | "client">("updated");
  const [modal, setModal] = useState<null | { id?: string; data: ProjectInput }>(() => (sp.get("new") === "1" ? { data: BLANK } : null));
  const [busy, setBusy] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(sp.get("sel"));
  const [detail, setDetail] = useState<Detail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!detailId) {
      queueMicrotask(() => setDetail(null));
      return;
    }
    queueMicrotask(() => setDetailLoading(true));
    fetchProjectDetail(detailId).then((d) => { setDetail(d); setDetailLoading(false); });
  }, [detailId]);

  /* Detect if kanban can scroll right */
  const checkCanScroll = () => {
    if (scrollContainerRef.current) {
      const { scrollLeft, scrollWidth, clientWidth } = scrollContainerRef.current;
      const hasOverflow = scrollWidth > clientWidth;
      const notFullyScrolled = scrollLeft < scrollWidth - clientWidth - 5;
      setCanScrollRight(hasOverflow && notFullyScrolled);
    }
  };

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    // Use ResizeObserver to detect container size changes
    const resizeObs = new ResizeObserver(() => queueMicrotask(checkCanScroll));
    resizeObs.observe(container);

    container.addEventListener("scroll", checkCanScroll);
    window.addEventListener("resize", checkCanScroll);

    return () => {
      resizeObs.disconnect();
      container.removeEventListener("scroll", checkCanScroll);
      window.removeEventListener("resize", checkCanScroll);
    };
  }, []);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let rows = projects.filter((p) => {
      if (stageFilter !== "all" && p.status !== stageFilter) return false;
      if (!needle) return true;
      return [p.clientName, p.pianoBrand, p.pianoModel, p.serialNumber, p.serviceType]
        .filter(Boolean).join(" ").toLowerCase().includes(needle);
    });
    rows = [...rows].sort((a, b) => {
      if (sort === "client") return a.clientName.localeCompare(b.clientName);
      if (sort === "due") return (a.dueDate?.getTime() ?? Infinity) - (b.dueDate?.getTime() ?? Infinity);
      return b.updatedAt.getTime() - a.updatedAt.getTime();
    });
    return rows;
  }, [projects, q, stageFilter, sort]);

  useEffect(() => {
    queueMicrotask(checkCanScroll);
  }, [filtered]);

  async function moveProject(id: string, stage: string) {
    setProjects((ps) => ps.map((p) => (p.id === id ? { ...p, status: stage } : p)));
    await setProjectStatus(id, stage);
  }

  async function save() {
    if (!modal) return;
    setBusy(true);
    if (modal.id) await updateProject(modal.id, modal.data);
    else await createProject(modal.data);
    setBusy(false);
    setModal(null);
  }

  const inp = "input-dark";

  return (
    <div className="p-4 sm:p-7 max-w-[1600px] mx-auto">
      {/* header + toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div>
          <h1 className="font-serif text-2xl sm:text-3xl text-white">Projects</h1>
          <p className="text-mist text-[12.5px] mt-1">The pipeline — where every piano stands today.</p>
        </div>
        <button onClick={() => setModal({ data: BLANK })}
          className="flex items-center gap-2 bg-[#22C55E] text-[#04210F] min-h-11 cursor-pointer text-[12.5px] font-medium rounded-xl px-4 py-2.5 hover:brightness-110 transition">
          <Plus size={15} /> New Project
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2.5 mb-5">
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-mist" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search client, piano, serial…" className="input-dark pl-9" />
        </div>
        <select aria-label="Filter by stage" value={stageFilter} onChange={(e) => setStageFilter(e.target.value)} className="input-dark w-auto">
          <option value="all">All stages</option>
          {PROJECT_STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
        <button onClick={() => setSort(sort === "due" ? "client" : sort === "client" ? "updated" : "due")}
          className="input-dark w-auto flex items-center gap-2 text-mist hover:text-white cursor-pointer">
          <ArrowUpDown size={13} /> {sort === "updated" ? "Recently active" : sort === "due" ? "Due date" : "Client A–Z"}
        </button>
        <div className="ml-auto flex bg-white/[0.05] border border-white/10 rounded-xl p-1">
          {([["kanban", LayoutGrid], ["list", Rows3]] as const).map(([v, Icon]) => (
            <button key={v} onClick={() => setView(v)}
              className={`px-3.5 py-1.5 rounded-lg text-[12px] flex items-center gap-1.5 transition ${view === v ? "bg-[#22C55E] text-[#04210F] min-h-11 cursor-pointer font-medium" : "text-mist hover:text-white"}`}>
              <Icon size={13} /> {v === "kanban" ? "Kanban" : "List"}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 && <EmptyState title="No projects match" body="Adjust search or filters, or start a new project." />}

      {/* ============ KANBAN ============ */}
      {view === "kanban" && filtered.length > 0 && (
        <div ref={scrollContainerRef} className="flex gap-3.5 overflow-x-auto pb-4 anim-fade-in">
          {PROJECT_STAGES.map((stage) => {
            const cards = filtered.filter((p) => p.status === stage.key);
            if (stageFilter === "all" || stageFilter === stage.key) return (
              <div
                key={stage.key}
                className={`w-[268px] shrink-0 ${dragOver === stage.key ? "kb-col-dragover" : ""}`}
                onDragOver={(e) => { e.preventDefault(); setDragOver(stage.key); }}
                onDragLeave={() => setDragOver((d) => (d === stage.key ? null : d))}
                onDrop={(e) => { e.preventDefault(); setDragOver(null); const id = e.dataTransfer.getData("text/plain"); if (id) moveProject(id, stage.key); }}
              >
                <div className="flex items-center justify-between px-1.5 mb-2.5">
                  <p className="text-xs uppercase tracking-[0.18em] text-mist">{stage.label}</p>
                  <span className="text-xs text-mist tnum">{cards.length}</span>
                </div>
                <div className="space-y-2.5 min-h-[120px] rounded-xl">
                  {cards.map((p) => (
                    <button
                      key={p.id}
                      draggable
                      onDragStart={(e) => e.dataTransfer.setData("text/plain", p.id)}
                      onClick={() => setDetailId(p.id)}
                      className="card-dark w-full text-left p-3.5 hover:border-white/25 transition cursor-grab active:cursor-grabbing"
                    >
                      {p.imageUrl && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={p.imageUrl} alt="" className="w-full h-24 object-cover rounded-lg mb-3 opacity-90" />
                      )}
                      <p className="text-[13px] text-white font-medium leading-snug">{p.pianoBrand} {p.pianoModel}</p>
                      <p className="text-xs text-mist mt-0.5">{p.clientName} · {p.serviceType}</p>
                      <div className="h-1 bg-white/10 rounded-full mt-3 overflow-hidden">
                        <div className="h-full bg-chrome/80 rounded-full" style={{ width: `${p.progress}%` }} />
                      </div>
                      <div className="flex items-center justify-between mt-2.5 text-xs text-mist">
                        <span>{p.dueDate ? `due ${fmtDate(new Date(p.dueDate))}` : "no due date"}</span>
                        {p.workerName && <span className="text-chrome/80">{p.workerName.split(" ")[0]}</span>}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            );
            return null;
          })}
        </div>
      )}

      {/* ============ LIST ============ */}
      {view === "list" && filtered.length > 0 && (
        <div className="card-dark overflow-x-auto anim-fade-in thin-scroll">
          <table className="w-full text-[12.5px] min-w-[860px]">
            <thead>
              <tr className="text-left text-xs uppercase tracking-[0.16em] text-mist border-b border-white/[0.07]">
                {["Client", "Piano", "Service", "Stage", "Due", "Lead tech", "Progress", "Tasks", "Last client update"].map((h) => (
                  <th key={h} className="px-4 py-3 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr key={p.id} onClick={() => setDetailId(p.id)} className="border-b border-white/[0.04] hover:bg-white/[0.035] cursor-pointer transition-colors">
                  <td className="px-4 py-3.5 text-white font-medium">{p.clientName}</td>
                  <td className="px-4 py-3.5 text-chrome">{p.pianoBrand} {p.pianoModel}{p.pianoYear ? <span className="text-mist"> ·{p.pianoYear}</span> : null}</td>
                  <td className="px-4 py-3.5 text-mist">{p.serviceType}</td>
                  <td className="px-4 py-3.5"><span className="bg-white/[0.07] border border-white/10 rounded-full px-2.5 py-1 text-xs">{STAGE_LABEL[p.status]}</span></td>
                  <td className="px-4 py-3.5 text-mist tnum">{p.dueDate ? fmtDate(new Date(p.dueDate)) : "—"}</td>
                  <td className="px-4 py-3.5 text-chrome">{p.workerName ?? "—"}</td>
                  <td className="px-4 py-3.5 w-32">
                    <div className="h-1.5 bg-white/10 rounded-full overflow-hidden w-24">
                      <div className="h-full bg-chrome rounded-full" style={{ width: `${p.progress}%` }} />
                    </div>
                  </td>
                  <td className="px-4 py-3.5 text-mist tnum">{p.doneTasks}/{p.doneTasks + p.openTasks} done</td>
                  <td className="px-4 py-3.5 text-mist">{p.lastClientUpdateAt ? timeAgo(new Date(p.lastClientUpdateAt)) : "never"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ============ DETAIL DRAWER ============ */}
      <Drawer open={!!detailId} onClose={() => setDetailId(null)}>
        {detailLoading || !detail ? (
          <div className="p-6 space-y-4"><div className="skeleton h-40" /><div className="skeleton h-5 w-1/2" /><div className="skeleton h-24" /></div>
        ) : (
          <div className="pb-10">
            <div className="relative h-48">
              {detail.project.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={detail.project.imageUrl} alt="" className="h-full w-full object-cover" />
              ) : <div className="h-full w-full bg-panel" />}
              <div className="absolute inset-0 bg-gradient-to-t from-[#0d1116] via-transparent to-transparent" />
              <div className="absolute bottom-4 left-6 right-6">
                <p className="text-xs uppercase tracking-[0.22em] text-white/60">{STAGE_LABEL[detail.project.status]} · {detail.project.serviceType}</p>
                <h2 className="font-serif text-3xl text-white mt-1">{detail.project.pianoBrand} {detail.project.pianoModel}</h2>
              </div>
            </div>

            <div className="px-6 space-y-6 mt-5">
              {/* meta */}
              <div className="grid grid-cols-2 gap-2.5 text-[12px]">
                {[
                  ["Client", detail.project.clientName],
                  ["Contact", detail.project.clientPhone ?? detail.project.clientEmail ?? "—"],
                  ["Year", detail.project.pianoYear?.toString() ?? "—"],
                  ["Serial", detail.project.serialNumber ?? "—"],
                  ["Due", detail.project.dueDate ? fmtDate(new Date(detail.project.dueDate)) : "—"],
                  ["Lead technician", detail.worker?.name ?? "—"],
                ].map(([k, v]) => (
                  <div key={k} className="card-dark p-3"><p className="text-xs uppercase tracking-[0.18em] text-mist mb-1">{k}</p><p className="text-chrome">{v}</p></div>
                ))}
              </div>

              {/* stage selector */}
              <div>
                <p className="text-xs uppercase tracking-[0.22em] text-mist mb-2">Move through pipeline</p>
                <div className="flex flex-wrap gap-1.5">
                  {PROJECT_STAGES.map((s) => (
                    <button key={s.key} onClick={async () => { await setProjectStatus(detail.project.id, s.key); const d = await fetchProjectDetail(detail.project.id); setDetail(d); }}
                      className={`text-xs rounded-full px-3 py-1.5 border transition ${detail.project.status === s.key ? "bg-[#22C55E] text-[#04210F] border-[#22C55E] font-medium" : "border-white/15 text-mist hover:text-white"}`}>
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* portal link */}
              <div className="card-dark p-4">
                <p className="text-xs uppercase tracking-[0.22em] text-mist mb-2 flex items-center gap-1.5"><Link2 size={12} /> Private client portal</p>
                <div className="flex items-center gap-2">
                  <p className="text-xs text-chrome/80 truncate flex-1 tnum">/portal/{detail.project.portalUuid}</p>
                  <button onClick={async () => { await navigator.clipboard.writeText(`${location.origin}/portal/${detail.project.portalUuid}`); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
                    className="p-2 rounded-lg bg-white/10 hover:bg-white/20 transition">{copied ? <Check size={13} className="text-emerald-300" /> : <Copy size={13} />}</button>
                </div>
                <a href={`/portal/${detail.project.portalUuid}`} target="_blank" className="text-xs text-sky-300 hover:underline mt-2 inline-block">Preview as client ↗</a>
              </div>

              {/* tasks */}
              <div>
                <p className="text-xs uppercase tracking-[0.22em] text-mist mb-2.5">Tasks · {detail.tasks.filter((t) => t.status !== "done").length} open</p>
                <ul className="space-y-2">
                  {detail.tasks.slice(0, 10).map((t) => (
                    <li key={t.id} className="card-dark px-3.5 py-2.5 flex items-center gap-3 text-[12px]">
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${t.status === "done" ? "bg-emerald-400" : t.status === "in_progress" ? "bg-white" : "bg-slate-500"}`} />
                      <span className={`flex-1 ${t.status === "done" ? "line-through text-mist" : "text-chrome"}`}>{t.title}</span>
                      <span className="text-mist text-xs">{t.claimedName ?? (t.assigneeNames.length > 1 ? `${t.assigneeNames[0].split(" ")[0]} +${t.assigneeNames.length - 1}` : t.assigneeNames[0] ?? "")}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* story + labor */}
              <div className="grid grid-cols-2 gap-2.5">
                <div className="card-dark p-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-mist mb-1">Story entries</p>
                  <p className="text-chrome text-[13px]">{detail.updates.length} · {detail.updates.filter((u) => u.isVisibleToClient).length} visible</p>
                </div>
                <div className="card-dark p-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-mist mb-1">Labor logged</p>
                  <p className="text-chrome text-[13px] tnum">
                    {(() => {
                      const cents = detail.labor.reduce((s, l) => {
                        const end = l.entry.clockOut?.getTime() ?? Date.now();
                        return s + ((end - l.entry.clockIn.getTime()) / 3_600_000) * l.entry.rateAtClockInCents;
                      }, 0);
                      return peso(cents);
                    })()}
                  </p>
                </div>
              </div>

              {detail.project.notes && (
                <div className="card-dark p-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-mist mb-1.5">Workshop notes</p>
                  <p className="text-[12.5px] text-chrome/85 leading-relaxed">{detail.project.notes}</p>
                </div>
              )}

              <div className="flex gap-2">
                <button onClick={() => { setDetailId(null); setModal({ id: detail.project.id, data: { clientName: detail.project.clientName, clientEmail: detail.project.clientEmail ?? "", clientPhone: detail.project.clientPhone ?? "", clientAddress: detail.project.clientAddress ?? "", pianoBrand: detail.project.pianoBrand, pianoModel: detail.project.pianoModel, pianoYear: detail.project.pianoYear, serialNumber: detail.project.serialNumber ?? "", serviceType: detail.project.serviceType, dueDate: detail.project.dueDate ? toDateInput(new Date(detail.project.dueDate)) : "", assignedWorkerId: detail.project.assignedWorkerId, imageUrl: detail.project.imageUrl ?? "", notes: detail.project.notes ?? "" } }); }}
                  className="flex-1 flex items-center justify-center gap-2 bg-[#22C55E] text-[#04210F] min-h-11 cursor-pointer text-[12.5px] font-medium rounded-xl py-2.5 hover:brightness-110 transition">
                  <Pencil size={13} /> Edit project
                </button>
                <button onClick={async () => { if (confirm("Delete this project, its tasks and story entries?")) { await deleteProject(detail.project.id); setDetailId(null); } }}
                  className="px-4 rounded-xl border border-rose-500/25 text-rose-400 hover:bg-rose-500/10 transition"><Trash2 size={15} /></button>
              </div>
            </div>
          </div>
        )}
      </Drawer>

      {/* ============ CREATE / EDIT MODAL ============ */}
      <Modal open={!!modal} onClose={() => setModal(null)} title={modal?.id ? "Edit project" : "New project"} wide>
        {modal && (
          <div className="grid sm:grid-cols-2 gap-3.5">
            <Field label="Client name"><input className={inp} value={modal.data.clientName} onChange={(e) => setModal({ ...modal, data: { ...modal.data, clientName: e.target.value } })} /></Field>
            <Field label="Client phone"><input className={inp} value={modal.data.clientPhone ?? ""} onChange={(e) => setModal({ ...modal, data: { ...modal.data, clientPhone: e.target.value } })} /></Field>
            <Field label="Piano brand"><input className={inp} placeholder="Steinway & Sons" value={modal.data.pianoBrand} onChange={(e) => setModal({ ...modal, data: { ...modal.data, pianoBrand: e.target.value } })} /></Field>
            <Field label="Model"><input className={inp} placeholder="Model O" value={modal.data.pianoModel} onChange={(e) => setModal({ ...modal, data: { ...modal.data, pianoModel: e.target.value } })} /></Field>
            <Field label="Year"><input className={inp} type="number" value={modal.data.pianoYear ?? ""} onChange={(e) => setModal({ ...modal, data: { ...modal.data, pianoYear: e.target.value ? Number(e.target.value) : null } })} /></Field>
            <Field label="Serial number"><input className={inp} value={modal.data.serialNumber ?? ""} onChange={(e) => setModal({ ...modal, data: { ...modal.data, serialNumber: e.target.value } })} /></Field>
            <Field label="Service type">
              <select className={inp} value={modal.data.serviceType} onChange={(e) => setModal({ ...modal, data: { ...modal.data, serviceType: e.target.value } })}>
                {["Full Restoration", "Reconditioning", "Action Rebuild", "Action Regulation & Voicing", "Regulation", "Tuning & Voicing", "Cabinet Refinish", "Assessment"].map((s) => <option key={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Due date"><input className={inp} type="date" value={modal.data.dueDate ?? ""} onChange={(e) => setModal({ ...modal, data: { ...modal.data, dueDate: e.target.value } })} /></Field>
            <Field label="Lead technician">
              <select className={inp} value={modal.data.assignedWorkerId ?? ""} onChange={(e) => setModal({ ...modal, data: { ...modal.data, assignedWorkerId: e.target.value || null } })}>
                <option value="">Unassigned</option>
                {workers.filter((w) => w.active).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </Field>
            <Field label="Image URL"><input className={inp} placeholder="https://…" value={modal.data.imageUrl ?? ""} onChange={(e) => setModal({ ...modal, data: { ...modal.data, imageUrl: e.target.value } })} /></Field>
            <div className="sm:col-span-2"><Field label="Workshop notes"><textarea className={`${inp} min-h-[80px]`} value={modal.data.notes ?? ""} onChange={(e) => setModal({ ...modal, data: { ...modal.data, notes: e.target.value } })} /></Field></div>
            <div className="sm:col-span-2 flex gap-2 mt-1">
              <button onClick={save} disabled={busy || !modal.data.clientName || !modal.data.pianoBrand || !modal.data.pianoModel}
                className="flex-1 bg-[#22C55E] text-[#04210F] min-h-11 cursor-pointer text-[13px] font-medium rounded-xl py-3 hover:brightness-110 transition disabled:opacity-50 flex items-center justify-center gap-2">
                {busy && <Spinner className="text-black" />} {modal.id ? "Save changes" : "Create project"}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
