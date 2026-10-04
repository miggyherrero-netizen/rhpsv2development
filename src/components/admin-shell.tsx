"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import {
  LayoutDashboard, Workflow, ListChecks, Boxes, Users, BookImage, Palette,
  Radar, Settings, Menu, X, Globe, Hammer, CalendarDays, Home, LogOut, Piano,
} from "lucide-react";
import { logout } from "@/server/auth-actions";

const NAV = [
  { href: "/admin", label: "Dashboard", icon: LayoutDashboard },
  { href: "/admin/projects", label: "Projects", icon: Workflow },
  { href: "/admin/tasks", label: "Tasks", icon: ListChecks },
  { href: "/admin/inventory", label: "Inventory", icon: Boxes },
  { href: "/admin/showroom", label: "Showroom", icon: Piano },
  { href: "/admin/workers", label: "Workers", icon: Users },
  { href: "/admin/website", label: "Website", icon: Palette },
  { href: "/admin/curator", label: "Client Curator", icon: BookImage },
  { href: "/admin/monitor", label: "Live Monitor", icon: Radar },
  { href: "/admin/settings", label: "Settings", icon: Settings },
];

export default function AdminShell({ children, userName }: { children: ReactNode; userName: string }) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  const isActive = (href: string) => (href === "/admin" ? pathname === "/admin" : pathname.startsWith(href));

  const navList = (
    <nav className="flex-1 px-3 space-y-1 overflow-y-auto thin-scroll">
      {NAV.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          onClick={() => setMobileOpen(false)}
          className={`flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-[13px] transition-colors ${
            isActive(item.href)
              ? "bg-white/[0.09] text-white border border-white/[0.08]"
              : "text-mist hover:text-white hover:bg-white/[0.045] border border-transparent"
          }`}
        >
          <item.icon size={16} strokeWidth={1.8} />
          {item.label}
        </Link>
      ))}
      <div className="pt-5 pb-2 px-3.5 text-[10.5px] uppercase tracking-[0.18em] text-subtle">Beyond the shop</div>
      {[
        { href: "/service/today", label: "Home Service", icon: Home },
        { href: "/owner/today", label: "Personal Workspace", icon: CalendarDays },
        { href: "/workshop", label: "Workshop Kiosk", icon: Hammer },
        { href: "/", label: "Public Website", icon: Globe },
      ].map((item) => (
        <Link key={item.href} href={item.href}
          className="flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-[13px] text-mist hover:text-white hover:bg-white/[0.045] transition-colors">
          <item.icon size={16} strokeWidth={1.8} /> {item.label}
        </Link>
      ))}
    </nav>
  );

  return (
    <div className="min-h-screen bg-coal text-chrome">
      {/* sidebar desktop */}
      <aside className="hidden lg:flex fixed inset-y-0 left-0 w-60 flex-col border-r border-white/[0.07] bg-[#0b0e13] z-40">
        <div className="px-5 pt-6 pb-5">
          <Link href="/admin">
            <p className="font-serif text-lg text-white tracking-wide leading-none">HERRERO</p>
            <p className="text-[10px] uppercase tracking-[0.24em] text-subtle mt-1.5">Command Center</p>
          </Link>
        </div>
        {navList}
        <div className="p-4 border-t border-white/[0.07]">
          <p className="px-1.5 text-[12px] text-white truncate">{userName}</p>
          <p className="px-1.5 text-[11px] text-subtle mb-2.5">Owner · Herrero Pianos Davao</p>
          <button onClick={() => logout()} className="flex items-center gap-2.5 px-1.5 text-[12px] text-mist hover:text-white transition-colors">
            <LogOut size={14} /> Sign out
          </button>
        </div>
      </aside>

      {/* mobile top bar */}
      <div className="lg:hidden sticky top-0 z-40 glass-top">
        <div className="flex items-center justify-between px-4 h-14">
          <Link href="/admin" className="font-serif text-base text-white">HERRERO</Link>
          <button onClick={() => setMobileOpen(true)} className="p-2.5 text-chrome" aria-label="Open menu" aria-expanded={mobileOpen}><Menu size={20} /></button>
        </div>
      </div>
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm anim-fade-in" onClick={() => setMobileOpen(false)} />
          <div className="absolute left-0 top-0 h-full w-72 bg-[#0b0e13] border-r border-white/10 flex flex-col p-4 anim-drawer" style={{ animationName: "drawerIn", transform: "none" }}>
            <div className="flex items-center justify-between px-2 pt-2 pb-4">
              <p className="font-serif text-lg text-white">HERRERO</p>
              <button onClick={() => setMobileOpen(false)} className="p-2.5 text-chrome" aria-label="Close menu"><X size={18} /></button>
            </div>
            {navList}
            <div className="p-3 border-t border-white/[0.07] mt-2">
              <button onClick={() => logout()} className="flex items-center gap-2.5 text-[12px] text-mist hover:text-white transition-colors">
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
