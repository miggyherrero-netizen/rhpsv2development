"use client";

/**
 * Shared primitives for the Home Service workspace. Everything here renders with
 * `--color-svc-*` tokens so the theme stays separate from admin/owner/public.
 */

import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { X, Loader2, Inbox, AlertCircle, CheckCircle2 } from "lucide-react";
import { peso } from "@/lib/format";
import type { Tone } from "@/lib/service";

/* ============================================================
 * Tokens
 * ============================================================ */

export const TONE_TEXT: Record<Tone, string> = {
  slate: "var(--color-svc-text-dim)",
  azure: "var(--color-svc-accent)",
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
    <span className={`tnum ${className}`} style={{ color: negative ? TONE_TEXT.danger : undefined }}>
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
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: Tone;
  icon?: ReactNode;
}) {
  return (
    <div className="card-svc p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[10px] uppercase tracking-[0.18em]" style={{ color: "var(--color-svc-text-faint)" }}>
          {label}
        </p>
        {icon ? <span style={{ color: tone ? TONE_TEXT[tone] : "var(--color-svc-text-faint)" }}>{icon}</span> : null}
      </div>
      <p
        className="font-serif text-2xl mt-2 tnum"
        style={{ color: tone ? TONE_TEXT[tone] : "var(--color-svc-text)" }}
      >
        {value}
      </p>
      {sub ? (
        <p className="text-[11.5px] mt-1" style={{ color: "var(--color-svc-text-faint)" }}>
          {sub}
        </p>
      ) : null}
    </div>
  );
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

/* ============================================================
 * Form pieces
 * ============================================================ */

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
        className="block text-[10.5px] uppercase tracking-[0.16em] mb-1.5"
        style={{ color: "var(--color-svc-text-faint)" }}
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

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`input-svc ${props.className ?? ""}`} />;
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
          onClick={() => onChange(o.key)}
          className="px-3 py-1.5 rounded-full text-[11.5px] transition"
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
