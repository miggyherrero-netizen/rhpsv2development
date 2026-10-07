"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { GosAd } from "@/db/gos-schema";
import { CAME_FROM } from "@/lib/gos/customers";
import { addCustomer, type DuplicateHit } from "@/server/gos/customers";
import { listAds } from "@/server/gos/settings";

const EMPTY = { name: "", phone: "", area: "", cameFrom: "Messenger" as (typeof CAME_FROM)[number], adChoice: "unknown" as "ad" | "unknown" | "none", adId: null as string | null, note: "" };

export default function AddInquiry() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [showPhone, setShowPhone] = useState(false);
  const [ads, setAds] = useState<GosAd[]>([]);
  const [busy, setBusy] = useState(false);
  const [nameError, setNameError] = useState("");
  const [formError, setFormError] = useState("");
  const [dup, setDup] = useState<DuplicateHit | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  const dirty = JSON.stringify(form) !== JSON.stringify(EMPTY);

  useEffect(() => {
    if (!open) return;
    nameRef.current?.focus();
    void listAds().then((r) => r.ok && setAds(r.value.filter((a) => !a.retired)));
  }, [open]);

  function close() {
    setOpen(false); setForm(EMPTY); setShowPhone(false); setNameError(""); setFormError(""); setDup(null); setConfirmDiscard(false);
    setTimeout(() => opener.current?.focus(), 0);
  }
  function tryClose() {
    if (dirty) setConfirmDiscard(true); else close();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") { e.stopPropagation(); tryClose(); return; }
    if (e.key !== "Tab" || !panel.current) return;
    const els = panel.current.querySelectorAll<HTMLElement>("button, input, select, textarea, a[href]");
    const list = Array.from(els).filter((el) => !el.hasAttribute("disabled"));
    if (list.length === 0) return;
    const first = list[0], last = list[list.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  async function save(confirmNew = false) {
    if (busy) return;
    setFormError("");
    if (form.name.trim() === "") { setNameError("Add a name so you can find this customer later."); nameRef.current?.focus(); return; }
    setNameError("");
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      setFormError("No internet. Your typing is kept — tap Save again when you have signal.");
      return;
    }
    setBusy(true);
    try {
      const res = await addCustomer(form, confirmNew);
      if (res.ok) {
        const name = form.name.trim();
        close();
        router.push(`/os/customers/${res.value.id}?added=${encodeURIComponent(name)}`);
        return;
      }
      if ("duplicate" in res) { setDup(res.duplicate); return; }
      setFormError(res.error);
    } catch {
      setFormError("Couldn't save. Your typing is kept. Try Save again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button ref={opener} type="button" className="gos-btn-black" onClick={() => setOpen(true)}>+ Add inquiry</button>
      {open && (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-[#14201b]/50 lg:items-stretch lg:justify-end"
          onMouseDown={(e) => { if (e.target === e.currentTarget) tryClose(); }}>
          <div ref={panel} role="dialog" aria-modal="true" aria-label="Add inquiry" onKeyDown={onKeyDown}
            className="max-h-[92dvh] w-full overflow-y-auto rounded-t-[20px] bg-white p-5 shadow-2xl lg:max-h-none lg:w-[480px] lg:rounded-none">
            <h2 className="text-xl font-bold">Add inquiry</h2>
            <div className="mt-3 space-y-4">
              <label className="block">
                <span className="font-bold">Name</span>
                <input ref={nameRef} aria-label="Name" className="gos-input mt-1" maxLength={60} value={form.name} aria-invalid={!!nameError}
                  onChange={(e) => { setForm({ ...form, name: e.target.value }); setDup(null); }} />
                <span className="text-xs text-[var(--gos-ink-dim)]">{form.name.length}/60</span>
                {nameError && <span role="alert" className="block text-sm text-[var(--gos-danger)]">✕ {nameError}</span>}
              </label>
              {showPhone ? (
                <label className="block">
                  <span className="font-bold">Phone (optional)</span>
                  <input className="gos-input mt-1" inputMode="tel" maxLength={30} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
                </label>
              ) : (
                <button type="button" className="gos-tap gos-link" onClick={() => setShowPhone(true)}>+ Add phone</button>
              )}
              <label className="block">
                <span className="font-bold">Area (optional)</span>
                <input className="gos-input mt-1" maxLength={60} value={form.area} onChange={(e) => setForm({ ...form, area: e.target.value })} />
              </label>
              <label className="block">
                <span className="font-bold">Came from</span>
                <select className="gos-input mt-1" value={form.cameFrom}
                  onChange={(e) => setForm({ ...form, cameFrom: e.target.value as typeof form.cameFrom })}>
                  {CAME_FROM.map((c) => <option key={c}>{c}</option>)}
                </select>
              </label>
              {form.cameFrom === "Messenger" && (
                <fieldset>
                  <legend className="font-bold">Which ad?</legend>
                  <div className="mt-1 space-y-1">
                    {ads.map((a) => (
                      <label key={a.id} className="gos-tap flex items-center gap-3">
                        <input type="radio" name="ad" checked={form.adChoice === "ad" && form.adId === a.id}
                          onChange={() => setForm({ ...form, adChoice: "ad", adId: a.id })} /> {a.name}
                      </label>
                    ))}
                    <label className="gos-tap flex items-center gap-3">
                      <input type="radio" name="ad" checked={form.adChoice === "unknown"} onChange={() => setForm({ ...form, adChoice: "unknown", adId: null })} /> Don&apos;t know
                    </label>
                    <label className="gos-tap flex items-center gap-3">
                      <input type="radio" name="ad" checked={form.adChoice === "none"} onChange={() => setForm({ ...form, adChoice: "none", adId: null })} /> Not from an ad
                    </label>
                  </div>
                </fieldset>
              )}
              <label className="block">
                <span className="font-bold">Note (optional)</span>
                <textarea aria-label="Note (optional)" className="gos-input mt-1 min-h-20" maxLength={500} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
                <span className="text-xs text-[var(--gos-ink-dim)]">{form.note.length}/500</span>
              </label>

              {dup && (
                <div role="alert" className="gos-card space-y-2 border-[var(--gos-danger)]">
                  <p>You already have <b>{dup.name}</b>{dup.area ? ` (${dup.area})` : ""}. Same person?</p>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className="gos-btn-black" onClick={() => { const id = dup.id; close(); router.push(`/os/customers/${id}`); }}>Yes, open her record</button>
                    <button type="button" className="gos-btn-ghost" onClick={() => void save(true)}>No, add new</button>
                  </div>
                </div>
              )}
              {formError && <p role="alert" className="text-sm text-[var(--gos-danger)]">✕ {formError}</p>}
              {confirmDiscard && (
                <div role="alertdialog" aria-label="Discard this inquiry?" className="gos-card space-y-2">
                  <p className="font-bold">Discard this inquiry?</p>
                  <div className="flex gap-2">
                    <button type="button" autoFocus className="gos-btn-black" onClick={() => setConfirmDiscard(false)}>Keep editing</button>
                    <button type="button" className="gos-btn-ghost" onClick={close}>Discard</button>
                  </div>
                </div>
              )}
              <div className="sticky bottom-0 -mx-5 -mb-5 flex gap-2 border-t border-[var(--gos-line)] bg-white p-4">
                <button type="button" className="gos-btn-black" disabled={busy} onClick={() => void save(false)}>{busy ? "Saving…" : "Save"}</button>
                <button type="button" className="gos-btn-ghost" onClick={tryClose}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
