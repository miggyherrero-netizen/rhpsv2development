"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  FolderPlus, ListPlus, PackagePlus, UserPlus, Link2, BookImage, MessageSquarePlus, Palette,
  Copy, Check, ArrowUpRight, ArrowRight, Piano, ChevronDown, CircleCheck, PhoneCall,
} from "lucide-react";
import type { getDashboard } from "@/server/data";
import { PROJECT_STAGES } from "@/lib/config";
import { fmtDateLong, fmtTime, timeAgo } from "@/lib/format";
import { buildAttention, pianoLabel, plural, telHref, unclaimedCount } from "@/lib/dashboard";
import LiveOpsPanel from "@/components/live-ops";
import { Modal } from "@/components/ui";
import { resolveInquiry } from "@/server/admin";

type Dashboard = Awaited<ReturnType<typeof getDashboard>>;

const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white";
const ACTION_BTN = `inline-flex items-center justify-center gap-1.5 min-h-10 rounded-lg border border-white/15 bg-white/[0.06] hover:bg-white/[0.12] px-3.5 text-[12.5px] text-white transition-colors ${FOCUS}`;

function Panel({ title, action, children, id }: { title: string; action?: React.ReactNode; children: React.ReactNode; id?: string }) {
  return (
    <section id={id} className="card-dark p-4 scroll-mt-20">
      <div className="flex items-center justify-between mb-3 min-h-6">
        <h2 className="text-[11px] uppercase tracking-[0.14em] text-subtle">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function Pill({ href, children, tone = "plain" }: { href: string; children: React.ReactNode; tone?: "plain" | "amber" | "sky" }) {
  const tones = {
    plain: "text-chrome",
    amber: "text-amber-300 border-amber-400/25",
    sky: "text-sky-300 border-sky-400/25",
  };
  return (
    <Link href={href} className={`card-dark inline-flex items-center min-h-10 px-3.5 text-[12px] hover:bg-white/[0.08] hover:text-white transition-colors ${tones[tone]} ${FOCUS}`}>
      {children}
    </Link>
  );
}

function MoreActions({ items, onPortal }: { items: { href: string; label: string; icon: typeof Piano }[]; onPortal: () => void }) {
  // Disclosure pattern (button + list of plain links): honest semantics, no arrow-key menu contract to keep.
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); triggerRef.current?.focus(); } };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);
  const row = `flex w-full items-center gap-3 px-3.5 min-h-11 text-left text-[13px] text-chrome hover:text-white hover:bg-white/[0.07] transition-colors ${FOCUS}`;
  return (
    // static on phones so the panel can span the whole actions row; anchored to the button from sm up
    <div ref={ref} className="sm:relative" onBlur={(e) => { if (!ref.current?.contains(e.relatedTarget as Node | null)) setOpen(false); }}>
      <button ref={triggerRef} type="button" aria-expanded={open} aria-controls="more-actions-panel" onClick={() => setOpen((o) => !o)}
        className={`${ACTION_BTN} h-11`}>
        More actions <ChevronDown size={14} className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div id="more-actions-panel" className="absolute top-full mt-2 z-30 left-0 right-0 sm:left-auto sm:right-0 sm:w-64 overflow-hidden rounded-xl border border-white/12 bg-[#10141b] shadow-2xl">
          {items.map((a) => (
            <Link key={a.label} href={a.href} onClick={() => setOpen(false)} className={row}>
              <a.icon size={15} className="text-subtle" /> {a.label}
            </Link>
          ))}
          <button type="button" onClick={() => { setOpen(false); onPortal(); }} className={`${row} border-t border-white/[0.07]`}>
            <Link2 size={15} className="text-sky-300" /> Generate client portal link
          </button>
        </div>
      )}
    </div>
  );
}

export default function AdminDashboard({ data, firstName }: { data: Dashboard; firstName: string }) {
  const [portalOpen, setPortalOpen] = useState(false);
  const [portalId, setPortalId] = useState(data.projects[0]?.id ?? "");
  const [copied, setCopied] = useState(false);
  const [nowMs] = useState(() => Date.now());

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const portalProject = data.projects.find((p) => p.id === portalId);
  const portalLink = useMemo(
    () => (portalProject ? `${typeof window !== "undefined" ? window.location.origin : ""}/portal/${portalProject.portalUuid}` : ""),
    [portalProject],
  );

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(portalLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch { /* clipboard unavailable */ }
  }

  const unclaimed = unclaimedCount(data.tasks);
  const backlog = data.tasks.filter((t) => t.status === "backlog").length;
  const attention = useMemo(() => buildAttention(data, nowMs), [data, nowMs]);

  const topActions = [
    { href: "/admin/projects?new=1", label: "New Project", icon: FolderPlus },
    { href: "/admin/curator?new=1", label: "Add Project Update", icon: MessageSquarePlus },
    { href: "/admin/tasks?new=1", label: "Create Task", icon: ListPlus },
  ];
  const moreActions = [
    { href: "/admin/inventory?new=1", label: "Add Inventory", icon: PackagePlus },
    { href: "/admin/showroom", label: "Showroom Editor", icon: Piano },
    { href: "/admin/workers?new=1", label: "Add Worker", icon: UserPlus },
    { href: "/admin/website", label: "Edit Public Website", icon: Palette },
    { href: "/admin/curator", label: "Open Client Curator", icon: BookImage },
  ];

  const completions = data.tasks
    .filter((t) => t.status === "done" && t.completedAt)
    .sort((a, b) => +new Date(b.completedAt!) - +new Date(a.completedAt!))
    .slice(0, 5);

  // Cards with nothing to show collapse into one quiet line at the bottom.
  const quiet: string[] = [];
  if (data.inquiries.length === 0) quiet.push("no new website inquiries");
  if (completions.length === 0) quiet.push("no completed tasks yet");

  return (
    <div className="p-4 sm:p-7 max-w-[1500px] mx-auto">
      {/* header */}
      <div className="mb-5 anim-fade-up">
        <h1 className="font-serif text-2xl sm:text-3xl text-white">{greeting}, {firstName}.</h1>
        <p className="text-subtle text-[13px] mt-1.5">{fmtDateLong(new Date())} · Herrero Pianos Davao</p>
        <nav aria-label="Dashboard summary" className="flex flex-wrap items-center gap-2 mt-4">
          <Pill href="/admin/projects">{plural(data.projects.length, "project")}</Pill>
          <Pill href="/admin/tasks?status=available">{plural(unclaimed, "unclaimed task")}</Pill>
          {data.lowStock.length > 0 && <Pill href="/admin/inventory?low=1" tone="amber">{data.lowStock.length} low stock</Pill>}
          {data.inquiries.length > 0 && <Pill href="#inquiries" tone="sky">{plural(data.inquiries.length, "new inquiry", "new inquiries")}</Pill>}
        </nav>
      </div>

      {/* top quick actions */}
      <div className="relative flex flex-wrap items-center gap-2 mb-5 anim-fade-up" style={{ animationDelay: "40ms" }}>
        {topActions.map((a, i) => (
          <Link key={a.label} href={a.href}
            className={`inline-flex items-center gap-2 h-11 px-4 rounded-xl text-[13px] transition-colors ${FOCUS} ${
              i === 0 ? "bg-white text-black font-medium hover:bg-chrome" : "border border-white/15 bg-white/[0.05] text-chrome hover:text-white hover:bg-white/[0.1]"
            }`}>
            <a.icon size={15} /> {a.label}
          </Link>
        ))}
        <MoreActions items={moreActions} onPortal={() => setPortalOpen(true)} />
      </div>

      {/* needs attention */}
      <section aria-labelledby="needs-attention" className={`card-dark p-4 sm:p-5 mb-5 anim-fade-up ${attention.length ? "border-amber-400/20" : ""}`} style={{ animationDelay: "80ms" }}>
        <div className="flex items-center justify-between gap-3">
          <h2 id="needs-attention" className="font-serif text-xl text-white">Needs attention</h2>
          {attention.length > 0 && <span className="text-[12px] text-subtle tnum">{plural(attention.length, "area")}</span>}
        </div>
        {attention.length === 0 ? (
          <p className="flex items-center gap-2.5 mt-3 text-[13.5px] text-chrome">
            <CircleCheck size={17} className="text-emerald-300 shrink-0" /> All clear — nothing needs you right now.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-white/[0.07]">
            {attention.map((row) => (
              <li key={row.key} className="py-3 first:pt-2">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[14px] text-white font-medium min-w-0">
                    {row.title} <span className="tnum text-amber-300">· {row.count}</span>
                  </p>
                  {row.href.startsWith("#") ? (
                    <a href={row.href} className={`${ACTION_BTN} shrink-0`}>{row.actionLabel} <ArrowRight size={13} /></a>
                  ) : (
                    <Link href={row.href} className={`${ACTION_BTN} shrink-0`}>{row.actionLabel} <ArrowRight size={13} /></Link>
                  )}
                </div>
                <ul className="mt-1 space-y-0.5">
                  {row.items.map((it) => (
                    <li key={it.id} className="flex items-baseline gap-x-2 text-[12.5px] min-w-0">
                      <span className="min-w-0 break-words">
                        <span className="text-chrome" title={it.label}>{it.label}</span>
                        {it.detail && <span className="text-subtle"> · {it.detail}</span>}
                      </span>
                      {it.href && it.actionLabel && (
                        <a href={it.href} className={`ml-auto shrink-0 text-subtle hover:text-white underline underline-offset-4 decoration-white/25 rounded-sm inline-flex items-center min-h-8 ${FOCUS}`}>{it.actionLabel}</a>
                      )}
                    </li>
                  ))}
                  {row.more > 0 && <li className="text-[12px] text-subtle">+ {row.more} more</li>}
                </ul>
              </li>
            ))}
          </ul>
        )}
        <p className="text-[12px] text-subtle mt-3 pt-3 border-t border-white/[0.07]">
          Clients are flagged after {plural(data.staleDays, "day")} without an update ·{" "}
          <Link href="/admin/settings" className={`underline underline-offset-4 decoration-white/25 hover:text-white rounded-sm ${FOCUS}`}>change</Link>
        </p>
      </section>

      <div className="grid xl:grid-cols-[300px_minmax(0,1fr)] gap-5 items-start">
        {/* ============ MAIN — LABOR + INQUIRIES ============ */}
        <div className="space-y-5 order-1 xl:order-2 anim-fade-up" style={{ animationDelay: "120ms" }}>
          <LiveOpsPanel initial={data.live} hero collapseWhenIdle />

          {data.inquiries.length > 0 && (
            <Panel id="inquiries" title={`New website inquiries · ${data.inquiries.length}`}>
              <ul className="space-y-3.5">
                {data.inquiries.map((q) => (
                  <li key={q.id} className="flex items-start justify-between gap-3 text-[12.5px]">
                    <div className="min-w-0">
                      <p className="text-chrome font-medium">{q.name} <span className="text-subtle font-normal">· {timeAgo(new Date(q.createdAt))}</span></p>
                      {q.phone && <a href={telHref(q.phone) ?? "#inquiries"} className={`inline-flex items-center gap-1.5 text-subtle hover:text-white text-[12px] mt-0.5 tnum rounded-sm ${FOCUS}`}><PhoneCall size={11} /> {q.phone}</a>}
                      {q.pianoContext && <p className="text-sky-300 text-[12px] mt-0.5">{q.pianoContext}</p>}
                      {q.message && <p className="text-subtle text-[12px] mt-1 leading-relaxed line-clamp-2">{q.message}</p>}
                    </div>
                    <button onClick={() => resolveInquiry(q.id)} className={`shrink-0 min-h-10 text-[12px] text-chrome hover:text-emerald-300 border border-white/15 rounded-lg px-3 transition ${FOCUS}`}>
                      Resolve
                    </button>
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          {completions.length > 0 && (
            <Panel title="Latest completions">
              <ul className="space-y-2">
                {completions.map((t) => (
                  <li key={t.id} className="flex items-center gap-2.5 text-[12.5px]">
                    <Check size={13} className="text-emerald-400 shrink-0" />
                    <span className="text-chrome truncate">{t.title}</span>
                    <span className="text-subtle ml-auto pl-2 shrink-0">{t.claimedName?.split(" ")[0] ?? "—"} · {timeAgo(new Date(t.completedAt!))}</span>
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          {backlog > 0 && (
            <p className="text-[12.5px] text-subtle px-1">
              {plural(backlog, "task")} in the backlog ·{" "}
              <Link href="/admin/tasks" className={`underline underline-offset-4 decoration-white/25 hover:text-white rounded-sm ${FOCUS}`}>view tasks</Link>
            </p>
          )}

          {quiet.length > 0 && (
            <p className="text-[12.5px] text-subtle px-1">Nothing pending: {quiet.join(" · ")}.</p>
          )}
        </div>

        {/* ============ SIDE — PROJECTS BY STAGE ============ */}
        <div className="space-y-4 order-2 xl:order-1 anim-fade-up" style={{ animationDelay: "160ms" }}>
          <Panel
            title="Projects by stage"
            action={<Link href="/admin/projects" className={`inline-flex items-center gap-1 min-h-11 px-2 -mr-2 text-[12.5px] text-chrome hover:text-white rounded-md ${FOCUS}`}>All <ArrowUpRight size={12} /></Link>}
          >
            <ul>
              {PROJECT_STAGES.map(({ key, label }) => {
                const n = data.projects.filter((p) => p.status === key).length;
                return (
                  <li key={key}>
                    <Link href={`/admin/projects?stage=${key}`} className={`flex items-center justify-between min-h-11 px-2 -mx-2 rounded-lg text-[13px] hover:bg-white/[0.06] transition-colors ${FOCUS} ${n ? "text-white font-medium" : "text-mist"}`}>
                      <span>{label}</span>
                      <span className="tnum">{n}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
            {data.projects.length > 0 && (
              <ul className="mt-3 pt-3 border-t border-white/[0.07] space-y-1">
                {data.projects.slice(0, 4).map((p) => (
                  <li key={p.id}>
                    <Link href={`/admin/projects?sel=${p.id}`} title={`${p.clientName} — ${pianoLabel(p.pianoBrand, p.pianoModel)}`}
                      className={`group block px-2 -mx-2 py-1.5 rounded-lg hover:bg-white/[0.06] transition-colors ${FOCUS}`}>
                      <span className="block text-[13px] font-medium text-chrome group-hover:text-white truncate">{pianoLabel(p.pianoBrand, p.pianoModel)}</span>
                      <span className="block text-[12px] text-subtle truncate">{p.clientName}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>

      {/* portal link modal */}
      <Modal open={portalOpen} onClose={() => setPortalOpen(false)} title="Client portal link">
        <p className="text-subtle text-[13px] mb-4">Choose a project. The link opens that client&apos;s private restoration journal — no login needed.</p>
        <select className="input-dark" aria-label="Project" value={portalId} onChange={(e) => setPortalId(e.target.value)}>
          {data.projects.map((p) => (
            <option key={p.id} value={p.id}>{p.clientName} — {pianoLabel(p.pianoBrand, p.pianoModel)}</option>
          ))}
        </select>
        {portalProject && (
          <div className="mt-4 bg-white/[0.04] border border-white/10 rounded-xl p-3.5 flex items-center gap-2">
            <p className="text-[11.5px] text-chrome truncate flex-1 tnum">{portalLink}</p>
            <button onClick={copyLink} aria-label="Copy link" className={`shrink-0 p-2 rounded-lg bg-white/10 hover:bg-white/20 transition text-chrome ${FOCUS}`}>
              {copied ? <Check size={14} className="text-emerald-300" /> : <Copy size={14} />}
            </button>
          </div>
        )}
        <p className="text-[12px] text-subtle mt-3 leading-relaxed">
          Send via SMS or email. Only updates marked visible in the Client Curator appear. Generated {fmtTime(new Date())}.
        </p>
      </Modal>
    </div>
  );
}
