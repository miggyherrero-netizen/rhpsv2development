import Link from "next/link";
import { Hammer, Home, LayoutDashboard, CalendarDays, TrendingUp } from "lucide-react";
import { requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "Where to? · Herrero Pianos" };

const CHOICES = [
  { href: "/admin", title: "Shop", text: "Projects, tasks, workers, inventory, payroll", icon: LayoutDashboard },
  { href: "/service/today", title: "Home Service", text: "In-home visits, schedule, invoices, time", icon: Home },
  { href: "/owner/today", title: "My Desk", text: "My own calendar, tasks and inbox", icon: CalendarDays },
  { href: "/os/today", title: "Growth OS", text: "Customers and inquiries to follow up", icon: TrendingUp },
] as const;

export default async function StartPage() {
  const user = await requireUser();
  return (
    <main id="main" className="adm-shell min-h-screen bg-coal text-chrome px-4 py-12 sm:py-20">
      <div className="mx-auto max-w-3xl">
        <p className="text-xs uppercase tracking-[0.24em] text-[#22C55E]">Herrero Pianos</p>
        <h1 className="font-serif text-3xl sm:text-4xl text-white mt-2">Hi {user.name.split(" ")[0]}, where to?</h1>
        <div className="mt-8 grid gap-3 sm:grid-cols-2">
          {CHOICES.map(({ href, title, text, icon: Icon }) => (
            <Link key={href} href={href}
              className="group rounded-[14px] border border-slate-700 bg-panel p-6 min-h-32 transition duration-200 hover:border-[#22C55E]/60 hover:bg-deepslate/60 cursor-pointer">
              <span className="flex h-11 w-11 items-center justify-center rounded-[10px] bg-deepslate text-[#22C55E] transition-colors group-hover:bg-[#22C55E]/15">
                <Icon size={22} strokeWidth={1.7} aria-hidden="true" />
              </span>
              <p className="mt-4 text-lg font-semibold text-white">{title}</p>
              <p className="mt-1 text-sm text-mist">{text}</p>
            </Link>
          ))}
        </div>
        <p className="mt-6 text-sm text-subtle">
          <Link href="/workshop" className="hover:text-white inline-flex items-center gap-1.5 min-h-11"><Hammer size={16} aria-hidden="true" /> Workshop kiosk</Link>
          <span className="mx-2">·</span>
          <Link href="/" className="hover:text-white inline-flex items-center min-h-11">Public website</Link>
        </p>
      </div>
    </main>
  );
}
