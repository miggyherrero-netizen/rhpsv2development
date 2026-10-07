import Link from "next/link";
import { notFound } from "next/navigation";
import { getPortal } from "@/server/data";
import { STAGE_LABEL } from "@/lib/config";
import { fmtDate } from "@/lib/format";
import { Reveal } from "@/components/reveal";
import { PUB_ROOT } from "@/lib/pub-fonts";
import { Music, ShieldCheck, Sparkles } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function PortalPage({ params }: { params: Promise<{ uuid: string }> }) {
  const { uuid } = await params;
  const data = await getPortal(uuid);
  if (!data) notFound();
  const { project, updates } = data;

  return (
    <div className={`${PUB_ROOT} bg-paper text-ink min-h-screen`}>
      {/* header */}
      <header className="pub-dark bg-coal text-white relative overflow-hidden">
        <div className="absolute inset-0 opacity-25">
          {project.imageUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={project.imageUrl} alt="" className="h-full w-full object-cover" />
          )}
          <div className="absolute inset-0 bg-gradient-to-b from-coal/50 via-coal/80 to-coal" />
        </div>
        <div className="relative max-w-4xl mx-auto px-5 sm:px-6 pt-8 pb-16">
          <div className="flex items-center justify-between">
            <Link href="/" className="leading-none rounded-sm py-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky">
              <span className="text-lg font-semibold tracking-[0.2em]">HERRERO</span>
              <span className="block text-[12px] text-white/85 mt-0.5">Piano Sales &amp; Services</span>
            </Link>
            <span className="text-[13px] text-white/90 flex items-center gap-1.5">
              <ShieldCheck size={16} aria-hidden="true" /> Private Exhibit
            </span>
          </div>
          <div className="mt-14">
            <p className="pub-kicker !text-white/90">Prepared For</p>
            <h1 className="font-serif font-semibold tracking-[-0.01em] text-[2.5rem] sm:text-6xl mt-3">{project.clientName}</h1>
            <p className="text-white/85 mt-3 text-[16px]">
              {project.pianoBrand} {project.pianoModel}
              {project.pianoYear ? ` · ${project.pianoYear}` : ""} · {project.serviceType}
            </p>
            <div className="mt-8 max-w-sm">
              <div className="flex items-center justify-between text-[14px] font-medium text-white/85 mb-2">
                <span>{STAGE_LABEL[project.status] ?? project.status}</span>
                <span className="tnum">{project.progress}%</span>
              </div>
              <div role="progressbar" aria-label="Restoration progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={project.progress} className="h-1 bg-white/20 rounded-full overflow-hidden">
                <div className="h-full bg-sky rounded-full transition-[width] duration-300" style={{ width: `${project.progress}%` }} />
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* latest update */}
      {updates.length > 0 && (
        <section aria-label="Latest update" className="max-w-4xl mx-auto px-5 sm:px-6 -mt-10 relative z-10">
          {(() => {
            const latest = updates[updates.length - 1];
            return (
              <div className="bg-card rounded-[14px] shadow-xl shadow-black/15 border border-white/8 p-6 sm:p-7 flex flex-col sm:flex-row gap-5 items-start">
                {latest.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={latest.imageUrl} alt={latest.title} className="w-full sm:w-32 h-32 rounded-[10px] object-cover shrink-0" />
                ) : (
                  <div className="w-full sm:w-32 h-32 rounded-[10px] bg-white/5 flex items-center justify-center text-mist shrink-0">
                    <Music size={32} strokeWidth={1} aria-hidden="true" />
                  </div>
                )}
                <div>
                  <p className="flex items-center gap-1.5 text-[14px] font-semibold text-gold">
                    <Sparkles size={16} aria-hidden="true" /> Latest Update · {fmtDate(new Date(latest.updateDate))}
                  </p>
                  <h2 className="font-serif font-semibold text-[1.75rem] mt-1.5 leading-tight text-ink">{latest.title}</h2>
                  {latest.body && <p className="text-subtle text-[15.5px] leading-relaxed mt-2">{latest.body}</p>}
                </div>
              </div>
            );
          })()}
        </section>
      )}

      {/* timeline */}
      <main className="max-w-4xl mx-auto px-5 sm:px-6 py-16 sm:py-20">
        <p className="text-center text-[15px] font-semibold text-gold">The Journey of Your Instrument</p>
        <h2 className="text-center font-serif font-semibold text-[2.5rem] sm:text-5xl mt-3 text-ink">Restoration Journal</h2>

        {updates.length === 0 ? (
          <p className="text-center text-subtle text-[16px] mt-16 max-w-md mx-auto leading-relaxed">
            The atelier is preparing the first entries of your piano&apos;s journal. Please check back soon.
          </p>
        ) : (
          <div className="mt-16 space-y-20">
            {updates.map((u, i) => (
              <Reveal key={u.id}>
                <article className={`grid md:grid-cols-2 gap-8 md:gap-12 items-center ${i % 2 ? "md:[&>*:first-child]:order-2" : ""}`}>
                  {u.imageUrl ? (
                    <figure className="rounded-[14px] overflow-hidden shadow-xl shadow-black/15">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={u.imageUrl} alt={u.title} loading="lazy" className="w-full aspect-[4/3] object-cover" />
                    </figure>
                  ) : (
                    <div className="rounded-[14px] bg-parchment aspect-[4/3] flex items-center justify-center text-mist">
                      <Music size={48} strokeWidth={1} aria-hidden="true" />
                    </div>
                  )}
                  <div>
                    <p className="text-[14.5px] font-medium text-gold tnum">{fmtDate(new Date(u.updateDate))}</p>
                    <h3 className="font-serif font-semibold text-[2rem] mt-2 leading-tight text-ink">{u.title}</h3>
                    {u.body && <p className="text-subtle text-[16px] leading-relaxed mt-4">{u.body}</p>}
                    <p className="text-[14px] text-subtle mt-6 tnum">Entry {i + 1}</p>
                  </div>
                </article>
              </Reveal>
            ))}
          </div>
        )}
      </main>

      <footer className="border-t border-white/8 py-10 px-5 text-center">
        <p className="text-[14px] font-semibold text-ink">Herrero Pianos · Davao</p>
        <p className="text-[14px] text-subtle mt-2 max-w-sm mx-auto">
          This page is a private exhibit prepared for {project.clientName}. Please do not share this link.
        </p>
      </footer>
    </div>
  );
}
