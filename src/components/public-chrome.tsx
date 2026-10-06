"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { Hammer, Lock, MessageCircle, Music, Phone, Sparkles } from "lucide-react";
import type { WebsiteContent } from "@/lib/website-content";
import { FALLBACK_PHONES, MESSENGER_URL } from "@/lib/site-config";

/** Visible keyboard focus for every interactive element on the public site. */
export const FOCUS_RING =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky";

const PH_MOBILE = /0\d{3}[\s-]?\d{3}[\s-]?\d{4}/g;

/** Pull dialable numbers out of the editable contact text ("Robert: 0946 299 2247 · …"). */
export function phoneNumbers(text: string): string[] {
  const found = (text.match(PH_MOBILE) ?? []).map((n) => n.replace(/\D/g, ""));
  return found.length ? found : FALLBACK_PHONES;
}

/** Turns every phone number in the text into a tap-to-call link; the rest stays plain text. */
export function PhoneText({ text }: { text: string }): ReactNode {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(PH_MOBILE)) {
    const i = m.index ?? 0;
    if (i > last) parts.push(text.slice(last, i));
    parts.push(
      <a key={i} href={`tel:${m[0].replace(/\D/g, "")}`} className={`underline underline-offset-4 decoration-current/30 hover:decoration-gold hover:text-ink transition-colors rounded-sm ${FOCUS_RING}`}>
        {m[0]}
      </a>,
    );
    last = i + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}

export function MessengerButton({ className = "", label = "Message Us on Messenger" }: { className?: string; label?: string }) {
  return (
    <a
      href={MESSENGER_URL}
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex items-center justify-center gap-2 rounded-full border border-gold/60 text-gold hover:bg-gold/10 transition-colors text-[15px] font-semibold min-h-12 px-6 ${FOCUS_RING} ${className}`}
    >
      <MessageCircle size={16} /> {label}
    </a>
  );
}

/**
 * Sticky mobile-only contact bar. `home` = on the homepage (in-page #assessment anchor).
 * Hidden from md up, where the header CTA is always reachable.
 */
export function MobileContactBar({ content, home }: { content: WebsiteContent; home: boolean }) {
  const [first] = phoneNumbers(content.contact.phone);
  return (
    <div
      className="md:hidden fixed bottom-0 inset-x-0 z-30 border-t border-white/10 bg-paper/95 backdrop-blur-md px-3 pt-2.5 shadow-[0_-10px_30px_-20px_rgba(46,47,56,0.5)]"
      style={{ paddingBottom: "max(0.625rem, env(safe-area-inset-bottom))" }}
    >
      <div className="flex items-center gap-2">
        <a href={`tel:${first}`} aria-label="Call us" className={`grid h-11 w-11 shrink-0 place-items-center rounded-full border border-white/20 bg-card text-ink ${FOCUS_RING}`}>
          <Phone size={17} />
        </a>
        <a href={MESSENGER_URL} target="_blank" rel="noopener noreferrer" className={`flex h-11 flex-1 items-center justify-center gap-1.5 rounded-full border border-gold/60 text-gold text-[14px] font-semibold ${FOCUS_RING}`}>
          <MessageCircle size={15} /> Message Us
        </a>
        <a href={home ? "#assessment" : "/#assessment"} className={`btn-brass flex h-11 flex-[1.3] items-center justify-center rounded-full text-[14px] font-semibold ${FOCUS_RING}`}>
          Book an Assessment
        </a>
      </div>
    </div>
  );
}

/** `home` keeps anchors in-page; elsewhere they point back at the homepage. `solid` = never transparent. */
export function SiteHeader({ home, solid = false, heroShade }: { home: boolean; solid?: boolean; /** 0–1: how much the top of the hero photo needs shading behind the nav (home page only). */ heroShade?: number }) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const fn = () => setScrolled(window.scrollY > 40);
    fn();
    window.addEventListener("scroll", fn, { passive: true });
    return () => window.removeEventListener("scroll", fn);
  }, []);
  const light = solid || scrolled;
  const base = home ? "" : "/";
  const nav: [string, string][] = [
    ["Showroom", "/showroom"],
    ["Restorations", `${base}#restorations`],
    ["The Craft", `${base}#craft`],
    ["Process", `${base}#process`],
    ["Voices", `${base}#voices`],
  ];
  return (
    <header className={`fixed top-0 inset-x-0 z-40 transition-all duration-500 ${light ? "glass-light" : "pub-dark"}`}>
      {!light ? <div aria-hidden="true" className="absolute inset-0 -z-10 bg-gradient-to-b from-coal/85 via-coal/45 to-transparent transition-opacity duration-500" style={{ opacity: heroShade ?? 0.6 }} /> : null}
      <div className="max-w-7xl mx-auto px-5 sm:px-8 h-[72px] flex items-center justify-between">
        <a href={home ? "#top" : "/"} className={`leading-none rounded-sm ${FOCUS_RING}`}>
          <span className="font-serif text-[1.45rem] font-medium tracking-[0.06em] text-ink">HERRERO</span>
          <span className="block text-[12px] text-subtle mt-0.5">Piano Sales &amp; Restoration</span>
        </a>
        <nav aria-label="Primary" className="hidden md:flex items-center gap-8 text-[14.5px] font-medium text-ink">
          {nav.map(([label, href]) => (
            <a key={label} href={href} className={`hover:text-gold transition-colors rounded-sm ${FOCUS_RING}`}>{label}</a>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <Link
            href="/login-gate"
            aria-label="Open private login"
            title="Open private login"
            className={`grid h-10 w-10 place-items-center rounded-full transition-all border ${FOCUS_RING} ${
              light ? "bg-card text-ink border-white/10 hover:bg-white/10" : "bg-white/10 text-white border-white/25 backdrop-blur-md hover:bg-white/20"
            }`}
          >
            <Lock size={14} />
          </Link>
          <a
            href={home ? "#assessment" : "/#assessment"}
            className={`hidden sm:inline-flex items-center text-[14px] rounded-full px-5 min-h-10 transition-all btn-brass ${FOCUS_RING}`}
          >
            Book an Assessment
          </a>
        </div>
      </div>
    </header>
  );
}

export function SiteFooter({ content, home }: { content: WebsiteContent; home: boolean }) {
  const base = home ? "" : "/";
  return (
    <footer className="pub-dark bg-coal text-subtle pb-20 md:pb-0">
      <div className="max-w-7xl mx-auto px-5 sm:px-8 py-14 grid md:grid-cols-4 gap-10 text-[14px]">
        <div>
          <p className="font-serif text-2xl font-medium tracking-[0.06em] text-ink">HERRERO</p>
          <p className="text-[13px] mt-1">Piano Sales &amp; Restoration</p>
          <p className="mt-5 leading-relaxed max-w-[220px]">Piano sales, tuning, repair, restoration, transport, and buying guidance — Davao.</p>
        </div>
        <div>
          <p className="text-ink text-[15px] font-semibold mb-4">Visit</p>
          <p className="leading-relaxed">{content.contact.address}</p>
          <p className="mt-3">{content.contact.hours}</p>
          <p className="mt-3"><PhoneText text={content.contact.phone} /></p>
        </div>
        <div>
          <p className="text-ink text-[15px] font-semibold mb-4">Atelier</p>
          <ul className="space-y-2.5">
            <li><a href="/showroom" className={`hover:text-ink transition-colors ${FOCUS_RING}`}>Showroom</a></li>
            <li><a href={`${base}#restorations`} className={`hover:text-ink transition-colors ${FOCUS_RING}`}>Restorations</a></li>
            <li><a href={`${base}#assessment`} className={`hover:text-ink transition-colors ${FOCUS_RING}`}>Book an Assessment</a></li>
          </ul>
        </div>
        <div>
          <p className="text-ink text-[15px] font-semibold mb-4">Private Access</p>
          <ul className="space-y-2.5">
            <li><span>Client portal links are issued privately.</span></li>
            <li><Link href="/workshop" className={`hover:text-ink transition-colors flex items-center gap-1.5 ${FOCUS_RING}`}><Hammer size={13} /> Workshop Kiosk</Link></li>
            <li><Link href="/login-gate" className={`hover:text-ink transition-colors flex items-center gap-1.5 ${FOCUS_RING}`}><Sparkles size={13} /> Owner Sign-In</Link></li>
          </ul>
        </div>
      </div>
      <div className="border-t border-white/5 py-5 text-center text-[12.5px] flex items-center justify-center gap-1.5">
        <Music size={12} /> © {new Date().getFullYear()} Herrero Pianos · Tuned to A=442
      </div>
    </footer>
  );
}
