"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  Eye, EyeOff, GripVertical, Plus, Trash2, Send, Save, ExternalLink, ImagePlus, Upload, X,
} from "lucide-react";
import type { Update } from "@/db/schema";
import { fmtDate } from "@/lib/format";
import { Modal, Field, Spinner, EmptyState } from "@/components/ui";
import {
  fetchProjectUpdates, createUpdate, toggleUpdateVisibility, reorderUpdates,
  deleteUpdate, publishAllUpdates,
} from "@/server/admin";

type Proj = { id: string; clientName: string; pianoBrand: string; pianoModel: string; portalUuid: string; imageUrl: string | null };

export default function CuratorClient({ projects }: { projects: Proj[] }) {
  const sp = useSearchParams();
  const [projectId, setProjectId] = useState(() => projects.find((p) => p.id === sp.get("project"))?.id ?? projects[0]?.id ?? "");
  const [updates, setUpdates] = useState<Update[]>([]);
  const [loading, setLoading] = useState(() => Boolean(projects[0]?.id));
  const [modal, setModal] = useState(() => sp.get("new") === "1");
  const [form, setForm] = useState({ title: "", body: "", imageUrl: "", visible: true });
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [uploadError, setUploadError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const project = projects.find((p) => p.id === projectId);

  const MAX_UPLOAD_BYTES = 3 * 1024 * 1024;

  function onFileChosen(file: File | undefined) {
    setUploadError("");
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setUploadError("Please choose an image file.");
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setUploadError("Image is too large — please choose one under 3MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setForm((f) => ({ ...f, imageUrl: reader.result as string }));
    reader.onerror = () => setUploadError("Couldn't read that file — please try again.");
    reader.readAsDataURL(file);
  }

  useEffect(() => {
    if (!projectId) return;
    fetchProjectUpdates(projectId).then((u) => { setUpdates(u); setDirty(false); setLoading(false); });
  }, [projectId]);

  async function add() {
    setBusy(true);
    await createUpdate({ projectId, ...form });
    const u = await fetchProjectUpdates(projectId);
    setUpdates(u); setBusy(false); setModal(false);
    setForm({ title: "", body: "", imageUrl: "", visible: true });
    setUploadError("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function toggle(id: string, visible: boolean) {
    setUpdates((us) => us.map((u) => (u.id === id ? { ...u, isVisibleToClient: visible } : u)));
    await toggleUpdateVisibility(id, visible, projectId);
  }

  function onDrop(i: number) {
    if (dragIdx === null || dragIdx === i) return;
    const next = [...updates];
    const [moved] = next.splice(dragIdx, 1);
    next.splice(i, 0, moved);
    setUpdates(next);
    setDirty(true);
    setDragIdx(null);
  }

  const visibleCount = updates.filter((u) => u.isVisibleToClient).length;
  const inp = "input-dark";

  return (
    <div className="p-4 sm:p-7 max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="font-serif text-2xl sm:text-3xl text-white">Client Curator</h1>
        <p className="text-mist text-[12.5px] mt-1">Compose each client&apos;s restoration story. Only what you publish appears in their private exhibit.</p>
      </div>

      {/* project selector */}
      <div className="flex gap-2.5 overflow-x-auto no-scrollbar pb-2 mb-6">
        {projects.map((p) => (
          <button key={p.id} onClick={() => { setLoading(true); setProjectId(p.id); }}
            className={`shrink-0 flex items-center gap-2.5 rounded-xl border px-3.5 py-2.5 transition text-left ${projectId === p.id ? "bg-[#22C55E] text-[#04210F] border-[#22C55E]" : "border-white/10 text-chrome hover:border-white/30"}`}>
            {p.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={p.imageUrl} alt="" className="w-8 h-8 rounded-lg object-cover" />
            ) : <ImagePlus size={18} />}
            <span>
              <span className="block text-[12px] font-medium leading-tight">{p.pianoBrand} {p.pianoModel}</span>
              <span className={`block text-xs leading-tight mt-0.5 ${projectId === p.id ? "text-[#04210F]" : "text-mist"}`}>{p.clientName}</span>
            </span>
          </button>
        ))}
      </div>

      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-2.5 mb-5">
        <p className="text-[12px] text-mist mr-auto">
          <span className="text-white tnum">{visibleCount}</span> of <span className="text-white tnum">{updates.length}</span> entries visible
          {dirty && <span className="text-amber-300 ml-2">· order changed</span>}
        </p>
        {dirty && (
          <button onClick={async () => { setBusy(true); await reorderUpdates(projectId, updates.map((u) => u.id)); setDirty(false); setBusy(false); }}
            className="flex items-center gap-1.5 text-[12px] bg-amber-400/15 text-amber-300 border border-amber-400/25 rounded-lg px-3 py-2 hover:bg-amber-400/25 transition">
            <Save size={13} /> Save order
          </button>
        )}
        <button onClick={async () => { setBusy(true); await publishAllUpdates(projectId); const u = await fetchProjectUpdates(projectId); setUpdates(u); setBusy(false); }}
          className="flex items-center gap-1.5 text-[12px] border border-white/15 text-chrome rounded-lg px-3 py-2 hover:bg-white/10 transition">
          <Send size={13} /> Publish all
        </button>
        <button onClick={() => setModal(true)}
          className="flex items-center gap-1.5 text-[12px] bg-[#22C55E] text-[#04210F] min-h-11 cursor-pointer font-medium rounded-lg px-3.5 py-2 hover:brightness-110 transition">
          <Plus size={13} /> Add update
        </button>
        {project && (
          <a href={`/portal/${project.portalUuid}`} target="_blank"
            className="flex items-center gap-1.5 text-[12px] border border-sky-400/25 text-sky-300 rounded-lg px-3 py-2 hover:bg-sky-400/10 transition">
            <ExternalLink size={13} /> Preview as client
          </a>
        )}
      </div>

      {/* updates list */}
      {loading ? (
        <div className="space-y-3">{[0, 1, 2].map((i) => <div key={i} className="skeleton h-24" />)}</div>
      ) : updates.length === 0 ? (
        <EmptyState title="No journal entries yet" body="Add the first restoration update for this project." />
      ) : (
        <ul className="space-y-2.5">
          {updates.map((u, i) => (
            <li
              key={u.id}
              draggable
              onDragStart={() => setDragIdx(i)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => onDrop(i)}
              className={`card-dark p-3.5 flex items-center gap-3.5 transition ${dragIdx === i ? "opacity-40" : ""} ${!u.isVisibleToClient ? "opacity-80" : ""}`}
            >
              <GripVertical size={16} className="text-mist cursor-grab shrink-0" />
              {u.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={u.imageUrl} alt="" className="w-20 h-14 rounded-lg object-cover shrink-0" />
              ) : (
                <div className="w-20 h-14 rounded-lg bg-white/[0.04] flex items-center justify-center text-mist shrink-0"><ImagePlus size={16} /></div>
              )}
              <div className="flex-1 min-w-0">
                <p className={`text-[13.5px] truncate ${u.isVisibleToClient ? "text-white" : "text-mist line-through decoration-white/30"}`}>{u.title}</p>
                {u.body && <p className="text-xs text-mist truncate mt-0.5">{u.body}</p>}
                <p className="text-xs text-mist mt-1 uppercase tracking-wider tnum">{fmtDate(new Date(u.updateDate))}</p>
              </div>
              <button onClick={() => toggle(u.id, !u.isVisibleToClient)}
                className={`shrink-0 flex items-center gap-1.5 text-xs rounded-lg px-3 py-2 border transition ${
                  u.isVisibleToClient ? "border-emerald-400/25 text-emerald-300 bg-emerald-400/10" : "border-white/12 text-mist hover:text-white"
                }`}>
                {u.isVisibleToClient ? <><Eye size={13} /> Visible</> : <><EyeOff size={13} /> Hidden</>}
              </button>
              <button onClick={async () => { if (confirm("Delete this entry?")) { await deleteUpdate(u.id); setUpdates((us) => us.filter((x) => x.id !== u.id)); } }}
                aria-label="Delete update" className="shrink-0 h-11 w-11 flex items-center justify-center rounded-lg text-mist hover:text-rose-400 hover:bg-white/5 transition">
                <Trash2 size={16} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* add update modal */}
      <Modal open={modal} onClose={() => setModal(false)} title="New journal entry" wide>
        <div className="space-y-3.5">
          <Field label="Title *"><input className={inp} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. New pinblock fitted" /></Field>
          <Field label="Caption (shown in the client's exhibit)"><textarea className={`${inp} min-h-[90px]`} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} placeholder="A short, elegant description of the work…" /></Field>
          <Field label="Photograph">
            <input
              ref={fileInputRef} type="file" accept="image/*" className="hidden"
              onChange={(e) => onFileChosen(e.target.files?.[0])}
            />
            {form.imageUrl ? (
              <div className="flex items-center gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={form.imageUrl} alt="" className="w-20 h-14 rounded-lg object-cover shrink-0 border border-white/10" />
                <button
                  type="button"
                  onClick={() => { setForm({ ...form, imageUrl: "" }); if (fileInputRef.current) fileInputRef.current.value = ""; }}
                  className="flex items-center gap-1.5 text-[12px] text-mist hover:text-white border border-white/15 rounded-lg px-3 py-2 transition"
                >
                  <X size={13} /> Remove photo
                </button>
              </div>
            ) : (
              <button
                type="button" onClick={() => fileInputRef.current?.click()}
                className="w-full flex items-center justify-center gap-2 text-[12.5px] text-mist border border-dashed border-white/15 rounded-xl py-4 hover:border-white/30 hover:text-white transition"
              >
                <Upload size={15} /> Upload a photo
              </button>
            )}
            {uploadError && <p className="text-rose-400 text-xs mt-1.5">{uploadError}</p>}
          </Field>
          <label className="flex items-center gap-2.5 text-[12.5px] text-chrome cursor-pointer">
            <input type="checkbox" checked={form.visible} onChange={(e) => setForm({ ...form, visible: e.target.checked })} className="accent-white" />
            Visible to client immediately
          </label>
          <button onClick={add} disabled={busy || !form.title.trim()}
            className="w-full bg-[#22C55E] text-[#04210F] min-h-11 cursor-pointer text-[13px] font-medium rounded-xl py-3 hover:brightness-110 transition disabled:opacity-50 flex items-center justify-center gap-2">
            {busy && <Spinner className="text-black" />} Add to journal
          </button>
          {!form.title.trim() && (
            <p className="text-amber-300/80 text-xs text-center -mt-1.5">Title is required before this entry can be added.</p>
          )}
        </div>
      </Modal>
    </div>
  );
}
