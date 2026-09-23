"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  FolderPlus, ListPlus, PackagePlus, UserPlus, Link2, BookImage, MessageSquarePlus, Palette,
  AlertTriangle, PackageSearch, BellRing, Inbox, Copy, Check, ArrowUpRight, Piano,
} from "lucide-react";
import type { getDashboard } from "@/server/data";
import { STAGE_LABEL, PRIORITY_STYLE } from "@/lib/config";
import { fmtDateLong, fmtTime, timeAgo } from "@/lib/format";
import LiveOpsPanel from "@/components/live-ops";
import { Modal, EmptyState } from "@/components/ui";
import { resolveInquiry } from "@/server/admin";

type Dashboard = Awaited<ReturnType<typeof getDashboard>>;

function Panel({ title, action, children, danger = false }: { title: string; action?: React.ReactNode; children: React.ReactNode; danger?: boolean }) {
  return (
    <section className={`card-dark p-4 ${danger ? "border-rose-500/20" : ""}`}>
      <div className="flex items-center justify-between mb-3">
        <p className="text-[10px] uppercase tracking-[0.22em] text-mist">{title}</p>
        {action}
      </div>
      {children}
    </section>
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

  const qa = [
    { href: "/admin/projects?new=1", label: "New Project", icon: FolderPlus },
    { href: "/admin/tasks?new=1", label: "Create Task", icon: ListPlus },
    { href: "/admin/inventory?new=1", label: "Add Inventory", icon: PackagePlus },
    { href: "/admin/showroom", label: "Showroom Editor", icon: Piano },
    { href: "/admin/workers?new=1", label: "Add Worker", icon: UserPlus },
    { href: "/admin/website", label: "Edit Public Website", icon: Palette },
    { href: "/admin/curator?new=1", label: "Add Project Update", icon: MessageSquarePlus },
    { href: "/admin/curator", label: "Open Client Curator", icon: BookImage },
  ];

  return (
    <div className="p-4 sm:p-7 max-w-[1600px] mx-auto">
      {/* header */}
      <div className="flex flex-wrap items-end justify-between gap-3 mb-6 anim-fade-up">
        <div>
          <h1 className="font-serif text-2xl sm:text-3xl text-white">{greeting}, {firstName}.</h1>
          <p className="text-mist text-[12.5px] mt-1.5">{fmtDateLong(new Date())} · Herrero Pianos Davao</p>
        </div>
        <div className="flex items-center gap-2.5 text-[11.5px]">
          <span className="card-dark px-3 py-1.5 text-chrome">{data.projects.length} projects</span>
          <span className="card-dark px-3 py-1.5 text-chrome">{data.tasks.filter((t) => t.status !== "done").length} open tasks</span>
          {data.lowStock.length > 0 && <span className="card-dark px-3 py-1.5 text-amber-300 border-amber-400/20">{data.lowStock.length} low stock</span>}
          {data.inquiries.length > 0 && <span className="card-dark px-3 py-1.5 text-sky-300 border-sky-400/20">{data.inquiries.length} new inquiries</span>}
        </div>
      </div>

      <div className="grid xl:grid-cols-[290px_minmax(0,1fr)_272px] gap-5 items-start">
        {/* ============ LEFT — STATUS ============ */}
        <div className="space-y-4 order-2 xl:order-1 anim-fade-up">
          <Panel
            title="Projects by stage"
            action={<Link href="/admin/projects" className="text-[11px] text-chrome hover:text-white flex items-center gap-1">All <ArrowUpRight size={11} /></Link>}
          >
            <div className="space-y-1">
              {Object.entries(STAGE_LABEL).map(([k, label]) => {
                const n = data.projects.filter((p) => p.status === k).length;
                return (
                  <div key={k} className="flex items-center justify-between text-[12.5px]">
                    <span className="text-chrome/90">{label}</span>
                    <span className={`tnum ${n ? "text-white" : "text-mist/50"}`}>{n}</span>
                  </div>
                );
              })}
            </div>
            <div className="mt-3.5 pt-3 border-t border-white/[0.07] space-y-2">
              {data.projects.slice(0, 4).map((p) => (
                <Link key={p.id} href={`/admin/projects?sel=${p.id}`} className="group flex items-center gap-2.5 text-[12px]">
                  <span className="font-medium text-chrome group-hover:text-white truncate">{p.pianoBrand} {p.pianoModel}</span>
                  <span className="text-mist/60 truncate ml-auto pl-2">{p.clientName.split(" ")[0]}</span>
                </Link>
              ))}
            </div>
          </Panel>

          <Panel title={`Overdue tasks · ${data.overdue.length}`} danger={data.overdue.length > 0}>
            {data.overdue.length === 0 ? <p className="text-[12px] text-mist/70">Nothing overdue. Clean shop.</p> : (
              <ul className="space-y-2">
                {data.overdue.slice(0, 4).map((t) => (
                  <li key={t.id} className="text-[12px]">
                    <Link href={`/admin/tasks?sel=${t.id}`} className="text-chrome hover:text-white">{t.title}</Link>
                    <p className="text-rose-400/80 text-[10.5px] mt-0.5">due {timeAgo(new Date(t.dueDate!)).replace(" ago", "")} late{t.pianoName ? ` · ${t.pianoName}` : ""}</p>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title={`Waiting on parts · ${data.waitingParts.length}`}>
            {data.waitingParts.length === 0 ? <p className="text-[12px] text-mist/70">No parts blockers.</p> : (
              <ul className="space-y-2">
                {data.waitingParts.slice(0, 4).map((t) => (
                  <li key={t.id} className="text-[12px] flex items-start gap-2">
                    <PackageSearch size={13} className="text-amber-300 mt-0.5 shrink-0" />
                    <span><span className="text-chrome">{t.title}</span>
                      <span className="block text-mist/60 text-[10.5px] mt-0.5">{t.pianoName ?? "Shop"} {t.claimedName ? `· ${t.claimedName.split(" ")[0]}` : ""}</span></span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title={`Clients awaiting update · ${data.staleClients.length}`}>
            {data.staleClients.length === 0 ? <p className="text-[12px] text-mist/70">Every client is up to date.</p> : (
              <ul className="space-y-2">
                {data.staleClients.slice(0, 4).map((p) => {
                  const days = p.lastClientUpdateAt ? Math.floor((nowMs - new Date(p.lastClientUpdateAt).getTime()) / 86_400_000) : null;
                  return (
                    <li key={p.id} className="text-[12px] flex items-start gap-2">
                      <BellRing size={13} className="text-sky-300 mt-0.5 shrink-0" />
                      <span><Link href="/admin/curator" className="text-chrome hover:text-white">{p.clientName}</Link>
                        <span className="block text-mist/60 text-[10.5px] mt-0.5">{days === null ? "No updates yet" : `${days}d since last update`} · {p.pianoBrand} {p.pianoModel}</span></span>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>
        </div>

        {/* ============ CENTER — LIVE OPS ============ */}
        <div className="space-y-5 order-1 xl:order-2 anim-fade-up" style={{ animationDelay: "60ms" }}>
          <LiveOpsPanel initial={data.live} hero />

          <Panel title="New website inquiries">
            {data.inquiries.length === 0 ? <p className="text-[12px] text-mist/70">No open inquiries.</p> : (
              <ul className="space-y-3">
                {data.inquiries.map((q) => (
                  <li key={q.id} className="flex items-start justify-between gap-3 text-[12px]">
                    <div>
                      <p className="text-chrome font-medium">{q.name} <span className="text-mist/60 font-normal">· {timeAgo(new Date(q.createdAt))}</span></p>
                      {q.phone && <p className="text-mist/80 text-[11px] mt-0.5 tnum">{q.phone}</p>}
                      {q.pianoContext && <p className="text-sky-300/90 text-[11px] mt-0.5">{q.pianoContext}</p>}
                      {q.message && <p className="text-mist text-[11.5px] mt-1 leading-relaxed line-clamp-2">{q.message}</p>}
                    </div>
                    <button onClick={() => resolveInquiry(q.id)} className="shrink-0 text-[10.5px] uppercase tracking-wide text-mist hover:text-emerald-300 border border-white/10 rounded-lg px-2.5 py-1.5 transition">
                      Resolve
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Latest completions">
            {(() => {
              const done = data.tasks.filter((t) => t.status === "done" && t.completedAt).sort((a, b) => +new Date(b.completedAt!) - +new Date(a.completedAt!)).slice(0, 5);
              return done.length === 0 ? <p className="text-[12px] text-mist/70">No completions yet.</p> : (
                <ul className="space-y-2">
                  {done.map((t) => (
                    <li key={t.id} className="flex items-center gap-2.5 text-[12px]">
                      <Check size={13} className="text-emerald-400 shrink-0" />
                      <span className="text-chrome truncate">{t.title}</span>
                      <span className="text-mist/60 ml-auto pl-2 shrink-0">{t.claimedName?.split(" ")[0] ?? "—"} · {timeAgo(new Date(t.completedAt!))}</span>
                    </li>
                  ))}
                </ul>
              );
            })()}
          </Panel>
        </div>

        {/* ============ RIGHT — QUICK ACTIONS ============ */}
        <div className="space-y-4 order-3 anim-fade-up" style={{ animationDelay: "120ms" }}>
          <Panel title="Quick actions">
            <div className="grid grid-cols-1 gap-1.5">
              {qa.map((a) => (
                <Link key={a.label} href={a.href}
                  className="flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-[13px] text-chrome hover:text-white bg-white/[0.03] hover:bg-white/[0.08] border border-white/[0.06] transition-colors">
                  <a.icon size={15} className="text-mist" /> {a.label}
                </Link>
              ))}
              <button onClick={() => setPortalOpen(true)}
                className="flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-[13px] text-left text-chrome hover:text-white bg-gradient-to-r from-white/[0.06] to-white/[0.02] hover:from-white/[0.12] border border-white/[0.09] transition-colors">
                <Link2 size={15} className="text-sky-300" /> Generate client portal link
              </button>
            </div>
          </Panel>

          <Panel title="Today at the shop">
            <ul className="space-y-2.5 text-[12px]">
              <li className="flex justify-between"><span className="text-mist">Workers on the clock</span><span className="text-white tnum">{data.live.clockInCount}</span></li>
              <li className="flex justify-between"><span className="text-mist">Tasks claimed / in progress</span><span className="text-white tnum">{data.live.activeTaskCount}</span></li>
              <li className="flex justify-between"><span className="text-mist">In the backlog</span><span className="text-white tnum">{data.tasks.filter((t) => t.status === "backlog").length}</span></li>
              <li className="flex justify-between"><span className="text-mist">Available to claim</span><span className="text-white tnum">{data.tasks.filter((t) => t.status === "available").length}</span></li>
              <li className="flex justify-between border-t border-white/[0.07] pt-2.5"><span className="text-mist">Stale-update threshold</span><span className="text-white tnum">{data.staleDays} days</span></li>
            </ul>
            <Link href="/admin/monitor" className="mt-4 flex items-center justify-center gap-2 bg-white text-black text-[12px] font-medium rounded-xl py-2.5 hover:bg-chrome transition">
              <AlertTriangle size={0} className="hidden" /> Open Live Monitor <ArrowUpRight size={13} />
            </Link>
          </Panel>

          <Panel title="Inbox zero check">
            <p className="text-[12px] text-mist leading-relaxed">
              {data.inquiries.length === 0
                ? "No open website inquiries. The atelier inbox is calm."
                : `${data.inquiries.length} new ${data.inquiries.length === 1 ? "inquiry" : "inquiries"} from the website need a reply.`}
            </p>
            {data.inquiries.length > 0 && <Inbox size={16} className="text-sky-300 mt-2" />}
          </Panel>
        </div>
      </div>

      {/* portal link modal */}
      <Modal open={portalOpen} onClose={() => setPortalOpen(false)} title="Client portal link">
        <p className="text-mist text-[12.5px] mb-4">Choose a project. The link opens that client&apos;s private restoration journal — no login needed.</p>
        <select className="input-dark" value={portalId} onChange={(e) => setPortalId(e.target.value)}>
          {data.projects.map((p) => (
            <option key={p.id} value={p.id}>{p.clientName} — {p.pianoBrand} {p.pianoModel}</option>
          ))}
        </select>
        {portalProject && (
          <div className="mt-4 bg-white/[0.04] border border-white/10 rounded-xl p-3.5 flex items-center gap-2">
            <p className="text-[11.5px] text-chrome truncate flex-1 tnum">{portalLink}</p>
            <button onClick={copyLink} className="shrink-0 p-2 rounded-lg bg-white/10 hover:bg-white/20 transition text-chrome">
              {copied ? <Check size={14} className="text-emerald-300" /> : <Copy size={14} />}
            </button>
          </div>
        )}
        <p className="text-[10.5px] text-mist/60 mt-3 leading-relaxed">
          Send via SMS or email. Only updates marked visible in the Client Curator appear. Generated {fmtTime(new Date())}.
        </p>
      </Modal>
    </div>
  );
}
