"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Plus, KeyRound, Pencil, Ban, CircleCheck, Clock3, Trash2 } from "lucide-react";
import type { Worker } from "@/db/schema";
import { peso, fmtDate, fmtTime, fmtDuration, timeAgo } from "@/lib/format";
import { Modal, Drawer, Field, Spinner, Avatar, EmptyState } from "@/components/ui";
import { createWorker, updateWorker, resetWorkerPin, fetchWorkerDetail, deleteWorker } from "@/server/admin";

type Detail = NonNullable<Awaited<ReturnType<typeof fetchWorkerDetail>>>;

export default function WorkersClient({ workers, liveWorkerIds }: { workers: Worker[]; liveWorkerIds: string[] }) {
  const sp = useSearchParams();
  const [modal, setModal] = useState(() => sp.get("new") === "1");
  const [form, setForm] = useState({ name: "", title: "Technician", rate: "350", pin: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [editRate, setEditRate] = useState("");
  const [newPin, setNewPin] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [nowMs] = useState(() => Date.now());

  useEffect(() => {
    if (!detailId) {
      queueMicrotask(() => setDetail(null));
      return;
    }
    fetchWorkerDetail(detailId).then((d) => {
      setDetail(d);
      if (d) setEditRate(String(d.worker.hourlyRateCents / 100));
    });
  }, [detailId]);

  async function add() {
    setBusy(true); setErr("");
    const res = await createWorker({ name: form.name, title: form.title, hourlyRateCents: Math.round(Number(form.rate) * 100), pin: form.pin });
    setBusy(false);
    if (!res.ok) { setErr(res.error ?? "Failed"); return; }
    setModal(false); setForm({ name: "", title: "Technician", rate: "350", pin: "" });
  }

  async function removeWorker() {
    if (!detail || deleting) return;
    setDeleting(true);
    setDeleteError("");
    try {
      const result = await deleteWorker(detail.worker.id);
      if (!result.ok) { setDeleteError(result.error); return; }
      setDetailId(null);
      setDetail(null);
    } catch {
      setDeleteError("Could not delete this worker. Please try again.");
    } finally {
      setDeleting(false);
    }
  }

  const inp = "input-dark";

  return (
    <div className="p-4 sm:p-7 max-w-[1600px] mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="font-serif text-2xl sm:text-3xl text-white">Workers</h1>
          <p className="text-mist text-[12.5px] mt-1">The hands of the atelier — rates, PINs, and time history.</p>
        </div>
        <button onClick={() => setModal(true)}
          className="flex items-center gap-2 bg-[#22C55E] text-[#04210F] min-h-11 cursor-pointer text-[12.5px] font-medium rounded-xl px-4 py-2.5 hover:brightness-110 transition">
          <Plus size={15} /> Add Worker
        </button>
      </div>

      <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">
        {workers.map((w) => {
          const live = liveWorkerIds.includes(w.id);
          return (
            <button key={w.id} onClick={() => { setDetailId(w.id); setDetail(null); setDeleteError(""); }}
              className={`card-dark p-5 text-left hover:border-white/25 transition ${!w.active ? "opacity-50" : ""}`}>
              <div className="flex items-center gap-3.5">
                <Avatar name={w.name} url={w.avatarUrl} size={52} ring={live} />
                <div className="flex-1 min-w-0">
                  <p className="text-white text-[14.5px] font-medium flex items-center gap-2">
                    {w.name}
                    {live && <span className="text-xs uppercase tracking-[0.16em] text-emerald-300 bg-emerald-400/10 border border-emerald-400/20 rounded-full px-2 py-0.5">on the clock</span>}
                  </p>
                  <p className="text-xs text-mist mt-1">{w.title}</p>
                </div>
              </div>
              <div className="flex items-center justify-between mt-4 pt-3.5 border-t border-white/[0.07] text-xs">
                <span className="text-chrome tnum">{peso(w.hourlyRateCents)}/hr</span>
                <span className={w.active ? "text-emerald-300/90" : "text-mist"}>{w.active ? "Active" : "Inactive"}</span>
              </div>
            </button>
          );
        })}
      </div>

      {/* add modal */}
      <Modal open={modal} onClose={() => setModal(false)} title="Add worker">
        <div className="space-y-3.5">
          <Field label="Full name"><input className={inp} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="Craft title"><input className={inp} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Master Technician" /></Field>
          <Field label="Hourly rate (₱)"><input className={inp} type="number" value={form.rate} onChange={(e) => setForm({ ...form, rate: e.target.value })} /></Field>
          <Field label="4-digit kiosk PIN"><input className={inp} inputMode="numeric" maxLength={4} value={form.pin} onChange={(e) => setForm({ ...form, pin: e.target.value.replace(/\D/g, "") })} placeholder="••••" /></Field>
          {err && <p className="text-rose-400 text-xs">{err}</p>}
          <button onClick={add} disabled={busy || !form.name || form.pin.length !== 4}
            className="w-full bg-[#22C55E] text-[#04210F] min-h-11 cursor-pointer text-[13px] font-medium rounded-xl py-3 hover:brightness-110 transition disabled:opacity-50 flex items-center justify-center gap-2">
            {busy && <Spinner className="text-black" />} Add to the atelier
          </button>
        </div>
      </Modal>

      {/* detail drawer */}
      <Drawer open={!!detailId} onClose={() => { if (!deleting) setDetailId(null); }}>
        {!detail ? (
          <div className="p-6 space-y-4"><div className="skeleton h-16" /><div className="skeleton h-40" /></div>
        ) : (
          <div className="p-6 space-y-6 pb-12">
            <div className="flex items-center gap-4">
              <Avatar name={detail.worker.name} url={detail.worker.avatarUrl} size={58} />
              <div>
                <h2 className="font-serif text-2xl text-white">{detail.worker.name}</h2>
                <p className="text-mist text-[12px] mt-0.5">{detail.worker.title} · {peso(detail.worker.hourlyRateCents)}/hr</p>
              </div>
            </div>

            {detail.current && (
              <div className="card-dark p-4 border-l-2 border-l-emerald-400/60">
                <p className="text-xs uppercase tracking-[0.22em] text-emerald-300 mb-1">Working on now</p>
                <p className="text-chrome text-[13px]">{detail.current.title}</p>
                <p className="text-mist text-xs mt-0.5">{detail.current.pianoName ?? "Shop"}</p>
              </div>
            )}

            {/* edit profile */}
            <div className="card-dark p-4 space-y-3">
              <p className="text-xs uppercase tracking-[0.22em] text-mist flex items-center gap-1.5"><Pencil size={11} /> Profile & rate</p>
              <div className="grid grid-cols-2 gap-2.5">
                <input className={inp} defaultValue={detail.worker.name} id="w-name" />
                <input className={inp} defaultValue={detail.worker.title} id="w-title" />
              </div>
              <div className="flex gap-2.5">
                <input className={inp} type="number" value={editRate} onChange={(e) => setEditRate(e.target.value)} placeholder="Rate ₱/hr" />
                <button
                  onClick={async () => {
                    const name = (document.getElementById("w-name") as HTMLInputElement).value;
                    const title = (document.getElementById("w-title") as HTMLInputElement).value;
                    await updateWorker(detail.worker.id, { name, title, hourlyRateCents: Math.round(Number(editRate) * 100) });
                    const d = await fetchWorkerDetail(detail.worker.id); setDetail(d);
                  }}
                  className="shrink-0 bg-[#22C55E] text-[#04210F] min-h-11 cursor-pointer text-[12px] font-medium rounded-xl px-4 hover:brightness-110 transition">Save</button>
              </div>
              <p className="text-xs text-mist">Rate changes only affect future clock-ins — history keeps its snapshot.</p>
            </div>

            {/* pin + status */}
            <div className="card-dark p-4 space-y-3">
              <p className="text-xs uppercase tracking-[0.22em] text-mist flex items-center gap-1.5"><KeyRound size={11} /> Kiosk PIN</p>
              <div className="flex gap-2.5">
                <input className={inp} inputMode="numeric" maxLength={4} value={newPin} onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ""))} placeholder="New 4-digit PIN" />
                <button onClick={async () => { if (newPin.length === 4) { await resetWorkerPin(detail.worker.id, newPin); setNewPin(""); } }}
                  className="shrink-0 border border-white/15 text-[12px] text-chrome rounded-xl px-4 hover:bg-white/10 transition">Reset PIN</button>
              </div>
              <button onClick={async () => { await updateWorker(detail.worker.id, { active: !detail.worker.active }); const d = await fetchWorkerDetail(detail.worker.id); setDetail(d); }}
                className={`flex items-center gap-2 text-[12px] ${detail.worker.active ? "text-rose-400" : "text-emerald-300"}`}>
                {detail.worker.active ? <><Ban size={13} /> Deactivate account</> : <><CircleCheck size={13} /> Reactivate account</>}
              </button>
            </div>

            {/* completed tasks */}
            <div>
              <p className="text-xs uppercase tracking-[0.22em] text-mist mb-2.5">Completed tasks · {detail.completed.length}</p>
              {detail.completed.length === 0 ? <EmptyState title="No completions yet" /> : (
                <ul className="space-y-1.5">
                  {detail.completed.slice(0, 8).map((t) => (
                    <li key={t.id} className="text-[12px] flex justify-between gap-3 text-chrome/85">
                      <span className="truncate">{t.title}</span>
                      <span className="text-mist shrink-0">{t.completedAt ? timeAgo(new Date(t.completedAt)) : ""}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* time history */}
            <div>
              <p className="text-xs uppercase tracking-[0.22em] text-mist mb-2.5 flex items-center gap-1.5"><Clock3 size={11} /> Time history</p>
              <ul className="space-y-1.5">
                {detail.entries.slice(0, 12).map(({ entry, task }) => {
                  const end = entry.clockOut?.getTime() ?? nowMs;
                  const earned = ((end - entry.clockIn.getTime()) / 3_600_000) * entry.rateAtClockInCents;
                  return (
                    <li key={entry.id} className="card-dark px-3.5 py-2.5 text-xs flex items-center justify-between gap-3">
                      <div>
                        <p className="text-chrome">{fmtDate(new Date(entry.clockIn))} · {fmtTime(new Date(entry.clockIn))}</p>
                        <p className="text-mist text-xs mt-0.5">{task ? task.title : "General"} {entry.clockOut ? "" : "· still clocked in"}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-white tnum">{fmtDuration(end - entry.clockIn.getTime())}</p>
                        <p className="text-emerald-300/90 tnum text-xs">{peso(earned)}</p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
            <div className="card-dark p-4 space-y-3">
              <p className="text-xs text-mist">Permanently deletes this worker account and its attendance, break, and payment records.</p>
              {deleteError && <p role="alert" className="text-rose-400 text-xs">{deleteError}</p>}
              <button onClick={removeWorker} disabled={deleting}
                className="flex items-center gap-2 rounded-xl border border-rose-400/30 px-4 py-2.5 text-[12px] text-rose-400 hover:bg-rose-400/10 transition disabled:opacity-50">
                {deleting ? <Spinner /> : <Trash2 size={13} />}
                {deleting ? "Deleting…" : "Delete worker permanently"}
              </button>
            </div>

          </div>
        )}
      </Drawer>
    </div>
  );
}
