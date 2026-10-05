"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowRight, ArrowUpRight, ChevronDown, BadgeCheck, MapPin,
  Phone, Mail, Clock, Check, Ear, ClipboardCheck, Quote, ExternalLink,
} from "lucide-react";
import type { PublicPiano as PianoRow } from "@/server/data";
import type { WebsiteContent } from "@/lib/website-content";
import { Spinner } from "@/components/ui";
import { Reveal } from "@/components/reveal";
import { submitInquiry } from "@/server/public-actions";
import { FEATURED_COUNT, HERO_IMAGE, SERVING_SINCE_YEAR } from "@/lib/site-config";
import { featuredGroups, groupPianos, type ShowroomGroup } from "@/lib/showroom";
import { PianoCard, PianoDialog } from "@/components/piano-card";
import { PUB_ROOT } from "@/lib/pub-fonts";
import { FOCUS_RING, MessengerButton, MobileContactBar, PhoneText, SiteFooter, SiteHeader } from "@/components/public-chrome";

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

/** "How We Work" -> "How we work". Only touches labels where every word starts with a capital; anything else (A=442, WiFi) is left alone. */
const sentenceCase = (t: string) => {
  const words = t.trim().split(/\s+/);
  const titleCased = words.length > 1 && words.every((w) => /^[A-Z][a-z'’]*$/.test(w) || /^(&|and|of|the|in|for|to)$/i.test(w));
  return titleCased ? t.charAt(0) + t.slice(1).replace(/\b([A-Z])([a-z'’]*)\b/g, (_m, c: string, r: string) => c.toLowerCase() + r) : t;
};

/** Section label: a short rule + sentence case. A leading "01 —" is dropped: these sections are not a sequence. */
function Overline({ children }: { children: React.ReactNode; light?: boolean }) {
  const text = typeof children === "string" ? sentenceCase(children.replace(/^\s*\d+\s*[—–-]\s*/, "")) : children;
  return <p className="pub-kicker">{text}</p>;
}

const H2 = "font-serif font-medium tracking-[-0.01em] text-[2.4rem] leading-[1.08] sm:text-5xl lg:text-[3.25rem] mt-3.5 text-ink";

export default function PublicSite({ pianos, content }: { pianos: PianoRow[]; content: WebsiteContent }) {
  const [openGroup, setOpenGroup] = useState<ShowroomGroup | null>(null);
  const [form, setForm] = useState({ name: "", phone: "", pianoContext: "", message: "" });
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const assessRef = useRef<HTMLDivElement>(null);

  const groups = useMemo(() => groupPianos(pianos), [pianos]);
  const featured = useMemo(() => featuredGroups(groups, FEATURED_COUNT), [groups]);

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
    <div className={`${PUB_ROOT} bg-paper text-ink`}>
      <SiteHeader home />

      {/* ================= HERO ================= */}
      <section id="top" className="pub-dark relative min-h-[100svh] flex items-end overflow-hidden bg-coal">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={content.hero.imageVersion ? `/hero-image?v=${content.hero.imageVersion}` : HERO_IMAGE.src} alt={content.hero.imageAlt || HERO_IMAGE.alt} style={{ objectPosition: HERO_IMAGE.position }} className="absolute inset-0 h-full w-full object-cover" />
        {/* Slate-tinted scrims, strongest only behind the words so the room stays visible: a bottom-up fade, a left-side scrim, and a light top fade for the nav. */}
        <div className="absolute inset-0 bg-gradient-to-t from-coal/95 via-coal/75 via-50% to-transparent to-92%" />
        <div className="absolute inset-0 bg-gradient-to-r from-coal/80 via-coal/35 via-55% to-transparent" />
        {/* Phones: the words span the full width, so tint the whole photo a little more */}
        <div className="absolute inset-0 bg-coal/35 sm:hidden" />
        <div className="relative max-w-7xl mx-auto px-5 sm:px-8 pb-24 pt-40 w-full">
          <p className="pub-kicker !text-white/95 mb-5 anim-fade-up">{content.hero.eyebrow}</p>
          <h1 className="font-serif font-medium tracking-[-0.015em] text-white text-[2.75rem] leading-[1.03] sm:text-6xl lg:text-[4.9rem] max-w-3xl anim-fade-up" style={{ animationDelay: "90ms" }}>
            {content.hero.title.split("\n").map((line, index) => (
              <span key={`${line}-${index}`}>
                {line}
                {index < content.hero.title.split("\n").length - 1 && <br />}
              </span>
            ))}
          </h1>
          <p className="text-white/95 max-w-xl mt-6 text-[16.5px] leading-relaxed anim-fade-up" style={{ animationDelay: "180ms" }}>
            {content.hero.body}
          </p>
          <div className="flex flex-wrap items-center gap-4 mt-9 anim-fade-up" style={{ animationDelay: "260ms" }}>
            <a href="#assessment" className={`btn-brass inline-flex items-center text-[15px] rounded-full px-7 min-h-12 transition-colors ${FOCUS_RING}`}>
              {content.hero.primaryCta}
            </a>
            <a href="#showroom" className={`text-white text-[15px] font-semibold border border-white/45 bg-coal/40 backdrop-blur-sm rounded-full px-7 min-h-12 hover:bg-white/10 transition-colors flex items-center gap-2 ${FOCUS_RING}`}>
              {content.hero.secondaryCta} <ArrowUpRight size={15} />
            </a>
            <MessengerButton label="Message us" className="!border-white/40 !text-white !bg-coal/40 backdrop-blur-sm hover:!bg-white/10" />
          </div>
        </div>
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 text-white/70" aria-hidden="true">
          <ChevronDown size={18} className="anim-pulse-soft" />
        </div>
      </section>

      {/* ================= STATS ================= */}
      {(() => {
        // "Serving Davao since" only appears once SERVING_SINCE_YEAR is set in src/lib/site-config.ts.
        const stats = [
          ...(SERVING_SINCE_YEAR ? [{ n: String(SERVING_SINCE_YEAR), l: "Serving Davao since", caption: undefined as string | undefined }] : []),
          { n: "1,300+", l: "Pianos tuned & serviced", caption: undefined as string | undefined },
          { n: String(availableCount), l: "pianos in the showroom", caption: undefined as string | undefined },
          { n: "A=442", l: "Tuning pitch", caption: "concert pitch standard" as string | undefined },
        ];
        return (
          <section className="border-b border-white/8 bg-parchment">
            <div className={`max-w-7xl mx-auto px-5 sm:px-8 py-9 grid grid-cols-2 gap-6 ${stats.length === 4 ? "md:grid-cols-4" : "md:grid-cols-3"}`}>
              {stats.map((st) => (
                <div key={st.l}>
                  <p className="font-serif font-medium text-[2.4rem] leading-none text-ink">{st.n}</p>
                  <p className="text-[15px] text-subtle mt-2">{st.l}</p>
                  {st.caption && <p className="text-[13.5px] text-subtle mt-0.5">{st.caption}</p>}
                </div>
              ))}
            </div>
          </section>
        );
      })()}

      {/* ================= SHOWROOM ================= */}
      <section id="showroom" className="max-w-7xl mx-auto px-5 sm:px-8 py-24">
        <Reveal>
          <div className="flex items-end justify-between flex-wrap gap-4 mb-12">
            <div>
              <Overline>01 — The Showroom</Overline>
              <h2 className={H2}>Instruments ready for a home</h2>
            </div>
            <p className="text-subtle text-[16px] max-w-sm leading-relaxed">
              Every piano below is for sale, priced as marked. Ask a technician for the full story on any instrument before you decide.
            </p>
          </div>
        </Reveal>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {featured.map((g, i) => (
            <Reveal key={g.key} delay={(i % 3) * 80}>
              <PianoCard group={g} onOpen={setOpenGroup} />
            </Reveal>
          ))}
        </div>
        <div className="mt-12 flex justify-center">
          <Link href="/showroom" className={`inline-flex items-center gap-2 rounded-full border-[1.5px] border-ink text-ink hover:bg-ink hover:text-paper transition-colors px-8 min-h-12 text-[15px] font-semibold ${FOCUS_RING}`}>
            See all {pianos.length} instruments <ArrowRight size={15} />
          </Link>
        </div>
      </section>

      {/* ================= RESTORATIONS ================= */}
      <section id="restorations" className="bg-parchment text-ink py-24">
        <div className="max-w-7xl mx-auto px-5 sm:px-8">
          <Reveal>
            <Overline light={false}>02 — Recent Restorations</Overline>
            <h2 className={`${H2} max-w-2xl`}>Before &amp; after, told honestly</h2>
          </Reveal>
          <div className="mt-16 space-y-20">
            {CASES.map((c, i) => (
              <Reveal key={c.piano}>
                <div className={`grid lg:grid-cols-2 gap-10 items-center ${i % 2 ? "lg:[&>*:first-child]:order-2" : ""}`}>
                  <div className="grid grid-cols-2 gap-3">
                    <figure className="relative">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={c.before} alt={`${c.piano} grand piano before restoration — ${c.place}`} loading="lazy" className="rounded-lg aspect-[9/7] object-cover w-full grayscale opacity-80" />
                      <figcaption className="absolute bottom-3 left-3 text-[13px] font-semibold bg-coal/75 text-white px-2.5 py-1 rounded-md">Before</figcaption>
                    </figure>
                    <figure className="relative">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={c.after} alt={`${c.piano} grand piano after restoration — ${c.work[0].toLowerCase()}`} loading="lazy" className="rounded-lg aspect-[9/7] object-cover w-full" />
                      <figcaption className="absolute bottom-3 left-3 text-[13px] font-semibold bg-paper/95 text-ink px-2.5 py-1 rounded-md">After</figcaption>
                    </figure>
                  </div>
                  <div className={i % 2 ? "lg:pr-4" : "lg:pl-4"}>
                    <p className="text-[14px] font-medium text-gold">{c.place}</p>
                    <h3 className="font-serif font-medium text-[2rem] leading-tight text-ink mt-2">{c.piano}</h3>
                    <ul className="mt-5 space-y-2.5">
                      {c.work.map((w) => (
                        <li key={w} className="flex items-start gap-2.5 text-[15px] text-chrome">
                          <Check size={16} className="mt-1 text-gold shrink-0" strokeWidth={2.5} /> {w}
                        </li>
                      ))}
                    </ul>
                    <p className="mt-5 text-[15px] text-subtle leading-relaxed border-l-2 border-olive pl-4 italic font-serif">{c.note}</p>
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
          <h2 className={H2}>The work speaks first</h2>
        </Reveal>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mt-12">
          {CRAFT.map((c, i) => (
            <Reveal key={c.cap} delay={(i % 3) * 70}>
              <figure className="group relative overflow-hidden rounded-xl aspect-[7/9] bg-parchment">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={c.img} alt={`${c.cap} — ${c.sub}`} loading="lazy" className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105" />
                <div className="absolute inset-0 bg-gradient-to-t from-coal/90 via-coal/20 to-transparent" />
                <figcaption className="absolute bottom-4 left-4 right-4">
                  <p className="text-white font-serif font-medium text-[1.3rem] leading-tight">{c.cap}</p>
                  <p className="text-white/95 text-[13.5px] mt-0.5">{c.sub}</p>
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
            <h2 className={`${H2} max-w-2xl`}>{content.process.title}</h2>
          </Reveal>
          <div className="grid md:grid-cols-3 gap-10 mt-14">
            {content.process.steps.map((s, i) => {
              const Icon = [ClipboardCheck, Ear, BadgeCheck][i] ?? ClipboardCheck;
              return (
              <Reveal key={s.label} delay={i * 90}>
                <div>
                  <Icon size={30} strokeWidth={1.5} className="text-gold" />
                  <p className="text-[14.5px] font-semibold text-gold mt-5">{s.label}</p>
                  <h3 className="font-serif font-medium text-[1.65rem] leading-tight mt-1.5 text-ink">{s.title}</h3>
                  <p className="text-subtle text-[15.5px] leading-relaxed mt-3 max-w-xs">{s.body}</p>
                </div>
              </Reveal>
            );})}
          </div>
          <Reveal delay={150}>
            <div className="mt-16">
              <p className="text-[15px] font-semibold text-ink mb-4">What we check during an assessment</p>
              <div className="flex flex-wrap gap-2.5">
                {content.process.checks.map((c) => (
                  <span key={c} className="text-[14px] bg-card border border-white/10 rounded-full px-4 py-2 text-ink">{c}</span>
                ))}
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ================= VOICES ================= */}
      <section id="voices" className="pub-dark bg-dusk text-ink py-24">
      <div className="max-w-7xl mx-auto px-5 sm:px-8">
        <Reveal><Overline>Voices</Overline>
          <h2 className={H2}>Trusted in homes &amp; institutions</h2>
        </Reveal>
        <div className="grid md:grid-cols-3 gap-6 mt-14">
          {content.testimonials.map((t, i) => (
            <Reveal key={t.name} delay={i * 90}>
              <blockquote className="h-full bg-card border border-white/10 rounded-2xl p-7 flex flex-col">
                <Quote size={20} className="text-white/25" strokeWidth={1.5} />
                <p className="text-[17px] leading-relaxed text-ink mt-4 flex-1 font-serif">&ldquo;{t.quote}&rdquo;</p>
                <footer className="mt-6 pt-5 border-t border-white/8 flex items-start gap-3.5">
                  {t.photo ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={t.photo} alt={`Photo of ${t.name}`} loading="lazy" className="h-11 w-11 rounded-full object-cover ring-1 ring-white/15 shrink-0" />
                  ) : (
                    <span aria-hidden="true" className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-white/[0.06] ring-1 ring-white/10 font-serif text-sm text-subtle">
                      {t.name.replace(/^(Dr|Atty|Engr|Mr|Mrs|Ms)\.?\s+/i, "").trim().charAt(0).toUpperCase()}
                    </span>
                  )}
                  <div className="min-w-0">
                    <p className="text-[15px] font-semibold text-ink">{t.name}</p>
                    <p className="text-[13.5px] text-subtle mt-0.5">{t.role}</p>
                    {(t.location || t.year) && (
                      <p className="text-[13.5px] text-subtle mt-0.5">{[t.location, t.year].filter(Boolean).join(" · ")}</p>
                    )}
                    {t.reviewUrl && (
                      <a href={t.reviewUrl} target="_blank" rel="noopener noreferrer" className={`mt-2 inline-flex items-center gap-1 text-[13.5px] text-gold underline underline-offset-4 decoration-gold/40 hover:decoration-gold rounded-sm ${FOCUS_RING}`}>
                        Read on Facebook <ExternalLink size={11} />
                      </a>
                    )}
                  </div>
                </footer>
              </blockquote>
            </Reveal>
          ))}
        </div>
      </div>
      </section>

      {/* ================= ASSESSMENT ================= */}
      <section id="assessment" ref={assessRef} className="bg-paper text-ink py-24">
        <div className="max-w-7xl mx-auto px-5 sm:px-8 grid lg:grid-cols-2 gap-14 items-start">
          <Reveal>
            <Overline>Begin</Overline>
            <h2 className={H2}>Tell us about your piano</h2>
            <p className="text-subtle text-[16px] leading-relaxed mt-5 max-w-md">
              Brand and model if you know them; a sentence about its history if you don&apos;t. Add photographs later by messenger — a technician, not a sales agent, reads every inquiry.
            </p>
            <div className="mt-10 space-y-4 text-[15.5px] text-chrome">
              <p className="flex items-center gap-3"><MapPin size={16} className="text-gold" /> {content.contact.address}</p>
              <p className="flex items-center gap-3"><Phone size={16} className="text-gold" /> <span><PhoneText text={content.contact.phone} /></span></p>
              <p className="flex items-center gap-3"><Mail size={16} className="text-gold" /> {content.contact.email}</p>
              <p className="flex items-center gap-3"><Clock size={16} className="text-gold" /> {content.contact.hours}</p>
            </div>
            <MessengerButton className="mt-8" />
          </Reveal>
          <Reveal delay={120}>
            {sent ? (
              <div className="glass-dark rounded-2xl p-10 text-center">
                <BadgeCheck size={36} className="mx-auto text-emerald-700" strokeWidth={1.5} />
                <h3 className="font-serif font-medium text-[1.75rem] text-ink mt-4">Received — thank you.</h3>
                <p className="text-subtle text-[15.5px] mt-3 leading-relaxed">A technician will review your note and reply within one working day with a recommended next step.</p>
              </div>
            ) : (
              <form onSubmit={send} className="glass-dark rounded-2xl p-6 sm:p-8 space-y-4">
                <div className="grid sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[14.5px] font-medium text-ink mb-1.5">Name *</label>
                    <input className="input-dark" required autoComplete="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Your name" />
                  </div>
                  <div>
                    <label className="block text-[14.5px] font-medium text-ink mb-1.5">Phone *</label>
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
                  <label className="block text-[14.5px] font-medium text-ink mb-1.5">The piano</label>
                  <input className="input-dark" value={form.pianoContext} onChange={(e) => setForm({ ...form, pianoContext: e.target.value })} placeholder="e.g. Yamaha U1, about 30 years old" />
                </div>
                <div>
                  <label className="block text-[14.5px] font-medium text-ink mb-1.5">Your situation</label>
                  <textarea className="input-dark min-h-[104px] resize-y" value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} placeholder="What would you like help with?" />
                </div>
                {err && <p role="alert" className="text-red-700 text-[14px]">{err}</p>}
                <button type="submit" disabled={busy} className={`w-full btn-brass text-[15.5px] rounded-full min-h-12 transition flex items-center justify-center gap-2 ${FOCUS_RING}`}>
                  {busy && <Spinner className="text-onbrass" />} Send for assessment
                </button>
                <p className="text-[13.5px] text-subtle text-center">Reviewed by a technician · no obligation · replies within one working day</p>
              </form>
            )}
          </Reveal>
        </div>
      </section>

      <SiteFooter content={content} home />
      <MobileContactBar content={content} home />
      <PianoDialog group={openGroup} onClose={() => setOpenGroup(null)} />
    </div>
  );
}
