"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import AddInquiry from "@/components/gos/add-inquiry";
import { CalendarCheck, Users, Settings } from "lucide-react";

const NAV = [
  { href: "/os/today", label: "Today", Icon: CalendarCheck },
  { href: "/os/customers", label: "Customers", Icon: Users },
  { href: "/os/settings", label: "Settings", Icon: Settings },
] as const;

function Badge({ n }: { n: number }) {
  return (
    <span className="ml-1 inline-flex min-w-5 items-center justify-center rounded-full bg-[var(--gos-danger)] px-1.5 text-xs font-bold text-white">
      <span aria-hidden="true">{n}</span><span className="sr-only"> overdue</span>
    </span>
  );
}

export default function GosShell({ userName, overdue = 0, children }: { userName: string; overdue?: number; children: ReactNode }) {
  const path = usePathname();
  return (
    <div className="min-h-dvh lg:flex">
      <a href="#gos-main" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:m-2 focus:rounded-lg focus:bg-white focus:p-3 focus:font-bold">Skip to content</a>
      <aside className="hidden lg:sticky lg:top-0 lg:flex lg:h-dvh lg:w-60 lg:shrink-0 lg:flex-col lg:gap-1 lg:border-r lg:border-[var(--gos-line)] lg:p-4" aria-label="Main">
        <p className="mb-4 rounded-xl bg-[var(--gos-accent)] px-3 py-2 font-[family-name:var(--font-gos-head)] text-lg font-bold text-white">Growth OS</p>
        {NAV.map(({ href, label, Icon }) => {
          const active = path.startsWith(href);
          return (
            <Link key={href} href={href} aria-current={active ? "page" : undefined}
              className="gos-tap gos-nav-item flex items-center gap-3 px-3">
              <Icon size={20} aria-hidden="true" /> {label}
                {href === "/os/today" && overdue > 0 && <Badge n={overdue} />}
            </Link>
          );
        })}
        <p className="mt-auto pt-4 text-sm text-[var(--gos-ink-dim)]">Signed in: {userName}</p>
      </aside>
      <main id="gos-main" className="mx-auto w-full max-w-[1440px] flex-1 px-4 pb-28 pt-4 lg:px-8 lg:pb-8">
          <div className="flex justify-end"><AddInquiry /></div>
          {children}
        </main>
      <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-10 grid grid-cols-3 border-t border-[var(--gos-line)] bg-white pb-[env(safe-area-inset-bottom)] lg:hidden">
        {NAV.map(({ href, label, Icon }) => {
          const active = path.startsWith(href);
          return (
            <Link key={href} href={href} aria-current={active ? "page" : undefined}
              className={`gos-tap flex min-h-14 flex-col items-center justify-center gap-0.5 py-2 text-xs ${active ? "border-t-[3px] border-[var(--gos-accent)] font-bold text-[var(--gos-accent)]" : "border-t-[3px] border-transparent font-semibold text-[var(--gos-ink-dim)]"}`}>
              <Icon size={20} aria-hidden="true" />
              <span>{label}{href === "/os/today" && overdue > 0 && <Badge n={overdue} />}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
