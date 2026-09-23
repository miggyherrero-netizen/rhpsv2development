"use client";

import { X, Loader2, Inbox } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect } from "react";

export function Modal({
  open, onClose, title, children, dark = true, wide = false,
}: {
  open: boolean; onClose: () => void; title: string; children: ReactNode; dark?: boolean; wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const fn = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-6">
      <div className="absolute inset-0 bg-black/55 backdrop-blur-sm anim-fade-in" onClick={onClose} />
      <div
        className={`relative w-full ${wide ? "max-w-2xl" : "max-w-md"} max-h-[92vh] overflow-y-auto thin-scroll anim-sheet p-6 sm:p-7 sm:rounded-2xl rounded-t-2xl ${
          dark ? "bg-panel text-chrome border border-white/10 shadow-2xl" : "bg-parchment text-ink border border-white/10 shadow-2xl"
        }`}
      >
        <div className="flex items-center justify-between mb-5">
          <h3 className={`font-serif text-xl ${dark ? "text-white" : "text-ink"}`}>{title}</h3>
          <button
            onClick={onClose}
            className={`p-1.5 rounded-lg transition ${dark ? "hover:bg-white/10 text-mist" : "hover:bg-white/10 text-mist"}`}
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

export function OwnerModal({
  open, onClose, title, children, wide = false,
}: {
  open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const fn = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-6">
      <div className="absolute inset-0 bg-black/55 backdrop-blur-sm anim-fade-in" onClick={onClose} />
      <div
        className={`relative w-full ${wide ? "max-w-2xl" : "max-w-md"} max-h-[92vh] overflow-y-auto thin-scroll anim-sheet p-6 sm:p-7 sm:rounded-2xl rounded-t-2xl card-ow`}
      >
        <div className="flex items-center justify-between mb-5">
          <h3 className="font-serif text-xl text-[var(--color-ow-text)]">{title}</h3>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg transition hover:bg-white/10 text-[var(--color-ow-text-dim)]"
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

export function Drawer({
  open, onClose, children, dark = true,
}: {
  open: boolean; onClose: () => void; children: ReactNode; dark?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const fn = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/55 backdrop-blur-sm anim-fade-in" onClick={onClose} />
      <div
        className={`absolute right-0 top-0 h-full w-full sm:max-w-xl overflow-y-auto thin-scroll anim-drawer shadow-2xl ${
          dark ? "bg-[#0d1116] text-chrome border-l border-white/10" : "bg-white text-ink border-l border-slate-200"
        }`}
      >
        {children}
      </div>
    </div>
  );
}

export function Field({ label, children, dark = true }: { label: string; children: ReactNode; dark?: boolean }) {
  return (
    <label className="block">
      <span className={`block text-[11px] uppercase tracking-[0.14em] mb-1.5 ${dark ? "text-mist" : "text-smoke"}`}>
        {label}
      </span>
      {children}
    </label>
  );
}

export function Spinner({ className = "" }: { className?: string }) {
  return <Loader2 size={16} className={`animate-spin ${className}`} />;
}

export function EmptyState({
  title, body, action, dark = true,
}: {
  title: string; body?: string; action?: ReactNode; dark?: boolean;
}) {
  return (
    <div
      className={`flex flex-col items-center justify-center text-center py-14 px-6 rounded-2xl border border-dashed ${
        dark ? "border-white/10 text-mist" : "border-slate-200 text-smoke"
      }`}
    >
      <Inbox size={26} className="mb-3 opacity-50" strokeWidth={1.5} />
      <p className={`text-sm font-medium ${dark ? "text-chrome" : "text-ink"}`}>{title}</p>
      {body && <p className="text-xs mt-1 max-w-xs opacity-70">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Avatar({ name, url, size = 38, ring = false }: { name: string; url?: string | null; size?: number; ring?: boolean }) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");
  if (url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={url} alt={name} width={size} height={size}
        className={`rounded-full object-cover ${ring ? "ring-2 ring-white/15" : ""}`}
        style={{ width: size, height: size }} />
    );
  }
  return (
    <div
      className={`rounded-full flex items-center justify-center font-medium text-white bg-gradient-to-br from-slate-600 to-slate-800 ${ring ? "ring-2 ring-white/15" : ""}`}
      style={{ width: size, height: size, fontSize: size * 0.34 }}
    >
      {initials}
    </div>
  );
}
