"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import {
  LayoutDashboard, Workflow, ListChecks, Boxes, Users, BookImage, Palette,
  Radar, Settings, Menu, X, Globe, Hammer, CalendarDays, Home, LogOut, Piano, TrendingUp,
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
    <nav aria-label="Admin" className="flex-1 px-3 space-y-0.5 overflow-y-auto thin-scroll">
      {NAV.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          onClick={() => setMobileOpen(false)}
          aria-current={isActive(item.href) ? "page" : undefined}
          className={`flex items-center gap-3 px-3.5 min-h-11 rounded-[10px] text-sm transition-colors duration-150 ${
            isActive(item.href)
              ? "bg-[#22C55E]/12 text-white border border-[#22C55E]/35 font-medium"
              : "text-mist hover:text-white hover:bg-white/[0.06] border border-transparent"
          }`}
        >
          <item.icon size={18} strokeWidth={1.8} aria-hidden="true" className={isActive(item.href) ? "text-[#22C55E]" : ""} />
          {item.label}
        </Link>
      ))}
      <div className="pt-5 pb-2 px-3.5 text-xs uppercase tracking-[0.14em] text-subtle">Beyond the shop</div>
      {[
        { href: "/service/today", label: "Home Service", icon: Home },
        { href: "/owner/today", label: "My Desk", icon: CalendarDays },
        { href: "/os/today", label: "Growth OS", icon: TrendingUp },
        { href: "/workshop", label: "Workshop Kiosk", icon: Hammer },
        { href: "/", label: "Public Website", icon: Globe },
      ].map((item) => (
        <Link key={item.href} href={item.href}
          className="flex items-center gap-3 px-3.5 min-h-11 rounded-[10px] text-sm text-mist hover:text-white hover:bg-white/[0.06] transition-colors duration-150">
          <item.icon size={18} strokeWidth={1.8} aria-hidden="true" /> {item.label}
        </Link>
      ))}
    </nav>
  );

  return (
    <div className="adm-shell min-h-screen bg-coal text-chrome">
      {/* sidebar desktop */}
      <aside aria-label="Admin sidebar" className="hidden lg:flex fixed inset-y-0 left-0 w-60 flex-col border-r border-slate-700/70 bg-panel z-40">
        <div className="px-5 pt-6 pb-5">
          <Link href="/admin">
            <p className="font-serif text-lg text-white tracking-[0.14em] leading-none">HERRERO</p>
            <p className="text-xs uppercase tracking-[0.2em] text-[#22C55E] mt-1.5">Shop</p>
          </Link>
        </div>
        {navList}
        <div className="p-4 border-t border-slate-700/70">
          <p className="px-1.5 text-sm text-white truncate">{userName}</p>
          <p className="px-1.5 text-xs text-subtle mb-2">Owner · Herrero Pianos Davao</p>
          <button onClick={() => logout()} className="flex items-center gap-2.5 px-2 min-h-11 -ml-0.5 rounded-[10px] text-sm text-mist hover:text-white hover:bg-white/[0.06] transition-colors duration-150">
            <LogOut size={16} aria-hidden="true" /> Sign out
          </button>
        </div>
      </aside>

      {/* mobile top bar */}
      <header className="lg:hidden sticky top-0 z-40 glass-top pt-[env(safe-area-inset-top)]">
        <div className="flex items-center justify-between px-4 h-14">
          <Link href="/admin" className="font-serif text-base text-white tracking-[0.14em] min-h-11 flex items-center">HERRERO</Link>
          <button onClick={() => setMobileOpen(true)} className="h-11 w-11 -mr-2 flex items-center justify-center rounded-[10px] text-chrome hover:bg-white/[0.06]" aria-label="Open menu" aria-expanded={mobileOpen}><Menu size={22} aria-hidden="true" /></button>
        </div>
      </header>
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm anim-fade-in" onClick={() => setMobileOpen(false)} />
          <div className="absolute left-0 top-0 h-full w-72 bg-panel border-r border-slate-700/70 flex flex-col p-4 anim-drawer" style={{ animationName: "drawerIn", transform: "none" }}>
            <div className="flex items-center justify-between px-2 pt-2 pb-4">
              <p className="font-serif text-lg text-white">HERRERO</p>
              <button onClick={() => setMobileOpen(false)} className="h-11 w-11 flex items-center justify-center rounded-[10px] text-chrome hover:bg-white/[0.06]" aria-label="Close menu"><X size={20} aria-hidden="true" /></button>
            </div>
            {navList}
            <div className="p-3 border-t border-slate-700/70 mt-2">
              <button onClick={() => logout()} className="flex items-center gap-2.5 min-h-11 text-sm text-mist hover:text-white transition-colors">
                <LogOut size={16} aria-hidden="true" /> Sign out
              </button>
            </div>
          </div>
        </div>
      )}

      <main id="main" className="lg:pl-60 min-h-screen">{children}</main>
    </div>
  );
}
