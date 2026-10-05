"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight, BadgeCheck, Piano, Ruler } from "lucide-react";
import type { PublicPiano } from "@/server/data";
import { PIANO_STATUS } from "@/lib/config";
import { titleCase } from "@/lib/pub-text";
import { peso } from "@/lib/format";
import { pianoAlt, type ShowroomGroup } from "@/lib/showroom";
import { Modal, Spinner } from "@/components/ui";
import { submitInquiry } from "@/server/public-actions";
import { FOCUS_RING } from "@/components/public-chrome";

/**
 * Photos are whatever the owner pasted in: Facebook-style flyers (tall, price and logo baked in), phone shots, wide shots.
 * So the whole picture is always shown (object-contain — nothing is cropped off), sitting on a soft blurred copy of itself so
 * a tall flyer or a wide shot never leaves empty bars. `no-referrer` stops sites that block hot-linking (Facebook CDN…) from
 * refusing the image, and a photo that still fails to load becomes a quiet "Photo coming soon" tile instead of a broken icon.
 * Price is only ever shown as HTML text below, never relying on the image.
 */
function PianoPhoto({ piano, className = "" }: { piano: PublicPiano; className?: string }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const mainRef = useRef<HTMLImageElement>(null);
  const url = piano.imageUrl;
  // The browser can give up on a bad URL before React has attached onError (server-rendered page), so check once on mount too.
  useEffect(() => {
    const img = mainRef.current;
    if (url && img && img.complete && img.naturalWidth === 0) setFailedUrl(url);
  }, [url]);
  if (!url || failedUrl === url) {
    return (
      <div className="h-full w-full flex flex-col items-center justify-center gap-2 bg-parchment text-subtle" role="img" aria-label={`${pianoAlt(piano)} (photo coming soon)`}>
        <Piano size={40} strokeWidth={1.2} aria-hidden="true" />
        <span className="text-[14px]">Photo Coming Soon</span>
      </div>
    );
  }
  return (
    <div className="relative h-full w-full overflow-hidden bg-parchment">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt="" aria-hidden="true" referrerPolicy="no-referrer" className="absolute inset-0 h-full w-full object-cover scale-125 blur-2xl opacity-60" />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img ref={mainRef} src={url} alt={pianoAlt(piano)} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailedUrl(url)} className={`relative h-full w-full object-contain ${className}`} />
    </div>
  );
}

/** Availability tag in the public palette (sky dot = available, terracotta = reserved, olive = sold). It sits in the text area, never over the photo — flyers carry their own logo and price. */
const STATUS_PILL: Record<string, string> = {
  available: "bg-paper text-ink border-line",
  reserved: "bg-paper text-ink border-line",
  sold: "bg-paper text-subtle border-line",
};
/** The small dot in front of the availability text. */
const STATUS_DOT: Record<string, string> = { available: "bg-sky", reserved: "bg-terracotta", sold: "bg-olive" };

function StatusPill({ status, children, className = "" }: { status: string; children: React.ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 text-[13.5px] font-semibold px-3 py-1 rounded-full border whitespace-nowrap ${STATUS_PILL[status] ?? STATUS_PILL.available} ${className}`}>
      <span aria-hidden="true" className={`h-2 w-2 rounded-full ${STATUS_DOT[status] ?? STATUS_DOT.available}`} />
      {children}
    </span>
  );
}

/** The whole card is one control: it opens the instrument dialog. */
export function PianoCard({ group, onOpen }: { group: ShowroomGroup; onOpen: (g: ShowroomGroup) => void }) {
  const p = group.lead;
  const many = group.units.length > 1;
  const st = PIANO_STATUS[p.status] ?? PIANO_STATUS.available;
  const badge = many
    ? `${group.availableCount} Available${group.reservedCount ? ` · ${group.reservedCount} Reserved` : ""}`
    : st.label;
  const details = titleCase([p.type, group.condition, p.recommendedUse ? `for ${p.recommendedUse}` : null].filter(Boolean).join(" · "));
  return (
    <button
      type="button"
      onClick={() => onOpen(group)}
      aria-label={`View ${p.brand} ${p.model}${many ? `, ${group.availableCount} available` : ""}`}
      className={`group block w-full text-left rounded-2xl border border-white/8 bg-card p-3 shadow-[0_14px_30px_-22px_rgba(46,47,56,0.35)] transition duration-300 hover:border-gold/60 hover:-translate-y-0.5 hover:shadow-[0_22px_40px_-22px_rgba(46,47,56,0.45)] ${FOCUS_RING}`}
    >
      <div className="relative overflow-hidden rounded-xl bg-parchment aspect-[4/3] ring-1 ring-inset ring-white/10">
        <PianoPhoto key={p.id} piano={p} className="transition-transform duration-700 ease-out group-hover:scale-[1.03]" />
      </div>
      {/* Brand and year on the left, availability on the right: the tag lives here, off the photo */}
      <div className="flex items-center justify-between gap-3 mt-4 px-1">
        <p className="text-[14.5px] font-medium text-subtle min-w-0 truncate">{p.brand}{group.year ? ` · ${group.year}` : ""}</p>
        <StatusPill status={p.status}>{badge}</StatusPill>
      </div>
      <div className="flex items-end justify-between mt-2 gap-3 px-1">
        <p className="font-serif font-medium text-[2rem] leading-none text-ink group-hover:text-gold transition-colors">{p.model}</p>
        <p className="shrink-0 text-[16.5px] font-semibold tnum text-gold">{p.priceCents ? peso(p.priceCents) : "On Request"}</p>
      </div>
      <p className="text-[14.5px] text-subtle mt-2.5 px-1">{details}</p>
      <p className="mt-4 px-1 pb-1 flex items-center gap-1.5 text-[15px] font-semibold text-gold">
        <span className="border-b-[1.5px] border-olive pb-px">View Instrument</span> <ArrowRight size={14} className="transition-transform group-hover:translate-x-1" />
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
        <PianoPhoto key={selected.id} piano={selected} />
      </div>
      {group.units.length > 1 && (
        <div className="mt-4">
          <p className="text-[14px] font-medium text-subtle mb-2">{group.availableCount} Available — Pick a Unit</p>
          <div className="flex flex-wrap gap-2">
            {group.units.map((u, i) => (
              <button
                key={u.id} type="button" onClick={() => setUnitIdx(i)} aria-pressed={i === unitIdx}
                className={`text-[14px] font-medium rounded-full border px-4 min-h-10 transition-colors ${FOCUS_RING} ${i === unitIdx ? "border-gold bg-gold text-onbrass" : "border-white/15 bg-card text-ink hover:border-gold"}`}
              >
                Unit {i + 1}{u.year ? ` · ${u.year}` : ""}{u.status === "reserved" ? " · Reserved" : ""}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="flex items-center justify-between mt-5 gap-3 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap min-w-0">
          <StatusPill status={selected.status}>{PIANO_STATUS[selected.status]?.label}</StatusPill>
          <p className="text-[14.5px] text-subtle">{titleCase(`${selected.type}${selected.year ? ` · ${selected.year}` : ""} · ${selected.condition}`)}</p>
        </div>
        <p className="font-serif font-medium text-[1.75rem] tnum text-gold shrink-0">{selected.priceCents ? peso(selected.priceCents) : "Price on Request"}</p>
      </div>
      {selected.description && <p className="text-[16px] text-chrome leading-relaxed mt-4">{selected.description}</p>}
      <div className="grid grid-cols-2 gap-3 mt-5 text-[14.5px]">
        {selected.dimensions && (
          <div className="flex items-start gap-2.5 bg-white/5 rounded-lg p-3"><Ruler size={16} className="text-gold mt-0.5" /><span><span className="text-subtle block text-[13px]">Dimensions</span>{selected.dimensions}</span></div>
        )}
        {selected.recommendedUse && (
          <div className="flex items-start gap-2.5 bg-white/5 rounded-lg p-3"><BadgeCheck size={16} className="text-gold mt-0.5" /><span><span className="text-subtle block text-[13px]">Recommended For</span>{titleCase(selected.recommendedUse)}</span></div>
        )}
      </div>
      {selected.technicianNotes && (
        <div className="mt-4 border border-white/10 rounded-xl p-4">
          <p className="text-[14px] font-semibold text-ink mb-1.5">Technician&apos;s Notes</p>
          <p className="text-[15px] text-chrome leading-relaxed font-serif">{selected.technicianNotes}</p>
        </div>
      )}
      {sent ? (
        <div className="mt-6 bg-white/5 rounded-xl p-5 text-center">
          <BadgeCheck size={28} className="mx-auto text-emerald-700" strokeWidth={1.5} />
          <p className="text-[15.5px] text-ink mt-2.5">Sent — a technician will get back to you within one working day.</p>
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
          {err && <p role="alert" className="text-red-700 text-[14px]">{err}</p>}
          <button type="submit" disabled={busy} className={`w-full btn-brass text-[15.5px] rounded-full min-h-12 transition flex items-center justify-center gap-2 ${FOCUS_RING}`}>
            {busy && <Spinner className="text-onbrass" />} Send Inquiry
          </button>
        </form>
      ) : (
        <button onClick={() => setOpen(true)} disabled={selected.status === "sold"} className={`mt-6 w-full btn-brass text-[15.5px] rounded-full min-h-12 transition ${FOCUS_RING}`}>
          {selected.status === "sold" ? "This Instrument Has Found a Home" : "Inquire About This Piano"}
        </button>
      )}
    </div>
  );
}
