"use client";

/**
 * Shared primitives for the Accounting section — built on the Admin back-office's
 * existing dark theme (card-dark / input-dark / text-mist), reusing `ui.tsx` modal
 * primitives. No new design system: this is the same visual language as /admin.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { Settings } from "lucide-react";
import { peso, fmtDate } from "@/lib/format";
import { KIND_LABEL, KIND_TONE, STREAM_LABEL, TONE_CLASS } from "@/lib/accounting";

/* ---------- layout ---------- */

export function AccountingHeader({ title, sub, action }: { title: string; sub?: string; action?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3 anim-fade-up">
      <div>
        <p className="text-[9.5px] uppercase tracking-[0.3em] text-mist/70">Accounting</p>
        <h1 className="font-serif text-2xl sm:text-3xl text-white mt-1">{title}</h1>
        {sub && <p className="text-mist text-[12.5px] mt-1">{sub}</p>}
      </div>
      <div className="flex items-center gap-2.5">
        {action}
        <Link href="/admin/accounting/settings" className="card-dark px-3 py-2 text-chrome hover:text-white transition flex items-center gap-2 text-[12px]">
          <Settings size={14} /> Settings
        </Link>
      </div>
    </div>
  );
}

export function SectionCard({ title, action, children, className = "" }: { title: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card-dark p-4 sm:p-5 ${className}`}>
      <div className="flex items-center justify-between mb-3.5">
        <p className="text-[10px] uppercase tracking-[0.22em] text-mist">{title}</p>
        {action}
      </div>
      {children}
    </section>
  );
}

/* ---------- money & stats ---------- */

export function Money({ cents, className = "", colored = false }: { cents: number; className?: string; colored?: boolean }) {
  return (
    <span className={`tnum ${colored ? (cents < 0 ? "text-rose-300" : cents > 0 ? "text-emerald-300" : "") : ""} ${className}`}>
      {peso(cents)}
    </span>
  );
}

export function StatCard({ label, value, sub, tone, icon }: { label: string; value: ReactNode; sub?: ReactNode; tone?: "emerald" | "rose" | "amber" | "sky" | "violet"; icon?: ReactNode }) {
  const toneText = tone === "emerald" ? "text-emerald-300" : tone === "rose" ? "text-rose-300" : tone === "amber" ? "text-amber-300" : tone === "sky" ? "text-sky-300" : tone === "violet" ? "text-violet-300" : "text-white";
  return (
    <div className="card-dark p-4">
      <div className="flex items-center justify-between mb-2">
        <p className="text-[10px] uppercase tracking-[0.18em] text-mist">{label}</p>
        {icon && <span className="text-mist/70">{icon}</span>}
      </div>
      <p className={`font-serif text-[21px] leading-tight tnum ${toneText}`}>{value}</p>
      {sub && <p className="text-[11px] text-mist mt-1.5">{sub}</p>}
    </div>
  );
}

/* ---------- chips & bars ---------- */

export function Chip({ children, tone = "slate" }: { children: ReactNode; tone?: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10.5px] font-medium ${TONE_CLASS[tone] ?? TONE_CLASS.slate}`}>
      {children}
    </span>
  );
}

export function KindChip({ kind }: { kind: string }) {
  return <Chip tone={KIND_TONE[kind] ?? "slate"}>{KIND_LABEL[kind] ?? kind}</Chip>;
}

export function StreamChip({ stream }: { stream: string }) {
  return <span className="text-[10.5px] text-mist/80">{STREAM_LABEL[stream] ?? stream}</span>;
}

export function Bar({ pct, color = "rgba(255,255,255,0.35)" }: { pct: number; color?: string }) {
  return (
    <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
      <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(100, Math.max(0, pct))}%`, background: color }} />
    </div>
  );
}

export const BAR_COLORS: Record<string, string> = {
  slate: "#94a3b8", sky: "#7dd3fc", emerald: "#6ee7b7", amber: "#fcd34d", rose: "#fda4af", violet: "#c4b5fd",
};
export const barTone = (tone: string): string => BAR_COLORS[tone] ?? BAR_COLORS.slate;

/* ---------- dates ---------- */

export const Day = ({ iso }: { iso: string }) => <span className="tnum">{fmtDate(new Date(iso))}</span>;

/* ---------- action plumbing ---------- */

export type ActionResult = { ok: true; data?: unknown } | { ok: false; error: string };

export function useAction() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  async function run(fn: () => Promise<ActionResult>, opts?: { refresh?: boolean; notice?: string }): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      const res = await fn();
      if (!res.ok) {
        setError(res.error);
        return false;
      }
      if (opts?.notice) setNotice(opts.notice);
      if (opts?.refresh !== false) router.refresh();
      return true;
    } catch {
      setError("Something went wrong — nothing was saved.");
      return false;
    } finally {
      setBusy(false);
    }
  }
  return { run, busy, error, notice, setError, setNotice };
}

export function FormError({ error }: { error: string | null }) {
  if (!error) return null;
  return <p className="text-[12px] text-rose-300 bg-rose-400/10 border border-rose-400/20 rounded-lg px-3 py-2">{error}</p>;
}

export function Btn({
  children, onClick, busy, disabled, variant = "primary", type = "button", className = "", title,
}: {
  children: ReactNode; onClick?: () => void; busy?: boolean; disabled?: boolean;
  variant?: "primary" | "ghost" | "danger"; type?: "button" | "submit"; className?: string; title?: string;
}) {
  const base = "inline-flex items-center justify-center gap-2 rounded-xl text-[12.5px] font-medium transition disabled:opacity-50 disabled:cursor-not-allowed px-4 py-2";
  const style =
    variant === "primary" ? "bg-white text-black hover:bg-chrome"
    : variant === "danger" ? "border border-rose-400/25 text-rose-300 hover:bg-rose-400/10"
    : "card-dark text-chrome hover:text-white";
  return (
    <button type={type} onClick={onClick} disabled={disabled || busy} title={title} className={`${base} ${style} ${className}`}>
      {busy ? <span className="inline-block w-3.5 h-3.5 border-[1.5px] border-current border-t-transparent rounded-full animate-spin" /> : null}
      {children}
    </button>
  );
}

/* ---------- csv export ---------- */

/** Client-side CSV download (BOM-prefixed so Excel reads ₱ and commas correctly). */
export function downloadCsv(filename: string, rows: (string | number | null | undefined)[][]) {
  const esc = (v: string | number | null | undefined) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  };
  const csv = rows.map((r) => r.map(esc).join(",")).join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
