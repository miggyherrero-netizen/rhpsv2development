"use client";

import { useMemo, useState } from "react";
import { Bell, Plus } from "lucide-react";
import { groupReminders } from "@/lib/service-reminders";
import type { ReminderRow } from "@/server/service-reminders-data";
import { RemindMeModal, ReminderItem } from "@/components/service-reminders";
import { EmptyState, PrimaryButton, SectionCard } from "@/components/service-ui";

/** Every open reminder in one place: what is overdue, what is due today, and what is coming. */
export default function RemindersClient({ reminders, customers }: { reminders: ReminderRow[]; customers: { id: string; name: string }[] }) {
  const [addOpen, setAddOpen] = useState(false);
  // One "now" for the page so every row measures against the same moment.
  const [now] = useState(() => new Date());
  const groups = useMemo(() => groupReminders(reminders, now), [reminders, now]);

  const sections = [
    { key: "overdue", title: "Overdue", items: groups.overdue, color: "var(--color-svc-danger)" },
    { key: "today", title: "Today", items: groups.today, color: "var(--color-svc-warn)" },
    { key: "upcoming", title: "Upcoming", items: groups.upcoming, color: "var(--color-svc-text-dim)" },
  ] as const;

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-6 lg:py-8 app-page app-page-narrow [--page-w:900px] space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[12px] uppercase tracking-[0.2em]" style={{ color: "var(--color-svc-text-faint)" }}>Home Service</p>
          <h1 className="font-serif text-3xl mt-1" style={{ color: "var(--color-svc-text)" }}>Reminders</h1>
          <p className="text-[13px] mt-1" style={{ color: "var(--color-svc-text-dim)" }}>
            {reminders.length === 0 ? "No open reminders" : `${reminders.length} open · ${groups.overdue.length + groups.today.length} due now`}
          </p>
        </div>
        <PrimaryButton onClick={() => setAddOpen(true)} className="!min-h-11"><Plus size={15} /> Add reminder</PrimaryButton>
      </header>

      {reminders.length === 0 ? (
        <SectionCard>
          <EmptyState
            icon={<Bell size={19} strokeWidth={1.7} />}
            title="Nothing to follow up"
            hint="Add a reminder so you don't forget to call or message a client."
            action={<PrimaryButton onClick={() => setAddOpen(true)}><Plus size={15} /> Add reminder</PrimaryButton>}
          />
        </SectionCard>
      ) : (
        sections.filter((s) => s.items.length > 0).map((s) => (
          <SectionCard key={s.key} title={<span style={{ color: s.color }}>{s.title} · {s.items.length}</span>}>
            <ul className="svc-divide">
              {s.items.map((r) => <ReminderItem key={r.id} r={r} now={now} showClient />)}
            </ul>
          </SectionCard>
        ))
      )}

      <RemindMeModal open={addOpen} onClose={() => setAddOpen(false)} customers={customers} />
    </div>
  );
}
