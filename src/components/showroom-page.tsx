"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import type { PublicPiano } from "@/server/data";
import type { WebsiteContent } from "@/lib/website-content";
import { FILTERS, groupPianos, matchesFilter, type FilterId, type ShowroomGroup } from "@/lib/showroom";
import { PianoCard, PianoDialog } from "@/components/piano-card";
import { FOCUS_RING, MobileContactBar, SiteFooter, SiteHeader, MessengerButton } from "@/components/public-chrome";

export default function ShowroomPage({ pianos, content }: { pianos: PublicPiano[]; content: WebsiteContent }) {
  const [filter, setFilter] = useState<FilterId>("all");
  const [open, setOpen] = useState<ShowroomGroup | null>(null);
  const groups = useMemo(() => groupPianos(pianos), [pianos]);
  const counts = useMemo(
    () => Object.fromEntries(FILTERS.map((f) => [f.id, groups.filter((g) => matchesFilter(g, f.id)).length])) as Record<FilterId, number>,
    [groups],
  );
  const shown = groups.filter((g) => matchesFilter(g, filter));
  const units = shown.reduce((n, g) => n + g.units.length, 0);

  return (
    <div className="bg-paper text-ink min-h-screen">
      <SiteHeader home={false} solid />
      <main className="max-w-7xl mx-auto px-5 sm:px-8 pt-28 pb-24">
        <Link href="/" className={`inline-flex items-center gap-1.5 text-[12.5px] text-subtle hover:text-ink transition-colors rounded-sm ${FOCUS_RING}`}>
          <ArrowLeft size={14} /> Back to home
        </Link>
        <p className="text-[10.5px] uppercase tracking-[0.34em] text-subtle mt-8">The Showroom</p>
        <h1 className="font-serif text-4xl sm:text-5xl mt-3">All instruments</h1>
        <p className="text-subtle text-sm max-w-xl leading-relaxed mt-4">
          Every piano below is for sale, priced as marked. Identical models are grouped — open one to choose a specific unit.
        </p>

        <div role="group" aria-label="Filter instruments" className="mt-9 flex flex-wrap gap-2.5">
          {FILTERS.map((f) => (
            <button
              key={f.id} type="button" onClick={() => setFilter(f.id)} aria-pressed={filter === f.id}
              className={`text-[13px] rounded-full border px-4 py-2 transition-colors ${FOCUS_RING} ${
                filter === f.id ? "border-gold bg-gold text-onbrass font-medium" : "border-white/20 text-chrome hover:border-gold/60 hover:text-ink"
              }`}
            >
              {f.label} <span className={filter === f.id ? "opacity-80" : "text-subtle"}>({counts[f.id]})</span>
            </button>
          ))}
        </div>
        <p className="text-[12.5px] text-subtle mt-5" aria-live="polite">
          Showing {shown.length} model{shown.length === 1 ? "" : "s"} · {units} instrument{units === 1 ? "" : "s"}
        </p>

        {shown.length ? (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6 mt-8">
            {shown.map((g) => <PianoCard key={g.key} group={g} onOpen={setOpen} />)}
          </div>
        ) : (
          <div className="mt-10 rounded-2xl border border-white/10 p-10 text-center">
            <p className="font-serif text-2xl">Nothing in this range right now.</p>
            <p className="text-subtle text-sm mt-2">Message us — new instruments arrive often, and we can look for one for you.</p>
            <div className="mt-6 flex justify-center"><MessengerButton /></div>
          </div>
        )}
      </main>
      <SiteFooter content={content} home={false} />
      <MobileContactBar content={content} home={false} />
      <PianoDialog group={open} onClose={() => setOpen(null)} />
    </div>
  );
}
