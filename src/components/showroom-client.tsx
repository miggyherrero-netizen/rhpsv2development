"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Plus, Trash2, Piano as PianoIcon, ArchiveRestore, Coins, Search, Upload, X } from "lucide-react";
import type { Piano } from "@/db/schema";
import { PIANO_STATUS } from "@/lib/config";
import { peso } from "@/lib/format";
import { Modal, Drawer, Field, Spinner, EmptyState } from "@/components/ui";
import { createPiano, updatePiano, setPianoStatus, deletePiano, type PianoInput } from "@/server/admin";

type PianoRow = Omit<Piano, "costCents">;

const BLANK: PianoInput = { brand: "", model: "", type: "Grand", condition: "Restored", status: "available", recommendedUse: "Home" };

const STATUS_DOT: Record<string, string> = { available: "bg-emerald-400", reserved: "bg-amber-400", sold: "bg-slate-400" };

export default function ShowroomClient({ pianos }: { pianos: PianoRow[] }) {
  const sp = useSearchParams();
  const [q, setQ] = useState("");
  const [soldOpen, setSoldOpen] = useState(false);
  const [modal, setModal] = useState<null | { id?: string; data: PianoInput & { price?: string } }>(() => (sp.get("new") === "1" ? { data: BLANK } : null));
  const [busy, setBusy] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const MAX_UPLOAD_BYTES = 3 * 1024 * 1024;

  function closeModal() {
    setModal(null);
    setUploadError("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function onFileChosen(file: File | undefined) {
    setUploadError("");
    if (!file || !modal) return;
    if (!file.type.startsWith("image/")) {
      setUploadError("Please choose an image file.");
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setUploadError("Image is too large — please choose one under 3MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setModal((m) => (m ? { ...m, data: { ...m.data, imageUrl: reader.result as string } } : m));
    reader.onerror = () => setUploadError("Couldn't read that file — please try again.");
    reader.readAsDataURL(file);
  }

  const active = pianos.filter((p) => p.status !== "sold");
  const sold = pianos.filter((p) => p.status === "sold");
  const filtered = active.filter((p) => {
    const needle = q.trim().toLowerCase();
    if (!needle) return true;
    return `${p.brand} ${p.model}`.toLowerCase().includes(needle);
  });

  const inp = "input-dark";

  async function save() {
    if (!modal) return;
    setBusy(true);
    const { price, ...data } = modal.data;
    const payload = { ...data, priceCents: price !== undefined ? (Math.round(Number(price) * 100) || null) : data.priceCents };
    if (modal.id) await updatePiano(modal.id, payload);
    else await createPiano(payload);
    setBusy(false);
    closeModal();
  }

  async function changeStatus(id: string, status: string) {
    await setPianoStatus(id, status);
  }

  return (
    <div className="p-4 sm:p-7 max-w-[1600px] mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div>
          <h1 className="font-serif text-2xl sm:text-3xl text-white">Showroom Editor</h1>
          <p className="text-mist text-[12.5px] mt-1">Controls the live public showroom — mark pianos available, reserved, or sold.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setSoldOpen(true)}
            className="flex items-center gap-2 bg-white/[0.06] hover:bg-white/[0.12] border border-white/10 text-chrome text-[12.5px] font-medium rounded-xl px-4 py-2.5 transition">
            <ArchiveRestore size={15} /> Sold pianos ({sold.length})
          </button>
          <button onClick={() => setModal({ data: BLANK })}
            className="flex items-center gap-2 bg-white text-black text-[12.5px] font-medium rounded-xl px-4 py-2.5 hover:bg-chrome transition">
            <Plus size={15} /> Add Piano
          </button>
        </div>
      </div>

      <div className="relative flex-1 min-w-[200px] max-w-xs mb-5">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-mist" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search brand or model…" className="input-dark pl-9" />
      </div>

      {filtered.length === 0 ? <EmptyState title="No pianos found" body="Add a piano to the showroom or relax the search." /> : (
        <div className="card-dark overflow-x-auto thin-scroll">
          <table className="w-full text-[12.5px] min-w-[860px]">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-[0.16em] text-mist border-b border-white/[0.07]">
                {["Piano", "Type", "Condition", "Price", "Status", "Cost & margin", ""].map((h) => (
                  <th key={h} className="px-4 py-3 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => {
                return (
                  <tr key={p.id} className="border-b border-white/[0.04] hover:bg-white/[0.03] transition-colors">
                    <td className="px-4 py-3 text-white max-w-[240px]">
                      <span className="flex items-center gap-2"><PianoIcon size={14} className="text-mist shrink-0" /> {p.brand} {p.model}{p.year ? ` · ${p.year}` : ""}</span>
                    </td>
                    <td className="px-4 py-3 text-mist">{p.type}</td>
                    <td className="px-4 py-3 text-mist">{p.condition}</td>
                    <td className="px-4 py-3 text-chrome tnum">{p.priceCents != null ? peso(p.priceCents) : "—"}</td>
                    <td className="px-4 py-3">
                      <div className="relative inline-flex items-center">
                        <span className={`absolute left-3 w-1.5 h-1.5 rounded-full ${STATUS_DOT[p.status] ?? STATUS_DOT.available}`} />
                        <select value={p.status} onChange={(e) => changeStatus(p.id, e.target.value)}
                          className="text-[11px] rounded-full pl-6 pr-2.5 py-1 border border-white/10 bg-white/[0.06] text-chrome">
                          {Object.entries(PIANO_STATUS).map(([k, v]) => <option key={k} value={k} className="text-black">{v.label}</option>)}
                        </select>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <Link href={`/admin/showroom/${p.id}/cost`}
                        className="inline-flex items-center gap-1.5 text-[11px] text-mist hover:text-white underline underline-offset-4 decoration-white/20 transition">
                        <Coins size={13} /> View
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <button onClick={() => setModal({ id: p.id, data: { ...p, price: p.priceCents != null ? (p.priceCents / 100).toString() : "" } as PianoInput & { price: string } })}
                        className="text-[11px] text-chrome hover:text-white underline underline-offset-4 decoration-white/20 transition">Edit</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* edit / add modal */}
      <Modal open={!!modal} onClose={closeModal} title={modal?.id ? "Edit piano" : "Add piano"} wide>
        {modal && (
          <div className="grid sm:grid-cols-2 gap-3.5">
            <Field label="Brand"><input className={inp} value={modal.data.brand} onChange={(e) => setModal({ ...modal, data: { ...modal.data, brand: e.target.value } })} /></Field>
            <Field label="Model"><input className={inp} value={modal.data.model} onChange={(e) => setModal({ ...modal, data: { ...modal.data, model: e.target.value } })} /></Field>
            <Field label="Year"><input className={inp} type="number" value={modal.data.year ?? ""} onChange={(e) => setModal({ ...modal, data: { ...modal.data, year: e.target.value ? Number(e.target.value) : null } })} /></Field>
            <Field label="Type"><input className={inp} value={modal.data.type ?? ""} onChange={(e) => setModal({ ...modal, data: { ...modal.data, type: e.target.value } })} /></Field>
            <Field label="Condition"><input className={inp} value={modal.data.condition ?? ""} onChange={(e) => setModal({ ...modal, data: { ...modal.data, condition: e.target.value } })} /></Field>
            <Field label="Recommended use"><input className={inp} value={modal.data.recommendedUse ?? ""} onChange={(e) => setModal({ ...modal, data: { ...modal.data, recommendedUse: e.target.value } })} /></Field>
            <Field label="Price (₱)"><input className={inp} type="number" step="0.01" value={modal.data.price ?? ""} onChange={(e) => setModal({ ...modal, data: { ...modal.data, price: e.target.value } })} /></Field>
            <Field label="Status">
              <select className={inp} value={modal.data.status ?? "available"} onChange={(e) => setModal({ ...modal, data: { ...modal.data, status: e.target.value } })}>
                {Object.entries(PIANO_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </Field>
            <Field label="Dimensions"><input className={inp} value={modal.data.dimensions ?? ""} onChange={(e) => setModal({ ...modal, data: { ...modal.data, dimensions: e.target.value } })} /></Field>
            <div className="sm:col-span-2">
              <Field label="Photo">
                <input
                  ref={fileInputRef} type="file" accept="image/*" className="hidden"
                  onChange={(e) => onFileChosen(e.target.files?.[0])}
                />
                {modal.data.imageUrl ? (
                  <div className="flex items-center gap-3">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={modal.data.imageUrl} alt="" className="w-20 h-14 rounded-lg object-cover shrink-0 border border-white/10" />
                    <button
                      type="button"
                      onClick={() => { setModal({ ...modal, data: { ...modal.data, imageUrl: "" } }); if (fileInputRef.current) fileInputRef.current.value = ""; }}
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
                {uploadError && <p className="text-rose-400 text-[11px] mt-1.5">{uploadError}</p>}
              </Field>
            </div>
            <div className="sm:col-span-2"><Field label="Description (public)"><textarea className={`${inp} min-h-20`} value={modal.data.description ?? ""} onChange={(e) => setModal({ ...modal, data: { ...modal.data, description: e.target.value } })} /></Field></div>
            <div className="sm:col-span-2"><Field label="Technician notes (internal)"><textarea className={`${inp} min-h-16`} value={modal.data.technicianNotes ?? ""} onChange={(e) => setModal({ ...modal, data: { ...modal.data, technicianNotes: e.target.value } })} /></Field></div>
            <div className="sm:col-span-2 flex gap-2 mt-1">
              <button onClick={save} disabled={busy || !modal.data.brand.trim() || !modal.data.model.trim()}
                className="flex-1 bg-white text-black text-[13px] font-medium rounded-xl py-3 hover:bg-chrome transition disabled:opacity-50 flex items-center justify-center gap-2">
                {busy && <Spinner className="text-black" />} {modal.id ? "Save changes" : "Add piano"}
              </button>
              {modal.id && (
                <button onClick={async () => { if (confirm("Remove this piano from the showroom?")) { setBusy(true); await deletePiano(modal.id!); setBusy(false); closeModal(); } }}
                  className="px-4 rounded-xl border border-rose-500/25 text-rose-400 hover:bg-rose-500/10 transition"><Trash2 size={15} /></button>
              )}
            </div>
          </div>
        )}
      </Modal>

      {/* sold pianos side panel */}
      <Drawer open={soldOpen} onClose={() => setSoldOpen(false)}>
        <div className="p-6 sm:p-7">
          <h3 className="font-serif text-xl text-white mb-1">Sold pianos</h3>
          <p className="text-mist text-[12.5px] mb-5">Instruments no longer shown in the live showroom.</p>
          {sold.length === 0 ? (
            <EmptyState title="No sold pianos yet" body="Pianos marked sold from the main list will appear here." />
          ) : (
            <div className="space-y-2.5">
              {sold.map((p) => (
                <div key={p.id} className="flex items-center justify-between gap-3 bg-white/[0.03] border border-white/[0.06] rounded-xl px-4 py-3">
                  <div>
                    <p className="text-white text-[13px]">{p.brand} {p.model}{p.year ? ` · ${p.year}` : ""}</p>
                    <p className="text-mist text-[11px] mt-0.5">{p.priceCents != null ? peso(p.priceCents) : "—"}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Link href={`/admin/showroom/${p.id}/cost`} className="text-[11px] text-mist hover:text-white underline underline-offset-4 decoration-white/20 transition">Cost</Link>
                    <button onClick={() => changeStatus(p.id, "available")}
                      className="text-[11px] text-emerald-300 hover:text-emerald-200 underline underline-offset-4 decoration-emerald-300/30 transition">Relist</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </Drawer>
    </div>
  );
}
