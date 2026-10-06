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
    <main className="min-h-screen bg-coal text-chrome px-4 py-12">
      <div className="mx-auto max-w-3xl">
        <p className="text-[11px] uppercase tracking-[0.24em] text-subtle">Herrero Pianos</p>
        <h1 className="font-serif text-3xl text-white mt-2">Hi {user.name.split(" ")[0]}, where to?</h1>
        <div className="mt-8 grid gap-3 sm:grid-cols-2">
          {CHOICES.map(({ href, title, text, icon: Icon }) => (
            <Link key={href} href={href}
              className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-5 transition-colors hover:bg-white/[0.07] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">
              <Icon size={22} strokeWidth={1.6} className="text-white" aria-hidden="true" />
              <p className="mt-3 text-lg text-white">{title}</p>
              <p className="mt-1 text-[13px] text-mist">{text}</p>
            </Link>
          ))}
        </div>
        <p className="mt-6 text-[13px] text-subtle">
          <Link href="/workshop" className="hover:text-white inline-flex items-center gap-1.5"><Hammer size={13} aria-hidden="true" /> Workshop kiosk</Link>
          <span className="mx-2">·</span>
          <Link href="/" className="hover:text-white">Public website</Link>
        </p>
      </div>
    </main>
  );
}
