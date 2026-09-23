"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import {
  Sun, CalendarDays, ClipboardList, Timer, Receipt, Wallet, LineChart, Users,
  Settings, Menu, X, LayoutDashboard, Calendar, LogOut, Home,
} from "lucide-react";
import { logout } from "@/server/auth-actions";

const GROUPS: { label: string; items: { href: string; label: string; icon: typeof Sun }[] }[] = [
  {
    label: "Operations",
    items: [
      { href: "/service/today", label: "Today", icon: Sun },
      { href: "/service/schedule", label: "Schedule", icon: CalendarDays },
      { href: "/service/jobs", label: "Jobs", icon: ClipboardList },
      { href: "/service/time", label: "Time", icon: Timer },
    ],
  },
  {
    label: "Money",
    items: [
      { href: "/service/invoices", label: "Invoices", icon: Receipt },
      { href: "/service/expenses", label: "Expenses", icon: Wallet },
      { href: "/service/finance", label: "Finance", icon: LineChart },
    ],
  },
  {
    label: "People & places",
    items: [{ href: "/service/customers", label: "Customers", icon: Users }],
  },
  {
    label: "Setup",
    items: [{ href: "/service/settings", label: "Settings", icon: Settings }],
  },
];

export default function ServiceShell({
  children,
  businessName,
}: {
  children: ReactNode;
  businessName: string;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  const nav = (
    <nav className="flex-1 px-3 py-2 space-y-5 overflow-y-auto thin-scroll">
      {GROUPS.map((group) => (
        <div key={group.label}>
          <p
            className="px-3.5 pb-1.5 text-[9.5px] uppercase tracking-[0.24em]"
            style={{ color: "var(--color-svc-text-faint)" }}
          >
            {group.label}
          </p>
          <div className="space-y-0.5">
            {group.items.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                className="flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-[13px] transition-colors"
                style={
                  isActive(item.href)
                    ? { background: "var(--color-svc-accent-soft)", color: "var(--color-svc-accent)" }
                    : { color: "var(--color-svc-text-dim)" }
                }
              >
                <item.icon size={16} strokeWidth={1.8} />
                {item.label}
              </Link>
            ))}
          </div>
        </div>
      ))}

      <div>
        <p
          className="px-3.5 pb-1.5 text-[9.5px] uppercase tracking-[0.24em]"
          style={{ color: "var(--color-svc-text-faint)" }}
        >
          The atelier
        </p>
        <div className="space-y-0.5">
          <Link
            href="/admin"
            className="flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-[13px] transition-colors hover:bg-white/[0.05]"
            style={{ color: "var(--color-svc-text-dim)" }}
          >
            <LayoutDashboard size={16} strokeWidth={1.8} /> Piano Management
          </Link>
          <Link
            href="/owner/today"
            className="flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-[13px] transition-colors hover:bg-white/[0.05]"
            style={{ color: "var(--color-svc-text-dim)" }}
          >
            <Calendar size={16} strokeWidth={1.8} /> Personal Workspace
          </Link>
        </div>
      </div>
    </nav>
  );

  return (
    <div className="min-h-screen svc-shell">
      <aside data-print-hide className="hidden lg:flex fixed inset-y-0 left-0 w-60 flex-col svc-sidebar border-r z-40">
        <div className="px-5 pt-6 pb-5">
          <p
            className="text-[9px] uppercase tracking-[0.32em]"
            style={{ color: "var(--color-svc-text-faint)" }}
          >
            Home Service
          </p>
          <p className="font-serif text-xl mt-1.5" style={{ color: "var(--color-svc-text)" }}>
            {businessName}
          </p>
        </div>
        {nav}
        <div className="p-4 border-t" style={{ borderColor: "var(--color-svc-border)" }}>
          <button
            onClick={() => logout()}
            className="flex items-center gap-2.5 px-1.5 text-[12px] transition-colors hover:opacity-80"
            style={{ color: "var(--color-svc-text-dim)" }}
          >
            <LogOut size={14} /> Sign out
          </button>
        </div>
      </aside>

      <div
        data-print-hide
        className="lg:hidden sticky top-0 z-40 svc-sidebar border-b"
        style={{ borderColor: "var(--color-svc-border)" }}
      >
        <div className="flex items-center justify-between px-4 h-14">
          <span className="flex items-center gap-2 font-serif text-base" style={{ color: "var(--color-svc-text)" }}>
            <Home size={16} strokeWidth={1.8} /> Home Service
          </span>
          <button
            onClick={() => setOpen(true)}
            className="p-2"
            style={{ color: "var(--color-svc-text-dim)" }}
            aria-label="Open menu"
          >
            <Menu size={20} />
          </button>
        </div>
      </div>

      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm anim-fade-in" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-0 h-full w-72 svc-sidebar flex flex-col p-4 anim-drawer">
            <div className="flex items-center justify-between px-2 pt-2 pb-4">
              <p className="font-serif text-lg" style={{ color: "var(--color-svc-text)" }}>
                Home Service
              </p>
              <button onClick={() => setOpen(false)} className="p-2" style={{ color: "var(--color-svc-text-dim)" }}>
                <X size={18} />
              </button>
            </div>
            {nav}
            <div className="p-3 border-t mt-2" style={{ borderColor: "var(--color-svc-border)" }}>
              <button
                onClick={() => logout()}
                className="flex items-center gap-2.5 text-[12px]"
                style={{ color: "var(--color-svc-text-dim)" }}
              >
                <LogOut size={14} /> Sign out
              </button>
            </div>
          </div>
        </div>
      )}

      <main className="lg:pl-60 min-h-screen">{children}</main>
    </div>
  );
}
