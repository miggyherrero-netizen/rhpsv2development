import type { ReactNode } from "react";
import { Atkinson_Hyperlegible, Bricolage_Grotesque } from "next/font/google";
import { requireOwnerPage } from "@/server/gos/guard";
import GosShell from "@/components/gos/shell";
import { replyState } from "@/lib/gos/customers";
import { gosEnvProblems } from "@/lib/gos/env";
import { listWaiting } from "@/server/gos/customers";
import "./gos.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Growth OS" };

const body = Atkinson_Hyperlegible({ subsets: ["latin"], weight: ["400", "700"], variable: "--font-gos-body" });
const head = Bricolage_Grotesque({ subsets: ["latin"], variable: "--font-gos-head" });

export default async function GosLayout({ children }: { children: ReactNode }) {
  const problems = gosEnvProblems(process.env);
  if (problems.length > 0) {
    return (
      <main className={`gos ${body.variable} ${head.variable} flex items-center justify-center p-6`}>
        <div role="alert" className="gos-card max-w-md">
          <h1 className="text-xl font-bold">Growth OS cannot start</h1>
          <ul className="mt-2 list-disc pl-5">{problems.map((p) => <li key={p}>{p}</li>)}</ul>
          <p className="mt-2 text-sm">Set the missing value in Vercel → Environment Variables, then Redeploy.</p>
        </div>
      </main>
    );
  }
  const user = await requireOwnerPage();
  if (user === "forbidden") {
    return (
      <main className={`gos ${body.variable} ${head.variable} flex items-center justify-center p-6`}>
        <div className="gos-card max-w-sm text-center">
          <h1 className="text-xl font-bold">No access (403)</h1>
          <p className="mt-2">This area is for the owner only.</p>
        </div>
      </main>
    );
  }
  let overdue = 0;
  try {
    const waiting = await listWaiting();
    const now = new Date();
    if (waiting.ok) {
      overdue = waiting.value.rows.filter((c) => replyState(c.inquiryAt, waiting.value.noReplyMinutes, now) !== "waiting").length;
    }
  } catch {
    // The badge is optional; the page itself reports the real problem.
  }
  return (
    <div className={`gos ${body.variable} ${head.variable}`}>
      <GosShell userName={user.name} overdue={overdue}>{children}</GosShell>
    </div>
  );
}
