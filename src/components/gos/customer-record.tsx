"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import SendKit from "@/components/gos/send-kit";
import { customerStatusLabel, type CustomerStatus } from "@/lib/gos/customers";
import {
  deleteCustomer, logSent, markLost, markNotDuplicate, markReplied, mergeCustomers, reopenCustomer,
  searchCustomers, undoActivity, undoReplied, type CustomerRow,
} from "@/server/gos/customers";

type Customer = Omit<CustomerRow, "inquiryAt" | "updatedAt" | "createdAt" | "repliedAt"> & { inquiryAt: string };
type Act = { id: string; kind: string; text: string; when: string; undoable: boolean };

export default function CustomerRecord(props: {
  customer: Customer; activity: Act[]; adName: string | null; replyText: string; lostReasons: string[]; toast: string | null;
}) {
  const { customer: c, activity, lostReasons } = props;
  const router = useRouter();
  const status = c.status as CustomerStatus;
  const [toast, setToast] = useState<{ text: string; undoId?: string } | null>(props.toast ? { text: props.toast } : null);
  const [showLost, setShowLost] = useState(false);
  const [error, setError] = useState("");
  const [showAll, setShowAll] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!toast) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), toast.undoId ? 10_000 : 5_000);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [toast]);

  async function run(fn: () => Promise<{ ok: boolean; error?: string; value?: unknown }>, msg: string, withUndo = false) {
    setError("");
    const r = await fn();
    if (!r.ok) { setError(r.error ?? "Couldn't save."); return; }
    const undoId = withUndo ? (r.value as { activityId: string } | undefined)?.activityId : undefined;
    setToast({ text: msg, undoId });
    router.refresh();
  }

  async function onMerge() {
    const hits = await searchCustomers(c.name);
    const other = hits.ok ? hits.value.find((x) => x.id !== c.id) : undefined;
    if (!other) { setError("No other customer to merge with."); return; }
    if (!window.confirm(`Keep the older record and join everything from "${other.name}" into it?`)) return;
    const r = await mergeCustomers(c.id, other.id);
    if (!r.ok) { setError(r.error); return; }
    router.push(`/os/customers/${r.value.keepId}`);
  }

  const shown = showAll ? activity : activity.slice(0, 20);
  const isNew = status === "New";

  return (
    <div className="mt-2 space-y-4">
      <Link href="/os/customers" className="gos-tap inline-flex items-center text-sm underline">← Customers</Link>
      <header className="gos-card">
        <h1 className="text-2xl font-bold">{c.name}</h1>
        <p className="mt-1">{customerStatusLabel(status)}{c.area ? ` · ${c.area}` : ""}</p>
        <p className="text-sm text-[var(--gos-ink-dim)]">Came from: {c.cameFrom}{props.adName ? ` · ${props.adName}` : ""}</p>
        {c.phone && <a className="gos-tap mt-1 inline-flex items-center underline" href={`tel:${c.phone.replace(/[^0-9+]/g, "")}`}>{c.phone}</a>}
        <div className="mt-2 flex flex-wrap gap-2 text-sm">
          {c.cameFrom === "Messenger" && c.adKind === "unknown" && <span className="rounded border px-1">No ad tag</span>}
          {c.possibleDuplicate && (
            <>
              <span className="rounded border border-[var(--gos-danger)] px-1">⚠ Possible duplicate</span>
              <button type="button" className="underline" onClick={onMerge}>Merge</button>
              <button type="button" className="underline" onClick={() => run(() => markNotDuplicate(c.id), "Marked: not the same.")}>Not the same</button>
            </>
          )}
        </div>
        {c.note && <p className="mt-2 whitespace-pre-wrap">{c.note}</p>}
      </header>

      {status !== "Lost" ? (
        <section className="gos-card space-y-3" aria-label="Next step">
          <h2 className="text-lg font-bold">Next step</h2>
          {isNew ? (
            <>
              <SendKit text={props.replyText} onSent={() => run(() => markReplied(c.id), "Replied ✓", true).then(() => undefined)} />
              <button type="button" className="gos-tap rounded-full border px-4" onClick={() => run(() => markReplied(c.id), "Replied ✓", true)}>Mark replied</button>
            </>
          ) : (
            <>
              <SendKit text={props.replyText} copyLabel="Copy message" sentLabel="Yes, sent" onSent={() => run(() => logSent(c.id, "Message"), "Logged ✓")} />
              {status === "Replied" && (
                <button type="button" className="gos-tap rounded-full border px-4" onClick={() => run(() => undoReplied(c.id), "Back to New.")}>Undo replied</button>
              )}
            </>
          )}
          <button type="button" className="gos-tap rounded-full border border-[var(--gos-danger)] px-4 text-[var(--gos-danger)]" onClick={() => setShowLost((v) => !v)}>Lost</button>
          {showLost && (
            <div role="group" aria-label="Lost reason" className="flex flex-wrap gap-2">
              {lostReasons.map((r) => (
                <button key={r} type="button" className="gos-tap rounded-full border bg-white px-4"
                  onClick={() => { setShowLost(false); void run(() => markLost(c.id, r), `Marked Lost: ${r}`, true); }}>{r}</button>
              ))}
            </div>
          )}
        </section>
      ) : (
        <section className="gos-card space-y-2" aria-label="Next step">
          <p>✕ Lost{c.lostReason ? `: ${c.lostReason}` : ""}</p>
          <button type="button" className="gos-btn-black" onClick={() => run(() => reopenCustomer(c.id), "Reopened ✓")}>Reopen</button>
        </section>
      )}

      {error && <p role="alert" className="text-[var(--gos-danger)]">✕ {error}</p>}

      <section className="gos-card" aria-label="Activity">
        <h2 className="mb-2 text-lg font-bold">Activity</h2>
        <ul className="space-y-2">
          {shown.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--gos-line)] pb-2">
              <span>{a.text}<span className="block text-xs text-[var(--gos-ink-dim)]">{a.when}</span></span>
              {a.undoable && <button type="button" className="gos-tap rounded-full border px-3 text-sm" onClick={() => run(() => undoActivity(a.id), "Undone ✓")}>Undo</button>}
            </li>
          ))}
        </ul>
        {!showAll && activity.length > 20 && <button type="button" className="gos-tap mt-2 underline" onClick={() => setShowAll(true)}>Show older</button>}
      </section>

      <button type="button" className="gos-tap text-sm text-[var(--gos-danger)] underline"
        onClick={async () => {
          if (!window.confirm(`Delete ${c.name} and all her records?`)) return;
          const r = await deleteCustomer(c.id);
          if (!r.ok) { setError(r.error); return; }
          router.push("/os/customers");
        }}>Delete customer</button>

      {toast && (
        <div role="status" className="fixed inset-x-4 bottom-20 z-30 mx-auto flex max-w-md items-center justify-between gap-3 rounded-xl bg-[var(--gos-black)] p-3 text-white lg:bottom-6">
          <span>{toast.text}</span>
          {toast.undoId && <button type="button" className="gos-tap font-bold text-[var(--gos-gold)] underline" onClick={() => { const id = toast.undoId!; void run(() => undoActivity(id), "Undone ✓"); }}>Undo</button>}
        </div>
      )}
    </div>
  );
}
