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
      <a href="#gos-main" className="sr-only focus:not-sr-only focus:absolute focus:p-2">Skip to content</a>
      <aside className="hidden lg:sticky lg:top-0 lg:flex lg:h-dvh lg:w-60 lg:shrink-0 lg:flex-col lg:gap-1 lg:border-r lg:border-[var(--gos-line)] lg:p-4" aria-label="Main">
        <p className="mb-4 rounded-xl bg-[var(--gos-black)] px-3 py-2 font-bold text-[var(--gos-gold)]">Growth OS</p>
        {NAV.map(({ href, label, Icon }) => {
          const active = path.startsWith(href);
          return (
            <Link key={href} href={href} aria-current={active ? "page" : undefined}
              className={`gos-tap flex items-center gap-3 rounded-xl px-3 ${active ? "bg-[var(--gos-black)] text-white" : "hover:bg-white"}`}>
              <Icon size={20} aria-hidden="true" /> {label}
                {href === "/os/today" && overdue > 0 && <Badge n={overdue} />}
            </Link>
          );
        })}
        <p className="mt-auto text-sm text-[var(--gos-ink-dim)]">Signed in: {userName}</p>
      </aside>
      <main id="gos-main" className="mx-auto w-full max-w-[1440px] flex-1 px-4 pb-24 pt-4 lg:pb-8">
          <div className="flex justify-end"><AddInquiry /></div>
          {children}
        </main>
      <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-10 grid grid-cols-3 border-t border-[var(--gos-line)] bg-white lg:hidden">
        {NAV.map(({ href, label, Icon }) => {
          const active = path.startsWith(href);
          return (
            <Link key={href} href={href} aria-current={active ? "page" : undefined}
              className={`gos-tap flex flex-col items-center justify-center gap-0.5 py-2 text-[11px] ${active ? "font-bold text-[var(--gos-ink)]" : "text-[var(--gos-ink-dim)]"}`}>
              <Icon size={20} aria-hidden="true" />
              <span>{label}{href === "/os/today" && overdue > 0 && <Badge n={overdue} />}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
