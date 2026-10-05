"use client";

/**
 * Shared primitives for the Home Service workspace. Everything here renders with
 * `--color-svc-*` tokens so the theme stays separate from admin/owner/public.
 */

import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { X, Loader2, Inbox, AlertCircle, CheckCircle2, Ellipsis } from "lucide-react";
import { fmtDate, fmtTime, peso } from "@/lib/format";
import { confirmMatches, parsePesoInput } from "@/lib/service-flow";
import type { Tone } from "@/lib/service";

/* ============================================================
 * Tokens
 * ============================================================ */

export const TONE_TEXT: Record<Tone, string> = {
  slate: "var(--color-svc-text-dim)",
  azure: "var(--color-svc-accent-text, var(--color-svc-accent))",
  violet: "var(--color-svc-violet)",
  success: "var(--color-svc-success)",
  warn: "var(--color-svc-warn)",
  danger: "var(--color-svc-danger)",
};

export const TONE_SOFT: Record<Tone, string> = {
  slate: "rgba(148,163,184,0.14)",
  azure: "var(--color-svc-accent-soft)",
  violet: "var(--color-svc-violet-soft)",
  success: "var(--color-svc-success-soft)",
  warn: "var(--color-svc-warn-soft)",
  danger: "var(--color-svc-danger-soft)",
};

export const TONE_BAR: Record<Tone, string> = {
  slate: "#64748b",
  azure: "var(--color-svc-accent)",
  violet: "var(--color-svc-violet)",
  success: "var(--color-svc-success)",
  warn: "var(--color-svc-warn)",
  danger: "var(--color-svc-danger)",
};

/* ============================================================
 * Small display pieces
 * ============================================================ */

export function Money({
  cents,
  className = "",
  signed = false,
}: {
  cents: number;
  className?: string;
  signed?: boolean;
}) {
  const value = peso(Math.abs(cents));
  const negative = cents < 0;
  return (
    <span className={`svc-num ${className}`} style={{ color: negative ? TONE_TEXT.danger : undefined }}>
      {negative ? "−" : signed && cents > 0 ? "+" : ""}
      {value}
    </span>
  );
}

export function Chip({
  tone = "slate",
  children,
  className = "",
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10.5px] font-medium tracking-wide ${className}`}
      style={{ background: TONE_SOFT[tone], color: TONE_TEXT[tone], border: `1px solid ${TONE_SOFT[tone]}` }}
    >
      {children}
    </span>
  );
}

export function StatusChip({
  status,
  label,
  toneMap,
}: {
  status: string;
  label?: string;
  toneMap: Record<string, Tone>;
}) {
  const tone = toneMap[status] ?? "slate";
  return <Chip tone={tone}>{label ?? status.replace(/_/g, " ")}</Chip>;
}

export function Dot({ color, size = 7 }: { color: string; size?: number }) {
  return (
    <span
      className="inline-block rounded-full shrink-0"
      style={{ width: size, height: size, background: color }}
    />
  );
}

export function StatCard({
  label,
  value,
  sub,
  tone,
  icon,
  href,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: Tone;
  icon?: ReactNode;
  /** Makes the whole tile a link (e.g. Outstanding → the filtered invoice list). */
  href?: string;
}) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <p className="text-[11px] uppercase tracking-[0.1em]" style={{ color: "var(--color-svc-text-dim)" }}>
          {label}
        </p>
        {icon ? <span style={{ color: tone ? TONE_TEXT[tone] : "var(--color-svc-text-faint)" }}>{icon}</span> : null}
      </div>
      <p
        className="svc-num text-2xl font-semibold mt-2"
        style={{ color: tone ? TONE_TEXT[tone] : "var(--color-svc-text)" }}
      >
        {value}
      </p>
      {sub ? (
        <p className="text-[12px] mt-1" style={{ color: "var(--color-svc-text-faint)" }}>
          {sub}
        </p>
      ) : null}
    </>
  );
  if (href) {
    return (
      <Link
        href={href}
        className="card-svc card-svc-hover block p-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-svc-accent)]"
      >
        {body}
      </Link>
    );
  }
  return <div className="card-svc p-4">{body}</div>;
}

export function SectionCard({
  title,
  action,
  children,
  className = "",
}: {
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`card-svc ${className}`}>
      {(title || action) && (
        <header
          className="flex items-center justify-between gap-4 px-5 py-3.5"
          style={{ borderBottom: "1px solid var(--color-svc-border)" }}
        >
          <h2 className="text-[13px] font-medium" style={{ color: "var(--color-svc-text)" }}>
            {title}
          </h2>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

export function EmptyState({
  icon,
  title,
  hint,
  action,
}: {
  icon?: ReactNode;
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center text-center px-6 py-14">
      <div
        className="w-11 h-11 rounded-2xl flex items-center justify-center mb-3"
        style={{ background: "var(--color-svc-surface-2)", color: "var(--color-svc-text-faint)" }}
      >
        {icon ?? <Inbox size={19} strokeWidth={1.7} />}
      </div>
      <p className="text-[13.5px]" style={{ color: "var(--color-svc-text-dim)" }}>
        {title}
      </p>
      {hint ? (
        <p className="text-[12px] mt-1 max-w-sm" style={{ color: "var(--color-svc-text-faint)" }}>
          {hint}
        </p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

/* ============================================================
 * Overlays
 * ============================================================ */

export function SvcModal({
  open,
  onClose,
  title,
  subtitle,
  children,
  wide = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const fn = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-6">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm anim-fade-in" onClick={onClose} />
      <div
        className={`relative w-full ${wide ? "sm:max-w-3xl" : "sm:max-w-lg"} max-h-[92vh] overflow-y-auto thin-scroll anim-sheet card-svc sm:rounded-2xl rounded-t-2xl p-6`}
      >
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h3 className="font-serif text-xl" style={{ color: "var(--color-svc-text)" }}>
              {title}
            </h3>
            {subtitle ? (
              <p className="text-[12px] mt-0.5" style={{ color: "var(--color-svc-text-faint)" }}>
                {subtitle}
              </p>
            ) : null}
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg transition hover:bg-white/[0.06]"
            style={{ color: "var(--color-svc-text-faint)" }}
            aria-label="Close"
          >
            <X size={17} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function ConfirmDialog({
  open,
  title = "Are you sure?",
  message,
  confirmLabel = "Delete",
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title?: string;
  message?: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-6">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm anim-fade-in" onClick={onCancel} />
      <div className="relative card-svc max-w-sm w-full p-6 anim-sheet">
        <p className="font-serif text-lg" style={{ color: "var(--color-svc-text)" }}>
          {title}
        </p>
        {message ? (
          <p className="text-[12.5px] mt-1.5" style={{ color: "var(--color-svc-text-dim)" }}>
            {message}
          </p>
        ) : null}
        <div className="flex gap-2 mt-5">
          <button onClick={onCancel} className="btn-svc-ghost flex-1 text-[13px] rounded-xl py-2.5">
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 text-[13px] rounded-xl py-2.5 font-medium"
            style={{ background: TONE_SOFT.danger, color: TONE_TEXT.danger }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Delete-style confirmation that needs the record's code typed back (WO-2026-0012 / INV-2026-0031).
 * The server checks the same code again, so a forged call can't skip this.
 */
type ConfirmTypeProps = {
  open: boolean; title: string; message?: string; code: string; confirmLabel?: string;
  error?: string | null; pending?: boolean; onConfirm: (typed: string) => void; onCancel: () => void;
};

export function ConfirmTypeDialog(props: ConfirmTypeProps) {
  // Mounted only while open, so the typed text always starts empty.
  return props.open ? <ConfirmTypeInner {...props} /> : null;
}

function ConfirmTypeInner({
  title, message, code, confirmLabel = "Delete", error, pending, onConfirm, onCancel,
}: ConfirmTypeProps) {
  const [typed, setTyped] = useState("");
  const id = useId();
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [onCancel]);
  const ready = confirmMatches(typed, code);
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-6">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm anim-fade-in" onClick={onCancel} />
      <form
        role="alertdialog" aria-modal="true" aria-labelledby={`${id}-t`}
        onSubmit={(e) => { e.preventDefault(); if (ready && !pending) onConfirm(typed); }}
        className="relative card-svc max-w-sm w-full p-6 anim-sheet"
      >
        <p id={`${id}-t`} className="font-serif text-lg" style={{ color: "var(--color-svc-text)" }}>{title}</p>
        {message ? <p className="text-[12.5px] mt-1.5" style={{ color: "var(--color-svc-text-dim)" }}>{message}</p> : null}
        <label htmlFor={`${id}-i`} className="block text-[12.5px] mt-4" style={{ color: "var(--color-svc-text-dim)" }}>
          Type <b className="font-mono font-medium" style={{ color: "var(--color-svc-text)" }}>{code}</b> to confirm
        </label>
        <input
          id={`${id}-i`} autoFocus autoComplete="off" spellCheck={false} value={typed}
          onChange={(e) => setTyped(e.target.value)} placeholder={code}
          className="input-svc mt-1.5 font-mono"
        />
        {error ? <p role="alert" className="text-[12px] mt-2" style={{ color: TONE_TEXT.danger }}>{error}</p> : null}
        <div className="flex gap-2 mt-5">
          <button type="button" onClick={onCancel} className="btn-svc-ghost flex-1 text-[13px] rounded-xl min-h-11">Cancel</button>
          <button
            type="submit" disabled={!ready || pending}
            className="flex-1 text-[13px] rounded-xl min-h-11 font-medium disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ background: TONE_SOFT.danger, color: TONE_TEXT.danger }}
          >
            {pending ? "Deleting…" : confirmLabel}
          </button>
        </div>
      </form>
    </div>
  );
}

export type MoreItem = {
  label: string;
  onSelect?: () => void;
  href?: string;
  danger?: boolean;
  disabled?: boolean;
  icon?: ReactNode;
  /** Draws a divider above this item (used to set Delete apart). */
  separated?: boolean;
};

/** "⋯ More": a disclosure list for secondary and dangerous actions. Esc / outside click / focus-out close it. */
export function MoreMenu({ items, label = "More" }: { items: MoreItem[]; label?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); trigger.current?.focus(); } };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);
  const row = "flex w-full items-center gap-2.5 px-3.5 min-h-11 text-left text-[13px] hover:bg-white/[0.06] disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-[-2px] focus-visible:outline-[var(--color-svc-accent)]";
  return (
    <div ref={ref} className="relative" onBlur={(e) => { if (!ref.current?.contains(e.relatedTarget as Node | null)) setOpen(false); }}>
      <button
        ref={trigger} type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}
        className="btn-svc-ghost rounded-xl px-3.5 min-h-10 text-[12.5px] inline-flex items-center gap-1.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-svc-accent)]"
      >
        <Ellipsis size={15} /> {label}
      </button>
      {open && (
        <div id={id} className="absolute right-0 top-full mt-2 z-30 w-60 overflow-hidden rounded-xl border bg-[var(--color-svc-surface-2)]" style={{ borderColor: "var(--color-svc-border-strong)", boxShadow: "0 16px 40px rgba(0,0,0,0.45)" }}>
          {items.map((it) => {
            const style = { color: it.danger ? TONE_TEXT.danger : "var(--color-svc-text)", borderTop: it.separated ? "1px solid var(--color-svc-border)" : undefined };
            return it.href ? (
              <Link key={it.label} href={it.href} onClick={() => setOpen(false)} className={row} style={style}>{it.icon}{it.label}</Link>
            ) : (
              <button key={it.label} type="button" disabled={it.disabled} onClick={() => { setOpen(false); it.onSelect?.(); }} className={row} style={style}>
                {it.icon}{it.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ============================================================
 * Form pieces
 * ============================================================ */

/** ₱-prefixed money box that accepts "2,500" / "2500.50" and flags unreadable text. Value stays a string. */
export function PesoInput({
  value, onChange, placeholder = "e.g. 2,500", suffix, ...rest
}: { value: string; onChange: (v: string) => void; placeholder?: string; suffix?: string } & Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type">) {
  const bad = value.trim() !== "" && parsePesoInput(value) === null;
  return (
    <UnitInput
      {...rest} type="text" inputMode="decimal" autoComplete="off" prefix="₱" suffix={suffix}
      value={value} placeholder={placeholder} aria-invalid={bad || undefined}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

/** Native date / date-time picker that also spells the chosen date in the app's own format underneath. */
export function DateField({
  value, onChange, kind = "date", ...rest
}: { value: string; onChange: (v: string) => void; kind?: "date" | "datetime-local" } & Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type">) {
  let caption = "";
  if (value) {
    const d = new Date(kind === "date" ? `${value}T12:00:00+08:00` : `${value.length === 16 ? `${value}:00` : value}+08:00`);
    if (!Number.isNaN(d.getTime())) caption = kind === "date" ? `${fmtDate(d)}, ${d.getUTCFullYear()}` : `${fmtDate(d)} · ${fmtTime(d)}`;
  }
  return (
    <span className="block">
      <input {...rest} type={kind} value={value} onChange={(e) => onChange(e.target.value)} className="input-svc svc-num" />
      <span className="block text-[12px] mt-1 min-h-[16px]" style={{ color: "var(--color-svc-text-faint)" }} aria-live="polite">{caption}</span>
    </span>
  );
}

export function Field({
  label,
  hint,
  children,
  className = "",
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <span
        className="block text-[11px] uppercase tracking-[0.1em] mb-1.5"
        style={{ color: "var(--color-svc-text-dim)" }}
      >
        {label}
      </span>
      {children}
      {hint ? (
        <span className="block text-[11px] mt-1" style={{ color: "var(--color-svc-text-faint)" }}>
          {hint}
        </span>
      ) : null}
    </label>
  );
}

/**
 * On/off setting row. A real checkbox (`role="switch"`) sits under the visual track, so
 * clicking the label, Tab + Space, and screen readers all work natively; the hint is
 * wired up via `aria-describedby`.
 */
export function ToggleRow({
  label,
  hint,
  checked,
  onChange,
  disabled = false,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const labelId = `${id}-label`;
  // A disabled switch never reads as "on": it renders off/grey (the stored value is untouched).
  const on = checked && !disabled;
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <label id={labelId} htmlFor={id} className="block text-[13px] cursor-pointer" style={{ color: "var(--color-svc-text)" }}>
          {label}
        </label>
        {hint ? (
          <p id={hintId} className="text-[11.5px] mt-0.5" style={{ color: "var(--color-svc-text-faint)" }}>
            {hint}
          </p>
        ) : null}
      </div>
      <span className={`relative inline-flex shrink-0 mt-0.5 ${disabled ? "opacity-50" : ""}`}>
        <input
          id={id}
          type="checkbox"
          role="switch"
          checked={on}
          disabled={disabled}
          aria-disabled={disabled || undefined}
          aria-labelledby={labelId}
          aria-describedby={hint ? hintId : undefined}
          onChange={(e) => onChange(e.target.checked)}
          className="peer absolute left-0 right-0 top-1/2 -translate-y-1/2 w-full h-11 opacity-0 m-0 cursor-pointer disabled:cursor-not-allowed"
        />
        <span
          aria-hidden
          className="pointer-events-none w-9 h-5 rounded-full transition-colors peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--color-svc-accent)]"
          style={{
            background: on ? "var(--color-svc-accent)" : "var(--color-svc-surface-2)",
            border: `1px solid ${on ? "var(--color-svc-accent)" : "var(--color-svc-border-strong)"}`,
          }}
        />
        <span
          aria-hidden
          className="pointer-events-none absolute top-[3px] left-[3px] w-3.5 h-3.5 rounded-full transition-transform"
          style={{
            background: on ? "#051021" : "var(--color-svc-text-dim)",
            transform: on ? "translateX(16px)" : "translateX(0)",
          }}
        />
      </span>
    </div>
  );
}

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`input-svc ${props.className ?? ""}`} />;
}

/** Number/text input with the unit inside the box: ₱ [ 500 ] /hr, [ 30 ] days, [ 12 ] %. */
export function UnitInput({
  prefix, suffix, className = "", ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { prefix?: string; suffix?: string }) {
  const dim = { color: props.disabled ? "var(--color-svc-text-faint)" : "var(--color-svc-text-dim)" };
  return (
    <span className="relative block">
      {prefix ? <span aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[13px]" style={dim}>{prefix}</span> : null}
      <input
        {...props}
        className={`input-svc svc-num ${className}`}
        style={{ paddingLeft: prefix ? "1.9rem" : undefined, paddingRight: suffix ? `${Math.max(2.6, suffix.length * 0.62 + 1.2)}rem` : undefined, ...props.style }}
      />
      {suffix ? <span aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[12px]" style={dim}>{suffix}</span> : null}
    </span>
  );
}

export function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`input-svc ${props.className ?? ""}`} />;
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`input-svc ${props.className ?? ""}`} />;
}

export function PrimaryButton({
  children,
  pending,
  className = "",
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { pending?: boolean }) {
  return (
    <button
      {...rest}
      disabled={rest.disabled || pending}
      className={`btn-svc-primary rounded-xl px-4 py-2.5 text-[13px] inline-flex items-center justify-center gap-2 disabled:cursor-not-allowed ${className}`}
    >
      {pending ? <Loader2 size={14} className="animate-spin" /> : null}
      {children}
    </button>
  );
}

export function GhostButton({
  children,
  className = "",
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button {...rest} className={`btn-svc-ghost rounded-xl px-3.5 py-2 text-[12.5px] ${className}`}>
      {children}
    </button>
  );
}

export function ErrorLine({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p
      className="text-[12px] mt-3 flex items-center gap-1.5"
      style={{ color: TONE_TEXT.danger }}
      role="alert"
    >
      <AlertCircle size={13} /> {children}
    </p>
  );
}

export function SuccessLine({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p className="text-[12px] mt-3 flex items-center gap-1.5" style={{ color: TONE_TEXT.success }}>
      <CheckCircle2 size={13} /> {children}
    </p>
  );
}

/** Inline filter pills used across list screens. */
export function FilterPills<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { key: T; label: string }[];
  value: T;
  onChange: (key: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          aria-pressed={value === o.key}
          onClick={() => onChange(o.key)}
          className="px-3.5 min-h-10 rounded-full text-[12.5px] transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-svc-accent)]"
          style={{
            background: value === o.key ? "var(--color-svc-accent-soft)" : "var(--color-svc-surface-2)",
            color: value === o.key ? TONE_TEXT.azure : "var(--color-svc-text-dim)",
            border: `1px solid ${value === o.key ? "var(--color-svc-accent-soft)" : "var(--color-svc-border)"}`,
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/**
 * One date-range control for a whole page. The range lives in the URL (`?range=`), so the
 * server computes every tile, chart and breakdown from the same window and links can be shared.
 */
export function RangePicker<T extends string>({ options, value, param = "range" }: { options: readonly { key: T; label: string }[]; value: T; param?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [pending, start] = useTransition();
  const go = (key: T) => {
    const next = new URLSearchParams(sp.toString());
    next.set(param, key);
    start(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
  };
  return (
    <div role="group" aria-label="Date range" aria-busy={pending} className={pending ? "opacity-70 transition-opacity" : "transition-opacity"}>
      <FilterPills options={[...options]} value={value} onChange={go} />
    </div>
  );
}

/** Horizontal proportion bar for breakdowns (expenses, AR aging). */
export function Bar({ pct, color }: { pct: number; color: string }) {
  return (
    <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "var(--color-svc-surface-2)" }}>
      <div
        className="h-full rounded-full transition-all"
        style={{ width: `${Math.max(0, Math.min(100, pct))}%`, background: color }}
      />
    </div>
  );
}

/**
 * Tiny external clock store: the timer lives outside React, so no component sets state
 * from inside an effect. `useSyncExternalStore` with a null server snapshot means the
 * server never renders a time the client would disagree with (no hydration mismatch).
 */
function createClockStore(intervalMs: number) {
  let listeners = new Set<() => void>();
  let timer: ReturnType<typeof setInterval> | null = null;
  let value = 0;
  return {
    subscribe(onChange: () => void) {
      listeners.add(onChange);
      if (!timer) {
        value = Date.now();
        timer = setInterval(() => {
          value = Date.now();
          listeners.forEach((l) => l());
        }, intervalMs);
      }
      return () => {
        listeners.delete(onChange);
        if (listeners.size === 0 && timer) {
          clearInterval(timer);
          timer = null;
        }
      };
    },
    getSnapshot: () => value,
  };
}

/** Live clock, or `null` until the component has mounted on the client. */
export function useNow(intervalMs = 30_000): Date | null {
  const store = useMemo(() => createClockStore(intervalMs), [intervalMs]);
  const ts = useSyncExternalStore(store.subscribe, store.getSnapshot, () => 0);
  return ts ? new Date(ts) : null;
}
