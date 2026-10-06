"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Sun, CalendarDays, ClipboardList, Timer, Receipt, Wallet, LineChart, Users,
  Settings, Menu, X, LayoutDashboard, Calendar, LogOut, Home, Ellipsis, ListChecks, Bell, TrendingUp,
} from "lucide-react";
import { logout } from "@/server/auth-actions";

const GROUPS: { label: string; collapsible?: boolean; items: { href: string; label: string; icon: typeof Sun }[] }[] = [
  {
    label: "Daily",
    items: [
      { href: "/service/today", label: "Today", icon: Sun },
      { href: "/service/reminders", label: "Reminders", icon: Bell },
      { href: "/service/schedule", label: "Schedule", icon: CalendarDays },
      { href: "/service/jobs", label: "Jobs", icon: ClipboardList },
      { href: "/service/invoices", label: "Invoices", icon: Receipt },
      { href: "/service/customers", label: "Customers", icon: Users },
    ],
  },
  {
    // Collapsed by default on desktop (opens itself when one of its pages is active).
    label: "More",
    collapsible: true,
    items: [
      { href: "/service/waitlist", label: "Waitlist", icon: ListChecks },
      { href: "/service/time", label: "Time", icon: Timer },
      { href: "/service/expenses", label: "Expenses", icon: Wallet },
      { href: "/service/finance", label: "Finance", icon: LineChart },
      { href: "/service/settings", label: "Settings", icon: Settings },
    ],
  },
];

/** The tabs on a phone. "More" opens the full menu (Reminders, Customers, Waitlist, Time, Expenses, Finance, Settings…). */
const TABS = [
  { href: "/service/today", label: "Today", icon: Sun },
  { href: "/service/schedule", label: "Schedule", icon: CalendarDays },
  { href: "/service/jobs", label: "Jobs", icon: ClipboardList },
  { href: "/service/invoices", label: "Invoices", icon: Receipt },
] as const;

const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--color-svc-accent)]";

export default function ServiceShell({
  children,
  businessName,
  showFinance = true,
  canFinance = true,
  dueReminders = 0,
}: {
  /** Role check (server-enforced separately): non-finance roles never see Finance or Expenses. */
  canFinance?: boolean;
  children: ReactNode;
  businessName: string;
  /** Open reminders due today or earlier (badge on the Reminders link). */
  dueReminders?: number;
  /** Owner setting: hides the Finance link only — the route itself is not blocked. */
  showFinance?: boolean;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  // Drawer behaves like a dialog: focus moves in, Escape closes, focus returns to "More".
  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); moreRef.current?.focus(); } };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [open]);
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  const hidden = new Set<string>([
    ...(showFinance ? [] : ["/service/finance"]),
    ...(canFinance ? [] : ["/service/finance", "/service/expenses"]),
  ]);
  const groups = GROUPS.map((g) => ({ ...g, items: g.items.filter((i) => !hidden.has(i.href)) }));

  const onTab = TABS.some((t) => isActive(t.href));
  const nav = (
    <nav aria-label="Home Service sections" className="flex-1 px-3 py-2 space-y-5 overflow-y-auto thin-scroll">
      {groups.filter((g) => g.items.length > 0).map((group) => {
        const items = (
          <div className="space-y-0.5">
            {group.items.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                aria-current={isActive(item.href) ? "page" : undefined}
                className={`flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-[13px] transition-colors ${FOCUS}`}
                style={
                  isActive(item.href)
                    ? { background: "var(--color-svc-accent-soft)", color: "var(--color-svc-accent)" }
                    : { color: "var(--color-svc-text-dim)" }
                }
              >
                <item.icon size={16} strokeWidth={1.8} />
                {item.label}
                {item.href === "/service/reminders" && dueReminders > 0 ? (
                  <span
                    className="ml-auto min-w-5 h-5 px-1.5 rounded-full text-[11px] leading-5 text-center svc-num"
                    style={{ background: "var(--color-svc-accent)", color: "#06101f" }}
                  >
                    {dueReminders}<span className="sr-only"> due</span>
                  </span>
                ) : null}
              </Link>
            ))}
          </div>
        );
        return group.collapsible ? (
          <details key={group.label} open={group.items.some((i) => isActive(i.href))}>
            <summary
              className="px-3.5 pb-1.5 text-[11px] uppercase tracking-[0.14em] cursor-pointer select-none"
              style={{ color: "var(--color-svc-text-faint)" }}
            >
              {group.label}
            </summary>
{items}
          </details>
        ) : (
          <div key={group.label}>
            <p
              className="px-3.5 pb-1.5 text-[11px] uppercase tracking-[0.14em]"
              style={{ color: "var(--color-svc-text-faint)" }}
            >
              {group.label}
            </p>
{items}
          </div>
        );
      })}

      <div>
        <p
          className="px-3.5 pb-1.5 text-[11px] uppercase tracking-[0.14em]"
          style={{ color: "var(--color-svc-text-faint)" }}
        >
          The atelier
        </p>
        <div className="space-y-0.5">
          <Link
            href="/admin"
            className={`flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-[13px] transition-colors hover:bg-white/[0.05] ${FOCUS}`}
            style={{ color: "var(--color-svc-text-dim)" }}
          >
            <LayoutDashboard size={16} strokeWidth={1.8} /> Shop
          </Link>
          <Link
            href="/owner/today"
            className={`flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-[13px] transition-colors hover:bg-white/[0.05] ${FOCUS}`}
            style={{ color: "var(--color-svc-text-dim)" }}
          >
            <Calendar size={16} strokeWidth={1.8} /> My Desk
          </Link>
          <Link
            href="/os/today"
            className={`flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-[13px] transition-colors hover:bg-white/[0.05] ${FOCUS}`}
            style={{ color: "var(--color-svc-text-dim)" }}
          >
            <TrendingUp size={16} strokeWidth={1.8} /> Growth OS
          </Link>
        </div>
      </div>
    </nav>
  );

  return (
    <div className="min-h-screen svc-shell">
      <aside data-print-hide className="hidden md:flex fixed inset-y-0 left-0 w-60 flex-col svc-sidebar border-r z-40">
        <div className="px-5 pt-6 pb-5">
          <p
            className="text-[11px] uppercase tracking-[0.2em]"
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
            className={`flex items-center gap-2.5 px-3 min-h-11 w-full rounded-lg text-[12px] transition-colors hover:opacity-80 ${FOCUS}`}
            style={{ color: "var(--color-svc-text-dim)" }}
          >
            <LogOut size={14} /> Sign out
          </button>
        </div>
      </aside>

      <div
        data-print-hide
        className="md:hidden sticky top-0 z-40 svc-sidebar border-b"
        style={{ borderColor: "var(--color-svc-border)" }}
      >
        <div className="flex items-center justify-between px-4 h-14">
          <span className="flex items-center gap-2 font-serif text-base" style={{ color: "var(--color-svc-text)" }}>
            <Home size={16} strokeWidth={1.8} /> Home Service
          </span>
          <button
            onClick={() => setOpen(true)}
            className={`p-3 ${FOCUS}`}
            style={{ color: "var(--color-svc-text-dim)" }}
            aria-label="Open menu"
            aria-expanded={open}
            aria-controls="svc-drawer"
            aria-haspopup="dialog"
          >
            <Menu size={20} />
          </button>
        </div>
      </div>

      {open && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm anim-fade-in" onClick={() => setOpen(false)} />
          <div id="svc-drawer" role="dialog" aria-modal="true" aria-label="Menu" className="absolute left-0 top-0 h-full w-72 svc-sidebar flex flex-col p-4 anim-drawer">
            <div className="flex items-center justify-between px-2 pt-2 pb-4">
              <p className="font-serif text-lg" style={{ color: "var(--color-svc-text)" }}>
                Home Service
              </p>
              <button ref={closeRef} onClick={() => { setOpen(false); moreRef.current?.focus(); }} aria-label="Close menu" className={`p-2.5 ${FOCUS}`} style={{ color: "var(--color-svc-text-dim)" }}>
                <X size={18} />
              </button>
            </div>
            {nav}
            <div className="p-3 border-t mt-2" style={{ borderColor: "var(--color-svc-border)" }}>
              <button
                onClick={() => logout()}
                className={`flex items-center gap-2.5 px-3 min-h-11 text-[12px] ${FOCUS}`}
                style={{ color: "var(--color-svc-text-dim)" }}
              >
                <LogOut size={14} /> Sign out
              </button>
            </div>
          </div>
        </div>
      )}

      <main className="md:pl-60 min-h-screen pb-20 md:pb-0">{children}</main>

      {/* Phone: persistent bottom tab bar (the sidebar takes over from 768px) */}
      <nav
        data-print-hide
        aria-label="Main tabs"
        className="md:hidden fixed bottom-0 inset-x-0 z-40 svc-sidebar border-t grid grid-cols-5"
        style={{ borderColor: "var(--color-svc-border)", paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {TABS.map((t) => {
          const active = isActive(t.href);
          return (
            <Link
              key={t.href}
              href={t.href}
              aria-current={active ? "page" : undefined}
              className={`flex flex-col items-center justify-center gap-1 min-h-14 text-[11px] ${FOCUS}`}
              style={{ color: active ? "var(--color-svc-accent)" : "var(--color-svc-text-dim)" }}
            >
              <t.icon size={19} strokeWidth={active ? 2.2 : 1.8} />
              {t.label}
            </Link>
          );
        })}
        <button
          ref={moreRef}
          type="button"
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls="svc-drawer"
          aria-current={!onTab ? "page" : undefined}
          className={`flex flex-col items-center justify-center gap-1 min-h-14 text-[11px] ${FOCUS}`}
          style={{ color: !onTab ? "var(--color-svc-accent)" : "var(--color-svc-text-dim)" }}
        >
          <Ellipsis size={19} strokeWidth={1.8} />
          More
        </button>
      </nav>
    </div>
  );
}
