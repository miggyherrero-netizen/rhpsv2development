"use client";

import { useMemo, useState } from "react";
import { Inbox, CornerDownRight, Archive, CalendarPlus, ListChecks, BellRing } from "lucide-react";
import type { OwnerBundle } from "@/lib/owner-utils";
import { deserializeOwnerBundle } from "@/lib/owner-utils";
import { timeAgo, toDateInput } from "@/lib/format";
import { PriorityDot } from "@/components/owner-ui";
import { EmptyState } from "@/components/ui";
import { addInboxItem, convertInboxItem, archiveInboxItem } from "@/server/owner";

export default function OwnerInboxClient({ bundle: rawBundle }: { bundle: OwnerBundle }) {
  const bundle = useMemo(() => deserializeOwnerBundle(rawBundle), [rawBundle]);
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState("normal");
  const [convertId, setConvertId] = useState<string | null>(null);
  const [convertDate, setConvertDate] = useState("");

  const open = bundle.inbox.filter((i) => !i.processedAt);
  const done = bundle.inbox.filter((i) => i.processedAt);

  async function capture() {
    if (!title.trim()) return;
    await addInboxItem(title.trim(), priority);
    setTitle("");
  }

  return (
    <div className="p-4 sm:p-7 max-w-3xl mx-auto">
      <div className="mb-6">
        <h1 className="font-serif text-2xl sm:text-3xl text-[var(--color-ow-text)]">Inbox</h1>
        <p className="text-[var(--color-ow-text-dim)] text-[13px] mt-1">Catch it now, decide later. Nothing here forces its way into the shop system.</p>
      </div>

      {/* capture */}
      <div className="card-ow p-3.5 mb-6 flex items-center gap-2.5">
        <Inbox size={16} className="text-[var(--color-ow-text-faint)] ml-1 shrink-0" />
        <input
          value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === "Enter" && capture()}
          placeholder="“Mrs. Santos called about restoring her Yamaha…”"
          className="flex-1 bg-transparent outline-none text-[14px] text-[var(--color-ow-text)] placeholder:text-[var(--color-ow-text-faint)] min-w-0"
        />
        <select value={priority} onChange={(e) => setPriority(e.target.value)} className="input-ow !w-auto !py-2 !text-[12px]">
          <option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option>
        </select>
        <button onClick={capture} className="btn-ow-primary text-[12px] rounded-lg px-4 py-2 shrink-0">Capture</button>
      </div>

      <p className="text-[12px] uppercase tracking-[0.1em] text-[var(--color-ow-text-faint)] mb-3">To process · {open.length}</p>
      {open.length === 0 ? (
        <EmptyState title="Inbox zero" body="Everything captured has been processed." />
      ) : (
        <ul className="card-ow ow-divide">
          {open.map((i) => (
            <li key={i.id} className="px-4 py-3.5">
              <div className="flex items-start gap-2.5">
                <PriorityDot priority={i.priority} />
                <div className="flex-1 min-w-0">
                  <p className="text-[14px] leading-snug text-[var(--color-ow-text)]">{i.title}</p>
                  <p className="text-[12px] text-[var(--color-ow-text-faint)] mt-0.5">captured {timeAgo(new Date(i.capturedAt))}{i.dueDate ? ` · hopes for ${toDateInput(new Date(i.dueDate))}` : ""}</p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 mt-2.5 ml-4">
                <button onClick={() => setConvertId(convertId === `${i.id}:task` ? null : `${i.id}:task`)}
                  className="chip-ow flex items-center gap-1.5 text-[12px] rounded-lg px-2.5 py-1.5 transition hover:text-[var(--color-ow-text)]"><ListChecks size={11} /> Task</button>
                <button onClick={() => setConvertId(convertId === `${i.id}:event` ? null : `${i.id}:event`)}
                  className="chip-ow flex items-center gap-1.5 text-[12px] rounded-lg px-2.5 py-1.5 transition hover:text-[var(--color-ow-text)]"><CalendarPlus size={11} /> Appointment</button>
                <button onClick={() => convertInboxItem(i.id, "reminder")}
                  className="chip-ow flex items-center gap-1.5 text-[12px] rounded-lg px-2.5 py-1.5 transition hover:text-[var(--color-ow-text)]"><BellRing size={11} /> Reminder tomorrow</button>
                <button onClick={() => archiveInboxItem(i.id)}
                  className="flex items-center gap-1.5 text-[12px] text-[var(--color-ow-text-dim)] hover:text-[var(--color-ow-text)] rounded-lg px-2.5 py-1.5 transition"><Archive size={11} /> Archive</button>
              </div>
              {(convertId === `${i.id}:task` || convertId === `${i.id}:event`) && (
                <div className="flex items-center gap-2 mt-2.5 ml-4 anim-sheet">
                  <CornerDownRight size={13} className="text-[var(--color-ow-text-faint)]" />
                  <input type="date" value={convertDate} onChange={(e) => setConvertDate(e.target.value)} className="input-ow !w-auto !py-1.5 !text-[12px]" />
                  <button
                    onClick={() => { convertInboxItem(i.id, convertId.endsWith(":task") ? "task" : "event", convertDate ? new Date(`${convertDate}T09:00`).toISOString() : null); setConvertId(null); setConvertDate(""); }}
                    className="btn-ow-primary text-[12px] rounded-lg px-3 py-1.5">
                    {convertId.endsWith(":task") ? "Create task" : "Create appointment"}
                  </button>
                  <span className="text-[12px] text-[var(--color-ow-text-faint)]">{convertId.endsWith(":task") ? "leave blank for unscheduled" : "blank → tomorrow 9:00 AM"}</span>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {done.length > 0 && (
        <details className="mt-8 group">
          <summary className="text-[12px] uppercase tracking-[0.1em] text-[var(--color-ow-text-faint)] cursor-pointer hover:text-[var(--color-ow-text)] transition">Processed history · {done.length}</summary>
          <ul className="mt-3 space-y-1.5">
            {done.slice(0, 15).map((i) => (
              <li key={i.id} className="text-[12px] text-[var(--color-ow-text-faint)] flex items-center gap-2">
                <span className="line-through flex-1 truncate">{i.title}</span>
                <span className="text-[12px]">{i.convertedType ?? "processed"}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
