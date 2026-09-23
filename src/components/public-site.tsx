"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowUpRight, ChevronDown, Music, Ruler, BadgeCheck, Sparkles, MapPin,
  Phone, Mail, Clock, Check, Hammer, Piano, Ear, ClipboardCheck, Quote,
  Lock,
} from "lucide-react";
import type { PublicPiano as PianoRow } from "@/server/data";
import { PIANO_STATUS } from "@/lib/config";
import { peso } from "@/lib/format";
import type { WebsiteContent } from "@/lib/website-content";
import { Modal, Spinner } from "@/components/ui";
import { Reveal } from "@/components/reveal";
import { submitInquiry } from "@/server/public-actions";

const px = (id: number, w = 1200, h = 800) =>
  `https://images.pexels.com/photos/${id}/pexels-photo-${id}.jpeg?auto=compress&cs=tinysrgb&fit=crop&w=${w}&h=${h}`;

const CASES = [
  {
    piano: "1911 Steinway & Sons Model O",
    place: "Davao piano service · Full restoration, 14 weeks",
    before: px(18415049, 900, 700),
    after: px(31335120, 900, 700),
    work: ["New Delignit pinblock, torque-tested", "Full restringing — J. Röslau wire", "Soundboard shimmed, crown restored", "Action rebuilt with Abel hammers"],
    note: "The plate showed no fractures — a rare survivor. It now holds a concert tuning for months at a time.",
  },
  {
    piano: "1924 Blüthner Model 11",
    place: "Institutional piano care · Cabinet & stringing, 9 weeks",
    before: px(17708714, 900, 700),
    after: px(34673904, 900, 700),
    work: ["Rim stripped and re-veneered in ebony", "Aliquot stringing preserved and intonated", "Plate re-bronzed to original finish", "Ivory keytops conserved in-house"],
    note: "A beech-rimmed pre-war instrument with its singing aliquot shimmer fully intact.",
  },
  {
    piano: "2005 Fazioli F156",
    place: "Private residence · Finish renewal, 6 weeks",
    before: px(6647431, 900, 700),
    after: px(6647422, 900, 700),
    work: ["Polyester finish wet-sanded through 2000 grit", "Hand-buffed to mirror gloss", "Hardware polished, decal replaced", "Action detailed and lubricated"],
    note: "Six coats, cured and cut back between each. Under workshop light the lid disappears into a black mirror.",
  },
];

const CRAFT = [
  { img: px(31335120, 700, 900), cap: "Tuning", sub: "A=442 concert standard" },
  { img: px(4088808, 700, 900), cap: "Action regulation", sub: "2.0 mm let-off, even touch" },
  { img: px(29704590, 700, 900), cap: "Voicing", sub: "Needle work, three passes" },
  { img: px(11377317, 700, 900), cap: "String work", sub: "J. Röslau wire, hand-coiled" },
  { img: px(37085934, 700, 900), cap: "Cabinet restoration", sub: "Veneer, polyester, French polish" },
  { img: px(12214094, 700, 900), cap: "Final inspection", sub: "Played, played, and played again" },
];

function Overline({ children }: { children: React.ReactNode; light?: boolean }) {
  return (
    <p className="text-[10.5px] uppercase tracking-[0.34em] text-mist">
      {children}
    </p>
  );
}

export default function PublicSite({ pianos, content }: { pianos: PianoRow[]; content: WebsiteContent }) {
  const [scrolled, setScrolled] = useState(false);
  const [selected, setSelected] = useState<PianoRow | null>(null);
  const [form, setForm] = useState({ name: "", phone: "", pianoContext: "", message: "" });
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const assessRef = useRef<HTMLDivElement>(null);

  const [quickOpen, setQuickOpen] = useState(false);
  const [quickForm, setQuickForm] = useState({ name: "", phone: "", message: "" });
  const [quickBusy, setQuickBusy] = useState(false);
  const [quickSent, setQuickSent] = useState(false);
  const [quickErr, setQuickErr] = useState("");

  useEffect(() => {
    const fn = () => setScrolled(window.scrollY > 40);
    window.addEventListener("scroll", fn, { passive: true });
    return () => window.removeEventListener("scroll", fn);
  }, []);

  function closePianoDialog() {
    setSelected(null);
    setQuickOpen(false);
    setQuickForm({ name: "", phone: "", message: "" });
    setQuickBusy(false);
    setQuickSent(false);
    setQuickErr("");
  }

  async function sendQuick(e: React.FormEvent) {
    e.preventDefault();
    if (!selected) return;
    setQuickBusy(true);
    setQuickErr("");
    const res = await submitInquiry({
      name: quickForm.name,
      phone: quickForm.phone,
      pianoContext: `${selected.brand} ${selected.model}${selected.year ? ` (${selected.year})` : ""}`,
      message: quickForm.message,
      source: "showroom",
    });
    setQuickBusy(false);
    if (res.ok) setQuickSent(true);
    else setQuickErr(res.error ?? "Something went wrong.");
  }

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    const res = await submitInquiry({ ...form, source: form.pianoContext ? "showroom" : "assessment" });
    setBusy(false);
    if (res.ok) setSent(true);
    else setErr(res.error ?? "Something went wrong.");
  }

  const availableCount = pianos.filter((p) => p.status === "available").length;

  return (
    <div className="bg-paper text-ink">
      {/* ================= NAV ================= */}
      <header className={`fixed top-0 inset-x-0 z-40 transition-all duration-500 ${scrolled ? "glass-light" : "bg-transparent"}`}>
        <div className="max-w-7xl mx-auto px-5 sm:px-8 h-16 flex items-center justify-between">
          <a href="#top" className="leading-none">
            <span className={`font-serif text-lg tracking-wide transition-colors ${scrolled ? "text-ink" : "text-white"}`}>HERRERO</span>
            <span className={`block text-[8.5px] uppercase tracking-[0.4em] transition-colors ${scrolled ? "text-mist" : "text-white/60"}`}>Pianos · Atelier</span>
          </a>
          <nav className={`hidden md:flex items-center gap-8 text-[12.5px] ${scrolled ? "text-chrome" : "text-white/80"}`}>
            {[["Showroom", "#showroom"], ["Restorations", "#restorations"], ["The Craft", "#craft"], ["Process", "#process"], ["Voices", "#voices"]].map(([label, href]) => (
              <a key={href} href={href} className="hover:opacity-60 transition-opacity">{label}</a>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            <Link
              href="/login-gate"
              aria-label="Open private login"
              title="Open private login"
              className={`grid h-9 w-9 place-items-center rounded-full transition-all border ${
                scrolled ? "bg-parchment text-ink border-white/10 hover:bg-white/10" : "bg-white/10 text-white border-white/25 backdrop-blur-md hover:bg-white/20"
              }`}
            >
              <Lock size={14} />
            </Link>
            <a
              href="#assessment"
              className={`text-[12px] rounded-full px-4 py-2 transition-all ${
                scrolled ? "btn-brass" : "bg-white/10 text-white border border-white/25 backdrop-blur-md hover:bg-white/20"
              }`}
            >
              Book an assessment
            </a>
          </div>
        </div>
      </header>

      {/* ================= HERO ================= */}
      <section id="top" className="relative min-h-[100svh] flex items-end overflow-hidden bg-coal">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/img/hero.jpg" alt="A grand piano in the Herrero atelier" className="absolute inset-0 h-full w-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/25 to-black/40" />
        <div className="relative max-w-7xl mx-auto px-5 sm:px-8 pb-24 pt-40 w-full">
          <p className="text-[10.5px] uppercase tracking-[0.38em] text-white/55 mb-5 anim-fade-up">{content.hero.eyebrow}</p>
          <h1 className="font-serif text-white text-[2.6rem] leading-[1.04] sm:text-6xl lg:text-7xl max-w-3xl anim-fade-up" style={{ animationDelay: "90ms" }}>
            {content.hero.title.split("\n").map((line, index) => (
              <span key={`${line}-${index}`}>
                {line}
                {index < content.hero.title.split("\n").length - 1 && <br />}
              </span>
            ))}
          </h1>
          <p className="text-white/65 max-w-xl mt-6 text-[15px] leading-relaxed anim-fade-up" style={{ animationDelay: "180ms" }}>
            {content.hero.body}
          </p>
          <div className="flex flex-wrap items-center gap-4 mt-9 anim-fade-up" style={{ animationDelay: "260ms" }}>
            <a href="#assessment" className="btn-brass text-sm font-medium rounded-full px-6 py-3 transition-colors">
              {content.hero.primaryCta}
            </a>
            <a href="#showroom" className="text-white/85 text-sm border border-white/30 rounded-full px-6 py-3 hover:bg-white/10 transition-colors flex items-center gap-2">
              {content.hero.secondaryCta} <ArrowUpRight size={15} />
            </a>
          </div>
        </div>
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 text-white/40">
          <ChevronDown size={18} className="anim-pulse-soft" />
        </div>
      </section>

      {/* ================= STATS ================= */}
      <section className="border-b border-white/8 bg-paper">
        <div className="max-w-7xl mx-auto px-5 sm:px-8 py-8 grid grid-cols-2 md:grid-cols-4 gap-6">
          {[
            ["4", "core piano services"],
            ["1,300+", "instruments cared for"],
            [String(availableCount), "pianos in the showroom"],
            ["A=442", "concert tuning standard"],
          ].map(([n, l]) => (
            <div key={l}>
              <p className="font-serif text-3xl text-ink">{n}</p>
              <p className="text-[11px] uppercase tracking-[0.18em] text-mist mt-1">{l}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ================= SHOWROOM ================= */}
      <section id="showroom" className="max-w-7xl mx-auto px-5 sm:px-8 py-24">
        <Reveal>
          <div className="flex items-end justify-between flex-wrap gap-4 mb-12">
            <div>
              <Overline>01 — The Showroom</Overline>
              <h2 className="font-serif text-4xl sm:text-5xl mt-3 text-ink">Instruments ready for a home</h2>
            </div>
            <p className="text-mist text-sm max-w-sm leading-relaxed">
              Every piano below is for sale, priced as marked. Ask a technician for the full story on any instrument before you decide.
            </p>
          </div>
        </Reveal>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-x-7 gap-y-12">
          {pianos.map((p, i) => {
            const st = PIANO_STATUS[p.status] ?? PIANO_STATUS.available;
            return (
              <Reveal key={p.id} delay={(i % 3) * 80}>
                <button onClick={() => setSelected(p)} className="group block text-left w-full">
                  <div className={`relative overflow-hidden rounded-xl bg-parchment aspect-[4/3] ${p.technicianNotes ? "" : "ring-1 ring-inset ring-white/10"}`}>
                    {p.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.imageUrl} alt={`${p.brand} ${p.model}`} loading="lazy"
                        className={`h-full w-full transition-transform duration-700 ease-out group-hover:scale-[1.045] ${p.technicianNotes ? "object-cover" : "object-contain"}`} />
                    ) : (
                      <div className="h-full w-full flex items-center justify-center text-mist"><Piano size={40} strokeWidth={1} /></div>
                    )}
                    <span className={`absolute top-3.5 left-3.5 text-[10.5px] uppercase tracking-[0.14em] px-2.5 py-1 rounded-full border backdrop-blur-md ${st.cls}`}>
                      {st.label}
                    </span>
                  </div>
                  <div className="flex items-start justify-between mt-4 gap-3">
                    <div>
                      <p className="text-[11px] uppercase tracking-[0.2em] text-mist">{p.brand}{p.year ? ` · ${p.year}` : ""}</p>
                      <p className="font-serif text-[1.55rem] leading-none mt-1.5 text-ink group-hover:opacity-70 transition-opacity">{p.model}</p>
                      <p className="text-[12px] text-mist mt-1.5">{p.type} · {p.condition}{p.recommendedUse ? ` · for ${p.recommendedUse.toLowerCase()}` : ""}</p>
                    </div>
                    <div className="text-right shrink-0 pt-5">
                      <p className="text-[13.5px] font-medium tnum text-gold">{p.priceCents ? peso(p.priceCents) : "On request"}</p>
                      <p className="text-[11px] text-mist underline underline-offset-4 mt-1.5 decoration-white/20 group-hover:decoration-gold transition-colors">View instrument</p>
                    </div>
                  </div>
                </button>
              </Reveal>
            );
          })}
        </div>
      </section>

      {/* ================= RESTORATIONS ================= */}
      <section id="restorations" className="bg-parchment text-ink py-24">
        <div className="max-w-7xl mx-auto px-5 sm:px-8">
          <Reveal>
            <Overline light={false}>02 — Recent Restorations</Overline>
            <h2 className="font-serif text-4xl sm:text-5xl mt-3 text-white max-w-2xl">Before & after, told honestly</h2>
          </Reveal>
          <div className="mt-16 space-y-20">
            {CASES.map((c, i) => (
              <Reveal key={c.piano}>
                <div className={`grid lg:grid-cols-2 gap-10 items-center ${i % 2 ? "lg:[&>*:first-child]:order-2" : ""}`}>
                  <div className="grid grid-cols-2 gap-3">
                    <figure className="relative">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={c.before} alt={`${c.piano} before restoration`} loading="lazy" className="rounded-lg aspect-[9/7] object-cover w-full grayscale opacity-80" />
                      <figcaption className="absolute bottom-2.5 left-2.5 text-[9.5px] uppercase tracking-[0.22em] bg-black/55 text-white/80 px-2 py-1 rounded">Before</figcaption>
                    </figure>
                    <figure className="relative">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={c.after} alt={`${c.piano} after restoration`} loading="lazy" className="rounded-lg aspect-[9/7] object-cover w-full" />
                      <figcaption className="absolute bottom-2.5 left-2.5 text-[9.5px] uppercase tracking-[0.22em] bg-white/85 text-black px-2 py-1 rounded">After</figcaption>
                    </figure>
                  </div>
                  <div className={i % 2 ? "lg:pr-4" : "lg:pl-4"}>
                    <p className="text-[11px] uppercase tracking-[0.22em] text-mist">{c.place}</p>
                    <h3 className="font-serif text-3xl text-white mt-2.5">{c.piano}</h3>
                    <ul className="mt-5 space-y-2.5">
                      {c.work.map((w) => (
                        <li key={w} className="flex items-start gap-2.5 text-[13.5px] text-chrome/90">
                          <Check size={15} className="mt-0.5 text-chrome shrink-0" strokeWidth={2.5} /> {w}
                        </li>
                      ))}
                    </ul>
                    <p className="mt-5 text-[13.5px] text-mist leading-relaxed border-l-2 border-white/15 pl-4 italic">{c.note}</p>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ================= CRAFT ================= */}
      <section id="craft" className="max-w-7xl mx-auto px-5 sm:px-8 py-24">
        <Reveal>
          <Overline>03 — Inside the Atelier</Overline>
          <h2 className="font-serif text-4xl sm:text-5xl mt-3 text-ink">The work speaks first</h2>
        </Reveal>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mt-12">
          {CRAFT.map((c, i) => (
            <Reveal key={c.cap} delay={(i % 3) * 70}>
              <figure className="group relative overflow-hidden rounded-xl aspect-[7/9] bg-parchment">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={c.img} alt={c.cap} loading="lazy" className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105" />
                <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-transparent to-transparent" />
                <figcaption className="absolute bottom-4 left-4 right-4">
                  <p className="text-white font-serif text-lg leading-tight">{c.cap}</p>
                  <p className="text-white/60 text-[11.5px] mt-0.5">{c.sub}</p>
                </figcaption>
              </figure>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ================= PROCESS ================= */}
      <section id="process" className="bg-parchment border-y border-white/8 py-24">
        <div className="max-w-7xl mx-auto px-5 sm:px-8">
          <Reveal><Overline>{content.process.eyebrow}</Overline>
            <h2 className="font-serif text-4xl sm:text-5xl mt-3 text-ink max-w-2xl">{content.process.title}</h2>
          </Reveal>
          <div className="grid md:grid-cols-3 gap-10 mt-14">
            {content.process.steps.map((s, i) => {
              const Icon = [ClipboardCheck, Ear, BadgeCheck][i] ?? ClipboardCheck;
              return (
              <Reveal key={s.label} delay={i * 90}>
                <div>
                  <Icon size={26} strokeWidth={1.4} className="text-chrome" />
                  <p className="text-[10.5px] uppercase tracking-[0.26em] text-mist mt-5">{s.label}</p>
                  <h3 className="font-serif text-2xl mt-2 text-ink">{s.title}</h3>
                  <p className="text-mist text-[13.5px] leading-relaxed mt-3 max-w-xs">{s.body}</p>
                </div>
              </Reveal>
            );})}
          </div>
          <Reveal delay={150}>
            <div className="mt-16">
              <p className="text-[10.5px] uppercase tracking-[0.26em] text-mist mb-4">What we check during an assessment</p>
              <div className="flex flex-wrap gap-2.5">
                {content.process.checks.map((c) => (
                  <span key={c} className="text-[12.5px] bg-white/5 border border-white/10 rounded-full px-4 py-2 text-chrome">{c}</span>
                ))}
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ================= VOICES ================= */}
      <section id="voices" className="max-w-7xl mx-auto px-5 sm:px-8 py-24">
        <Reveal><Overline>05 — Voices</Overline>
          <h2 className="font-serif text-4xl sm:text-5xl mt-3 text-ink">Trusted in homes & institutions</h2>
        </Reveal>
        <div className="grid md:grid-cols-3 gap-6 mt-14">
          {content.testimonials.map((t, i) => (
            <Reveal key={t.name} delay={i * 90}>
              <blockquote className="h-full bg-parchment border border-white/8 rounded-2xl p-7 flex flex-col">
                <Quote size={20} className="text-white/15" strokeWidth={1.5} />
                <p className="text-[14.5px] leading-relaxed text-chrome mt-4 flex-1 font-serif italic">&ldquo;{t.quote}&rdquo;</p>
                <footer className="mt-6 pt-5 border-t border-white/8">
                  <p className="text-[13px] font-medium text-ink">{t.name}</p>
                  <p className="text-[11.5px] text-mist mt-0.5">{t.role}</p>
                </footer>
              </blockquote>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ================= ASSESSMENT ================= */}
      <section id="assessment" ref={assessRef} className="bg-parchment text-ink py-24">
        <div className="max-w-7xl mx-auto px-5 sm:px-8 grid lg:grid-cols-2 gap-14 items-start">
          <Reveal>
            <Overline light={false}>06 — Begin</Overline>
            <h2 className="font-serif text-4xl sm:text-5xl mt-3 text-white leading-tight">Tell us about your piano</h2>
            <p className="text-mist text-[14px] leading-relaxed mt-5 max-w-md">
              Brand and model if you know them; a sentence about its history if you don&apos;t. Add photographs later by messenger — a technician, not a sales agent, reads every inquiry.
            </p>
            <div className="mt-10 space-y-4 text-[13.5px] text-chrome/90">
              <p className="flex items-center gap-3"><MapPin size={16} className="text-mist" /> {content.contact.address}</p>
              <p className="flex items-center gap-3"><Phone size={16} className="text-mist" /> {content.contact.phone}</p>
              <p className="flex items-center gap-3"><Mail size={16} className="text-mist" /> {content.contact.email}</p>
              <p className="flex items-center gap-3"><Clock size={16} className="text-mist" /> {content.contact.hours}</p>
            </div>
          </Reveal>
          <Reveal delay={120}>
            {sent ? (
              <div className="glass-dark rounded-2xl p-10 text-center">
                <BadgeCheck size={34} className="mx-auto text-emerald-300" strokeWidth={1.5} />
                <h3 className="font-serif text-2xl text-white mt-4">Received — thank you.</h3>
                <p className="text-mist text-sm mt-3 leading-relaxed">A technician will review your note and reply within one working day with a recommended next step.</p>
              </div>
            ) : (
              <form onSubmit={send} className="glass-dark rounded-2xl p-6 sm:p-8 space-y-4">
                <div className="grid sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[10.5px] uppercase tracking-[0.2em] text-mist mb-1.5">Name *</label>
                    <input className="input-dark" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Your name" />
                  </div>
                  <div>
                    <label className="block text-[10.5px] uppercase tracking-[0.2em] text-mist mb-1.5">Phone *</label>
                    <input
                      className="input-dark" required type="tel" inputMode="numeric"
                      pattern="\d{11}" maxLength={11} title="11-digit mobile number, e.g. 09171234567"
                      value={form.phone}
                      onChange={(e) => setForm({ ...form, phone: e.target.value.replace(/\D/g, "").slice(0, 11) })}
                      placeholder="09171234567"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-[10.5px] uppercase tracking-[0.2em] text-mist mb-1.5">The piano</label>
                  <input className="input-dark" value={form.pianoContext} onChange={(e) => setForm({ ...form, pianoContext: e.target.value })} placeholder="e.g. Yamaha U1, about 30 years old" />
                </div>
                <div>
                  <label className="block text-[10.5px] uppercase tracking-[0.2em] text-mist mb-1.5">Your situation</label>
                  <textarea className="input-dark min-h-[104px] resize-y" value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} placeholder="What would you like help with?" />
                </div>
                {err && <p className="text-rose-400 text-xs">{err}</p>}
                <button type="submit" disabled={busy} className="w-full btn-brass text-sm font-medium rounded-xl py-3.5 transition flex items-center justify-center gap-2">
                  {busy && <Spinner className="text-onbrass" />} Send for assessment
                </button>
                <p className="text-[10.5px] text-mist/60 text-center">Reviewed by a technician · no obligation · replies within one working day</p>
              </form>
            )}
          </Reveal>
        </div>
      </section>

      {/* ================= FOOTER ================= */}
      <footer className="bg-coal text-mist">
        <div className="max-w-7xl mx-auto px-5 sm:px-8 py-14 grid md:grid-cols-4 gap-10 text-[13px]">
          <div>
            <p className="font-serif text-xl text-white">HERRERO</p>
            <p className="text-[9px] uppercase tracking-[0.4em] mt-1">Pianos · Atelier</p>
            <p className="mt-5 text-mist/80 leading-relaxed max-w-[220px]">Piano sales, tuning, repair, restoration, transport, and buying guidance — Davao.</p>
          </div>
          <div>
            <p className="text-white text-[11px] uppercase tracking-[0.2em] mb-4">Visit</p>
            <p className="leading-relaxed">{content.contact.address}</p>
            <p className="mt-3">{content.contact.hours}</p>
          </div>
          <div>
            <p className="text-white text-[11px] uppercase tracking-[0.2em] mb-4">Atelier</p>
            <ul className="space-y-2.5">
              <li><a href="#showroom" className="hover:text-white transition-colors">Showroom</a></li>
              <li><a href="#restorations" className="hover:text-white transition-colors">Restorations</a></li>
              <li><a href="#assessment" className="hover:text-white transition-colors">Book an assessment</a></li>
            </ul>
          </div>
          <div>
            <p className="text-white text-[11px] uppercase tracking-[0.2em] mb-4">Private access</p>
            <ul className="space-y-2.5">
              <li><span className="text-mist/60">Client portal links are issued privately.</span></li>
              <li><Link href="/workshop" className="hover:text-white transition-colors flex items-center gap-1.5"><Hammer size={13} /> Workshop kiosk</Link></li>
              <li><Link href="/login-gate" className="hover:text-white transition-colors flex items-center gap-1.5"><Sparkles size={13} /> Owner sign-in</Link></li>
            </ul>
          </div>
        </div>
        <div className="border-t border-white/5 py-5 text-center text-[11px] text-mist/50 flex items-center justify-center gap-1.5">
          <Music size={12} /> © {new Date().getFullYear()} Herrero Pianos · Tuned to A=442
        </div>
      </footer>

      {/* ================= PIANO DIALOG ================= */}
      <Modal open={!!selected} onClose={closePianoDialog} title={selected ? `${selected.brand} ${selected.model}` : ""} dark={false} wide>
        {selected && (
          <div>
            <div className={`relative rounded-xl overflow-hidden bg-paper ${selected.technicianNotes ? "aspect-[16/9]" : "aspect-[4/5] ring-1 ring-inset ring-white/10"}`}>
              {selected.imageUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={selected.imageUrl} alt={`${selected.brand} ${selected.model}`}
                  className={`h-full w-full ${selected.technicianNotes ? "object-cover" : "object-contain"}`} />
              )}
              <span className={`absolute top-3 left-3 text-[10.5px] uppercase tracking-[0.14em] px-2.5 py-1 rounded-full border ${PIANO_STATUS[selected.status]?.cls}`}>
                {PIANO_STATUS[selected.status]?.label}
              </span>
            </div>
            <div className="flex items-center justify-between mt-5">
              <p className="text-[11px] uppercase tracking-[0.2em] text-mist">{selected.type}{selected.year ? ` · ${selected.year}` : ""} · {selected.condition}</p>
              <p className="font-serif text-2xl tnum text-gold">{selected.priceCents ? peso(selected.priceCents) : "Price on request"}</p>
            </div>
            {selected.description && <p className="text-[14px] text-chrome leading-relaxed mt-4">{selected.description}</p>}
            <div className="grid grid-cols-2 gap-3 mt-5 text-[12.5px]">
              {selected.dimensions && (
                <div className="flex items-start gap-2.5 bg-white/5 rounded-lg p-3"><Ruler size={15} className="text-mist mt-0.5" /><span><span className="text-mist block text-[10.5px] uppercase tracking-wide">Dimensions</span>{selected.dimensions}</span></div>
              )}
              {selected.recommendedUse && (
                <div className="flex items-start gap-2.5 bg-white/5 rounded-lg p-3"><BadgeCheck size={15} className="text-mist mt-0.5" /><span><span className="text-mist block text-[10.5px] uppercase tracking-wide">Recommended for</span>{selected.recommendedUse}</span></div>
              )}
            </div>
            {selected.technicianNotes && (
              <div className="mt-4 border border-white/10 rounded-xl p-4">
                <p className="text-[10.5px] uppercase tracking-[0.18em] text-mist mb-1.5">Technician&apos;s notes</p>
                <p className="text-[13px] text-chrome leading-relaxed italic">{selected.technicianNotes}</p>
              </div>
            )}
            {quickSent ? (
              <div className="mt-6 bg-white/5 rounded-xl p-5 text-center">
                <BadgeCheck size={26} className="mx-auto text-emerald-400" strokeWidth={1.5} />
                <p className="text-[14px] text-ink mt-2.5">Sent — a technician will get back to you within one working day.</p>
              </div>
            ) : quickOpen ? (
              <form onSubmit={sendQuick} className="mt-6 space-y-2.5">
                <input
                  className="input-dark" required placeholder="Your name"
                  value={quickForm.name} onChange={(e) => setQuickForm({ ...quickForm, name: e.target.value })}
                />
                <input
                  className="input-dark" required type="tel" inputMode="numeric"
                  pattern="\d{11}" maxLength={11} title="11-digit mobile number, e.g. 09171234567"
                  placeholder="Phone number, e.g. 09171234567"
                  value={quickForm.phone}
                  onChange={(e) => setQuickForm({ ...quickForm, phone: e.target.value.replace(/\D/g, "").slice(0, 11) })}
                />
                <textarea
                  className="input-dark min-h-[80px] resize-y" placeholder="Anything else? (optional)"
                  value={quickForm.message} onChange={(e) => setQuickForm({ ...quickForm, message: e.target.value })}
                />
                {quickErr && <p className="text-rose-400 text-xs">{quickErr}</p>}
                <button type="submit" disabled={quickBusy}
                  className="w-full btn-brass text-sm font-medium rounded-xl py-3.5 transition flex items-center justify-center gap-2">
                  {quickBusy && <Spinner className="text-onbrass" />} Send inquiry
                </button>
              </form>
            ) : (
              <button onClick={() => setQuickOpen(true)} disabled={selected.status === "sold"}
                className="mt-6 w-full btn-brass text-sm font-medium rounded-xl py-3.5 transition">
                {selected.status === "sold" ? "This instrument has found a home" : "Inquire about this piano"}
              </button>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
