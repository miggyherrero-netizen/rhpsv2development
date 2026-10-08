"use client";

import { useMemo } from "react";
import type { OwnerBundle } from "@/lib/owner-utils";
import { deserializeOwnerBundle } from "@/lib/owner-utils";
import { ymd, addDays, sameDay } from "@/lib/dates";
import { fmtTime, fmtDate } from "@/lib/format";
import { KindGlyph, CategoryChip, TaskCheck } from "@/components/owner-ui";
import { EmptyState } from "@/components/ui";
import { setOwnerTaskDone } from "@/server/owner";

export default function OwnerUpcomingClient({ bundle: rawBundle }: { bundle: OwnerBundle }) {
  const bundle = useMemo(() => deserializeOwnerBundle(rawBundle), [rawBundle]);
  const tf = (bundle.prefs?.timeFormat as "12h" | "24h") ?? "12h";
  const catMap = useMemo(() => new Map(bundle.categories.map((c) => [c.id, c])), [bundle.categories]);
  const from = addDays(new Date(), 1);

  const groups = Array.from({ length: 14 }, (_, i) => {
    const day = addDays(from, i);
    const items = bundle.items
      .filter((it) => ymd(it.start) === ymd(day) && it.status !== "cancelled" && it.status !== "done")
      .sort((a, b) => (a.allDay === b.allDay ? a.start.getTime() - b.start.getTime() : a.allDay ? -1 : 1));
    return { day, items };
  }).filter((g) => g.items.length > 0);

  return (
    <div className="p-4 sm:p-7 app-page app-page-list [--page-w:768px]">
      <div className="mb-6">
        <h1 className="font-serif text-2xl sm:text-3xl text-[var(--color-ow-text)]">Upcoming</h1>
        <p className="text-[var(--color-ow-text-dim)] text-[13px] mt-1">The next two weeks, in order.</p>
      </div>

      {groups.length === 0 ? (
        <EmptyState title="A quiet fortnight" body="Nothing scheduled beyond today. Enjoy the calm — or plan ahead." />
      ) : (
        <div className="space-y-7">
          {groups.map(({ day, items }) => (
            <section key={day.toISOString()}>
              <p className="text-[12px] uppercase tracking-[0.2em] text-[var(--color-ow-text-faint)] mb-2.5">
                {fmtDate(day)}{sameDay(day, addDays(new Date(), 1)) ? " · Tomorrow" : ""}
              </p>
              <ul className="card-ow ow-divide">
                {items.map((i) => (
                  <li key={i.key} className="flex items-center gap-3.5 px-4 py-3">
                    <span className="w-[74px] shrink-0 text-[12px] text-[var(--color-ow-text-dim)] tnum">{i.allDay ? "All day" : fmtTime(i.start, tf)}</span>
                    <KindGlyph kind={i.kind} />
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] truncate text-[var(--color-ow-text)]">{i.title}</p>
                      <p className="text-[12px] text-[var(--color-ow-text-dim)] mt-0.5 flex items-center gap-2">
                        <CategoryChip category={catMap.get(i.categoryId ?? "")} />
                        {i.location && <span>· {i.location}</span>}
                        {i.person && <span>· {i.person}</span>}
                      </p>
                    </div>
                    {i.kind.startsWith("task") && (
                      <TaskCheck done={false} onToggle={() => setOwnerTaskDone(i.sourceId, true)} />
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
