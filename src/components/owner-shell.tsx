"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import {
  Sun, Calendar, ListChecks, Inbox, AlarmClock, CalendarRange, Settings,
  Menu, X, LayoutDashboard, Home, LogOut, Landmark,
} from "lucide-react";
import { logout } from "@/server/auth-actions";

const NAV = [
  { href: "/owner/today", label: "Today", icon: Sun },
  { href: "/owner/calendar", label: "Calendar", icon: Calendar },
  { href: "/owner/tasks", label: "Tasks", icon: ListChecks },
  { href: "/owner/inbox", label: "Inbox", icon: Inbox },
  { href: "/owner/overdue", label: "Overdue", icon: AlarmClock },
  { href: "/owner/upcoming", label: "Upcoming", icon: CalendarRange },
  { href: "/owner/settings", label: "Settings", icon: Settings },
];

export default function OwnerShell({ children, userName }: { children: ReactNode; userName: string }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const isActive = (href: string) => pathname.startsWith(href);

  const nav = (
    <nav className="flex-1 px-3 space-y-0.5 overflow-y-auto thin-scroll">
      {NAV.map((item) => (
        <Link key={item.href} href={item.href} onClick={() => setOpen(false)}
          className={`flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-[13px] transition-colors ${
            isActive(item.href)
              ? "text-[var(--color-ow-accent)]"
              : "text-[var(--color-ow-text-dim)] hover:text-[var(--color-ow-text)] hover:bg-white/[0.05]"
          }`}
          style={isActive(item.href) ? { background: "var(--color-ow-accent-soft)" } : undefined}
        >
          <item.icon size={16} strokeWidth={1.8} /> {item.label}
        </Link>
      ))}
      <div className="pt-5 pb-1.5 px-3.5 text-[9.5px] uppercase tracking-[0.26em] text-[var(--color-ow-text-faint)]">The atelier</div>
      <Link href="/service/today" className="flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-[13px] text-[var(--color-ow-text-dim)] hover:text-[var(--color-ow-text)] hover:bg-white/[0.05] transition-colors">
        <Home size={16} strokeWidth={1.8} /> Home Service
      </Link>
      <Link href="/admin" className="flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-[13px] text-[var(--color-ow-text-dim)] hover:text-[var(--color-ow-text)] hover:bg-white/[0.05] transition-colors">
        <LayoutDashboard size={16} strokeWidth={1.8} /> Piano Management
      </Link>
      <Link href="/admin/accounting" className="flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-[13px] text-[var(--color-ow-text-dim)] hover:text-[var(--color-ow-text)] hover:bg-white/[0.05] transition-colors">
        <Landmark size={16} strokeWidth={1.8} /> Accounting
      </Link>
    </nav>
  );

  return (
    <div className="min-h-screen ow-shell">
      <aside className="hidden lg:flex fixed inset-y-0 left-0 w-60 flex-col ow-sidebar border-r z-40">
        <div className="px-5 pt-6 pb-5">
          <p className="text-[9px] uppercase tracking-[0.34em] text-[var(--color-ow-text-faint)]">Personal Workspace</p>
          <p className="font-serif text-xl mt-1.5 text-[var(--color-ow-text)]">{userName.split(" ")[0]}&apos;s Desk</p>
        </div>
        {nav}
        <div className="p-4 border-t" style={{ borderColor: "var(--color-ow-border)" }}>
          <button onClick={() => logout()} className="flex items-center gap-2.5 px-1.5 text-[12px] text-[var(--color-ow-text-dim)] hover:text-[var(--color-ow-text)] transition-colors">
            <LogOut size={14} /> Sign out
          </button>
        </div>
      </aside>

      <div className="lg:hidden sticky top-0 z-40 ow-sidebar border-b" style={{ borderColor: "var(--color-ow-border)" }}>
        <div className="flex items-center justify-between px-4 h-14">
          <p className="font-serif text-base text-[var(--color-ow-text)]">My Desk</p>
          <button onClick={() => setOpen(true)} className="p-2 text-[var(--color-ow-text-dim)]" aria-label="Open menu"><Menu size={20} /></button>
        </div>
      </div>
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm anim-fade-in" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-0 h-full w-72 ow-sidebar flex flex-col p-4 anim-drawer" style={{ transform: "none" }}>
            <div className="flex items-center justify-between px-2 pt-2 pb-4">
              <p className="font-serif text-lg text-[var(--color-ow-text)]">My Desk</p>
              <button onClick={() => setOpen(false)} className="p-2 text-[var(--color-ow-text-dim)]"><X size={18} /></button>
            </div>
            {nav}
            <div className="p-3 border-t mt-2" style={{ borderColor: "var(--color-ow-border)" }}>
              <button onClick={() => logout()} className="flex items-center gap-2.5 text-[12px] text-[var(--color-ow-text-dim)]"><LogOut size={14} /> Sign out</button>
            </div>
          </div>
        </div>
      )}

      <main className="lg:pl-60 min-h-screen">{children}</main>
    </div>
  );
}
