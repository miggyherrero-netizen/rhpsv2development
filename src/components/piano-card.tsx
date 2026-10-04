"use client";

import { useState } from "react";
import { ArrowRight, BadgeCheck, Piano, Ruler } from "lucide-react";
import type { PublicPiano } from "@/server/data";
import { PIANO_STATUS } from "@/lib/config";
import { peso } from "@/lib/format";
import { pianoAlt, type ShowroomGroup } from "@/lib/showroom";
import { Modal, Spinner } from "@/components/ui";
import { submitInquiry } from "@/server/public-actions";
import { FOCUS_RING } from "@/components/public-chrome";

/**
 * TODO(owner): piano photos are currently Facebook-style flyers with the price and logo baked in.
 * Upload clean photos per piano (Admin → Showroom) — this container already crops any photo to a
 * consistent 4:3 frame with object-cover, so clean shots will drop straight in. Price is only ever
 * shown as HTML text below, never relying on the image.
 */
function PianoPhoto({ piano, className = "" }: { piano: PublicPiano; className?: string }) {
  return piano.imageUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={piano.imageUrl} alt={pianoAlt(piano)} loading="lazy" className={`h-full w-full object-cover ${className}`} />
  ) : (
    <div className="h-full w-full flex items-center justify-center text-subtle" role="img" aria-label={`${pianoAlt(piano)} (photo coming soon)`}>
      <Piano size={40} strokeWidth={1} />
    </div>
  );
}

/** The whole card is one control: it opens the instrument dialog. */
export function PianoCard({ group, onOpen }: { group: ShowroomGroup; onOpen: (g: ShowroomGroup) => void }) {
  const p = group.lead;
  const many = group.units.length > 1;
  const st = PIANO_STATUS[p.status] ?? PIANO_STATUS.available;
  const badge = many
    ? `${group.availableCount} available${group.reservedCount ? ` · ${group.reservedCount} reserved` : ""}`
    : st.label;
  const details = [p.type, group.condition, p.recommendedUse ? `for ${p.recommendedUse.toLowerCase()}` : null].filter(Boolean).join(" · ");
  return (
    <button
      type="button"
      onClick={() => onOpen(group)}
      aria-label={`View ${p.brand} ${p.model}${many ? `, ${group.availableCount} available` : ""}`}
      className={`group block w-full text-left rounded-2xl border border-white/8 bg-parchment/40 p-3 transition duration-300 hover:border-gold/50 hover:bg-parchment hover:-translate-y-0.5 hover:shadow-[0_14px_40px_-18px_rgba(0,0,0,0.9)] ${FOCUS_RING}`}
    >
      <div className="relative overflow-hidden rounded-xl bg-parchment aspect-[4/3] ring-1 ring-inset ring-white/10">
        <PianoPhoto piano={p} className="transition-transform duration-700 ease-out group-hover:scale-[1.045]" />
        <span className={`absolute top-3 left-3 text-[10.5px] uppercase tracking-[0.14em] px-2.5 py-1 rounded-full border backdrop-blur-md ${st.cls}`}>
          {badge}
        </span>
      </div>
      <div className="flex items-start justify-between mt-4 gap-3 px-1">
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-[0.2em] text-subtle">{p.brand}{group.year ? ` · ${group.year}` : ""}</p>
          <p className="font-serif text-[1.55rem] leading-none mt-1.5 text-ink group-hover:text-gold transition-colors">{p.model}</p>
          <p className="text-[12px] text-subtle mt-1.5">{details}</p>
        </div>
        <p className="shrink-0 pt-5 text-[13.5px] font-medium tnum text-gold">{p.priceCents ? peso(p.priceCents) : "On request"}</p>
      </div>
      <p className="mt-4 px-1 pb-1 flex items-center gap-1.5 text-[12px] text-ink/80 group-hover:text-gold transition-colors">
        View instrument <ArrowRight size={13} className="transition-transform group-hover:translate-x-1" />
      </p>
    </button>
  );
}

export function PianoDialog({ group, onClose }: { group: ShowroomGroup | null; onClose: () => void }) {
  return (
    <Modal open={!!group} onClose={onClose} title={group ? `${group.lead.brand} ${group.lead.model}` : ""} dark={false} wide>
      {group && <DialogBody key={group.key} group={group} onClose={onClose} />}
    </Modal>
  );
}

function DialogBody({ group }: { group: ShowroomGroup; onClose: () => void }) {
  const [unitIdx, setUnitIdx] = useState(Math.max(0, group.units.indexOf(group.lead)));
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", phone: "", message: "" });
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState("");
  const selected = group.units[unitIdx];

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    const res = await submitInquiry({
      name: form.name,
      phone: form.phone,
      pianoContext: `${selected.brand} ${selected.model}${selected.year ? ` (${selected.year})` : ""}`,
      message: form.message,
      source: "showroom",
    });
    setBusy(false);
    if (res.ok) setSent(true);
    else setErr(res.error ?? "Something went wrong.");
  }

  return (
    <div>
      <div className="relative rounded-xl overflow-hidden bg-paper aspect-[4/3] ring-1 ring-inset ring-white/10">
        <PianoPhoto piano={selected} />
        <span className={`absolute top-3 left-3 text-[10.5px] uppercase tracking-[0.14em] px-2.5 py-1 rounded-full border ${PIANO_STATUS[selected.status]?.cls}`}>
          {PIANO_STATUS[selected.status]?.label}
        </span>
      </div>
      {group.units.length > 1 && (
        <div className="mt-4">
          <p className="text-[10.5px] uppercase tracking-[0.18em] text-subtle mb-2">{group.availableCount} available — pick a unit</p>
          <div className="flex flex-wrap gap-2">
            {group.units.map((u, i) => (
              <button
                key={u.id} type="button" onClick={() => setUnitIdx(i)} aria-pressed={i === unitIdx}
                className={`text-[12px] rounded-full border px-3.5 py-1.5 transition-colors ${FOCUS_RING} ${i === unitIdx ? "border-gold bg-gold/15 text-gold" : "border-white/15 text-chrome hover:border-white/40"}`}
              >
                Unit {i + 1}{u.year ? ` · ${u.year}` : ""}{u.status === "reserved" ? " · reserved" : ""}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="flex items-center justify-between mt-5 gap-3">
        <p className="text-[11px] uppercase tracking-[0.2em] text-subtle">{selected.type}{selected.year ? ` · ${selected.year}` : ""} · {selected.condition}</p>
        <p className="font-serif text-2xl tnum text-gold shrink-0">{selected.priceCents ? peso(selected.priceCents) : "Price on request"}</p>
      </div>
      {selected.description && <p className="text-[14px] text-chrome leading-relaxed mt-4">{selected.description}</p>}
      <div className="grid grid-cols-2 gap-3 mt-5 text-[12.5px]">
        {selected.dimensions && (
          <div className="flex items-start gap-2.5 bg-white/5 rounded-lg p-3"><Ruler size={15} className="text-subtle mt-0.5" /><span><span className="text-subtle block text-[10.5px] uppercase tracking-wide">Dimensions</span>{selected.dimensions}</span></div>
        )}
        {selected.recommendedUse && (
          <div className="flex items-start gap-2.5 bg-white/5 rounded-lg p-3"><BadgeCheck size={15} className="text-subtle mt-0.5" /><span><span className="text-subtle block text-[10.5px] uppercase tracking-wide">Recommended for</span>{selected.recommendedUse}</span></div>
        )}
      </div>
      {selected.technicianNotes && (
        <div className="mt-4 border border-white/10 rounded-xl p-4">
          <p className="text-[10.5px] uppercase tracking-[0.18em] text-subtle mb-1.5">Technician&apos;s notes</p>
          <p className="text-[13px] text-chrome leading-relaxed italic">{selected.technicianNotes}</p>
        </div>
      )}
      {sent ? (
        <div className="mt-6 bg-white/5 rounded-xl p-5 text-center">
          <BadgeCheck size={26} className="mx-auto text-emerald-400" strokeWidth={1.5} />
          <p className="text-[14px] text-ink mt-2.5">Sent — a technician will get back to you within one working day.</p>
        </div>
      ) : open ? (
        <form onSubmit={send} className="mt-6 space-y-2.5">
          <input className="input-dark" required placeholder="Your name" aria-label="Your name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <input
            className="input-dark" required type="tel" inputMode="numeric" aria-label="Phone number"
            pattern="\d{11}" maxLength={11} title="11-digit mobile number, e.g. 09171234567"
            placeholder="Phone number, e.g. 09171234567"
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value.replace(/\D/g, "").slice(0, 11) })}
          />
          <textarea className="input-dark min-h-[80px] resize-y" aria-label="Message" placeholder="Anything else? (optional)" value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} />
          {err && <p className="text-rose-400 text-xs">{err}</p>}
          <button type="submit" disabled={busy} className={`w-full btn-brass text-sm font-medium rounded-xl py-3.5 transition flex items-center justify-center gap-2 ${FOCUS_RING}`}>
            {busy && <Spinner className="text-onbrass" />} Send inquiry
          </button>
        </form>
      ) : (
        <button onClick={() => setOpen(true)} disabled={selected.status === "sold"} className={`mt-6 w-full btn-brass text-sm font-medium rounded-xl py-3.5 transition ${FOCUS_RING}`}>
          {selected.status === "sold" ? "This instrument has found a home" : "Inquire about this piano"}
        </button>
      )}
    </div>
  );
}
