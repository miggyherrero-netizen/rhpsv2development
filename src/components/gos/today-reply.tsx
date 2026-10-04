"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import SendKit from "@/components/gos/send-kit";
import { replyState, type ReplyState } from "@/lib/gos/customers";
import { markReplied } from "@/server/gos/customers";

type Row = { id: string; name: string; area: string | null; inquiryAt: string; dueLabel: string; state: ReplyState; text: string };

export default function TodayReply({ rows }: { rows: Row[] }) {
  const router = useRouter();
  const [showAll, setShowAll] = useState(false);
  const [, tick] = useState(0);

  // R4: recompute when the app comes back to the front, and every 60 s.
  useEffect(() => {
    const t = setInterval(() => { tick((n) => n + 1); router.refresh(); }, 60_000);
    const onVisible = () => { if (document.visibilityState === "visible") { tick((n) => n + 1); router.refresh(); } };
    document.addEventListener("visibilitychange", onVisible);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", onVisible); };
  }, [router]);

  const shown = showAll ? rows : rows.slice(0, 5);
  const now = new Date();
  return (
    <section aria-labelledby="reply-first">
      <h2 id="reply-first" className="mb-2 text-lg font-bold">Reply first ({rows.length})</h2>
      <ul className="space-y-3">
        {shown.map((r) => {
          const s = replyState(new Date(r.inquiryAt), 0, now) === "overdue-day" ? "overdue-day" : r.state;
          return (
            <li key={r.id} className={`gos-card space-y-2 ${s !== "waiting" ? "border-l-4 border-l-[var(--gos-danger)]" : ""}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Link href={`/os/customers/${r.id}`} className="font-bold underline">{r.name}</Link>
                <span className={s !== "waiting" ? "font-bold text-[var(--gos-danger)]" : "text-[var(--gos-ink-dim)]"}>
                  {s === "overdue-day" ? "✕ 1 day, reply now" : s === "overdue" ? "✕ Over 1 hour, reply now" : `Reply by ${r.dueLabel}`}
                </span>
              </div>
              <SendKit text={r.text} onSent={async () => { await markReplied(r.id); router.refresh(); }} />
              <button type="button" className="gos-tap rounded-full border px-4"
                onClick={async () => { await markReplied(r.id); router.refresh(); }}>Mark replied</button>
            </li>
          );
        })}
      </ul>
      {rows.length > 5 && !showAll && <button type="button" className="gos-tap mt-2 underline" onClick={() => setShowAll(true)}>Show all ({rows.length})</button>}
    </section>
  );
}
