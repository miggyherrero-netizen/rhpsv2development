"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bot, Copy, RefreshCw, Sparkles } from "lucide-react";
import { pesos, summaryToText, type OpsSummary } from "@/lib/ops-summary";
import type { AiReport } from "@/lib/ops-ai";

type AiState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "disabled" | "error"; message: string }
  | { status: "ok"; report: AiReport; model: string };

const sevDot: Record<string, string> = { high: "bg-[var(--color-ow-rose)]", medium: "bg-[var(--color-ow-blue)]", info: "bg-[var(--color-ow-teal)]" };

function Section({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
  return (
    <section className="card-ow p-4 sm:p-5">
      <h2 className="text-[13px] uppercase tracking-[0.1em] text-[var(--color-ow-text-faint)] mb-2">
        {title}{count !== undefined && <span className="ml-2 text-[var(--color-ow-text-dim)]">{count}</span>}
      </h2>
      {children}
    </section>
  );
}
const Empty = ({ children }: { children: React.ReactNode }) => <p className="text-[13px] text-[var(--color-ow-text-dim)]">{children}</p>;

export default function OwnerAssistantClient({ summary, aiAvailable }: { summary: OpsSummary | null; aiAvailable: boolean }) {
  const router = useRouter();
  const [ai, setAi] = useState<AiState>({ status: "idle" });
  const [copied, setCopied] = useState<string | null>(null);

  async function generate() {
    setAi({ status: "loading" });
    try {
      const res = await fetch("/api/ops-assistant/report", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      const body = await res.json();
      if (!res.ok) { setAi({ status: "error", message: body.error ?? "Could not generate the report." }); return; }
      setAi(body.ai);
    } catch {
      setAi({ status: "error", message: "Could not reach the server. The verified summary is still correct." });
    }
  }
  async function copy(text: string, label: string) {
    try { await navigator.clipboard.writeText(text); setCopied(label); setTimeout(() => setCopied(null), 1500); } catch { setCopied(null); }
  }

  return (
    <div className="p-4 sm:p-7 app-page app-page-list [--page-w:900px] space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-serif text-2xl sm:text-3xl text-[var(--color-ow-text)] flex items-center gap-2"><Bot size={24} aria-hidden /> AI Assistant</h1>
          <p className="text-[var(--color-ow-text-dim)] text-[13px]">Read-only. It never changes records, sends messages or moves money.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => router.refresh()} className="rounded-[10px] border border-[var(--color-ow-border-strong)] text-[var(--color-ow-text)] hover:bg-white/[0.05] min-h-11 px-3 inline-flex items-center gap-2 text-[14px]"><RefreshCw size={15} aria-hidden /> Refresh summary</button>
          {summary && <button type="button" onClick={() => copy(summaryToText(summary), "facts")} className="rounded-[10px] border border-[var(--color-ow-border-strong)] text-[var(--color-ow-text)] hover:bg-white/[0.05] min-h-11 px-3 inline-flex items-center gap-2 text-[14px]"><Copy size={15} aria-hidden /> {copied === "facts" ? "Copied" : "Copy summary"}</button>}
        </div>
      </header>

      {!summary ? (
        <Section title="Summary unavailable"><Empty>The summary could not be loaded right now. Nothing was changed. Try Refresh, or open Service → Today.</Empty></Section>
      ) : (
        <>
          <Section title="Verified facts — Daily overview" count={summary.priorities.length}>
            {summary.priorities.length === 0 ? <Empty>Nothing needs attention right now.</Empty> : (
              <ul className="space-y-2">
                {summary.priorities.map((p) => (
                  <li key={p.key} className="flex items-start gap-3 text-[14px] text-[var(--color-ow-text)]">
                    <span className={`mt-1.5 h-2 w-2 rounded-full shrink-0 ${sevDot[p.severity]}`} aria-hidden />
                    <span>{p.label} <span className="text-[var(--color-ow-text-dim)] tabular-nums">· {p.count}{p.amountCents != null ? ` · ${pesos(p.amountCents)}` : ""}</span></span>
                  </li>
                ))}
              </ul>
            )}
            {summary.missing.length > 0 && <p className="mt-3 text-[12px] text-[var(--color-ow-text-faint)]">Missing info: {summary.missing.join(" ")}</p>}
          </Section>

          <div className="grid gap-4 md:grid-cols-2">
            <Section title="Appointments today" count={summary.appointments.count}>
              {summary.appointments.items.length === 0 ? <Empty>No visits scheduled today.</Empty> : (
                <ul className="ow-divide">{summary.appointments.items.map((a) => (
                  <li key={a.id} className="py-2 text-[14px] text-[var(--color-ow-text)]">
                    <span className="tabular-nums text-[var(--color-ow-text-dim)]">{a.time}</span> · {a.serviceType} · {a.customerName}
                    <div className="text-[12px] text-[var(--color-ow-text-dim)]">{a.piano}{a.area ? ` · ${a.area}` : ""} · {a.status.replace("_", " ")}</div>
                  </li>))}</ul>
              )}
              {summary.closeOut.count > 0 && <p className="mt-2 text-[12px] text-[var(--color-ow-rose)]">{summary.closeOut.count} past-date visit(s) still open — <Link className="underline" href="/service/today">close out</Link></p>}
            </Section>

            <Section title="Customer follow-ups" count={summary.followUps.count}>
              {summary.followUps.items.length === 0 ? <Empty>No follow-ups due.</Empty> : (
                <ul className="ow-divide">{summary.followUps.items.map((f) => (
                  <li key={f.id} className="py-2 text-[14px] text-[var(--color-ow-text)]">{f.customerName} <span className="text-[12px] text-[var(--color-ow-text-dim)]">· {f.state}</span>{f.note && <div className="text-[12px] text-[var(--color-ow-text-dim)]">{f.note}</div>}</li>))}</ul>
              )}
            </Section>

            <Section title="Workshop tasks" count={summary.workshop.openTasks}>
              <p className="text-[13px] text-[var(--color-ow-text-dim)] mb-2">{summary.workshop.openProjects} open projects · {summary.workshop.unassignedTasks} unassigned · {summary.workshop.overdueTasks} past due · {summary.workshop.waitingPartsTasks} waiting for parts</p>
              {summary.workshop.items.length === 0 ? <Empty>No open workshop tasks.</Empty> : (
                <ul className="ow-divide">{summary.workshop.items.slice(0, 8).map((t) => (
                  <li key={t.id} className="py-2 text-[14px] text-[var(--color-ow-text)]">{t.title}
                    <div className="text-[12px] text-[var(--color-ow-text-dim)]">{t.project ?? "No project"} · {t.assignees.length ? t.assignees.join(", ") : "unassigned"}{t.overdue ? " · past due" : ""}</div>
                  </li>))}</ul>
              )}
            </Section>

            <Section title="Financial attention" count={summary.financial.items.length}>
              <p className="text-[13px] text-[var(--color-ow-text-dim)] mb-2 tabular-nums">Outstanding {pesos(summary.financial.outstandingCents)} · overdue {pesos(summary.financial.overdueCents)} · {summary.financial.draftCount} drafts</p>
              {summary.financial.items.length === 0 ? <Empty>No unpaid invoices.</Empty> : (
                <ul className="ow-divide">{summary.financial.items.slice(0, 8).map((i) => (
                  <li key={i.id} className="py-2 text-[14px] text-[var(--color-ow-text)] flex justify-between gap-3">
                    <Link className="underline decoration-dotted" href={`/service/invoices/${i.id}`}>{i.code} · {i.customerName}</Link>
                    <span className="tabular-nums">{pesos(i.balanceCents)}{i.daysOverdue > 0 ? ` · ${i.daysOverdue}d overdue` : ""}</span>
                  </li>))}</ul>
              )}
            </Section>

            <Section title="Maintenance recalls" count={summary.maintenance.count}>
              {summary.maintenance.items.length === 0 ? <Empty>No pianos due soon.</Empty> : (
                <ul className="ow-divide">{summary.maintenance.items.slice(0, 8).map((m) => (
                  <li key={m.pianoId} className="py-2 text-[14px] text-[var(--color-ow-text)]">{m.piano} · {m.customerName}
                    <div className="text-[12px] text-[var(--color-ow-text-dim)]">{m.timing} · {m.dueDate}</div></li>))}</ul>
              )}
            </Section>
          </div>
        </>
      )}

      <Section title="AI recommendations (not verified facts)">
        <p className="text-[13px] text-[var(--color-ow-text-dim)] mb-3">
          {aiAvailable ? "Sends a reduced copy of the summary to the AI provider: no titles, notes, phone numbers, addresses or piano models, and names replaced by codes (like Customer 1). Action lines are built from your own records; the overview and the “why” sentences are the AI's own wording and are not verified." : "AI analysis is switched off. Everything above works without it."}
        </p>
        <button type="button" disabled={!summary || !aiAvailable || ai.status === "loading"} onClick={generate}
          className="btn-ow-primary min-h-11 px-4 inline-flex items-center gap-2 text-[14px] disabled:opacity-50">
          <Sparkles size={15} aria-hidden /> {ai.status === "loading" ? "Generating…" : "Generate report"}
        </button>
        <div role="status" aria-live="polite" className="mt-3">
          {(ai.status === "error" || ai.status === "disabled") && <p className="text-[13px] text-[var(--color-ow-rose)]">{ai.message}</p>}
          {ai.status === "ok" && (
            <div className="rounded-[10px] border border-[var(--color-ow-border-strong)] p-4 space-y-3 text-[14px] text-[var(--color-ow-text)]">
              <p className="text-[12px] uppercase tracking-[0.1em] text-[var(--color-ow-violet)]">AI-generated wording is unverified · check before acting</p>
              <p>{ai.report.overview}</p>
              <div><h3 className="font-medium">Top priorities</h3><ol className="list-decimal pl-5 space-y-1">{ai.report.topThree.map((t, i) => <li key={i}><strong>{t.title}</strong> — {t.why}</li>)}</ol></div>
              <div><h3 className="font-medium">Recommended next actions</h3><ul className="list-disc pl-5 space-y-1">{ai.report.recommendedActions.map((a, i) => <li key={i}>{a}</li>)}</ul></div>
              {ai.report.missingInfo.length > 0 && <div><h3 className="font-medium">Missing information</h3><ul className="list-disc pl-5 space-y-1">{ai.report.missingInfo.map((a, i) => <li key={i}>{a}</li>)}</ul></div>}
              <button type="button" className="rounded-[10px] border border-[var(--color-ow-border-strong)] text-[var(--color-ow-text)] hover:bg-white/[0.05] min-h-11 px-3 inline-flex items-center gap-2 text-[14px]"
                onClick={() => copy([ai.report.overview, ...ai.report.topThree.map((t, i) => `${i + 1}. ${t.title} — ${t.why}`), ...ai.report.recommendedActions.map((a) => `- ${a}`)].join("\n"), "ai")}>
                <Copy size={15} aria-hidden /> {copied === "ai" ? "Copied" : "Copy report"}
              </button>
            </div>
          )}
        </div>
      </Section>
    </div>
  );
}
