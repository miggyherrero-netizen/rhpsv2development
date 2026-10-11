"use client";

import { useMemo, useState } from "react";
import { Bell, ListChecks, Plus, Zap } from "lucide-react";
import { filterFollowUps, followUpCounts, groupFollowUps, type FollowUpFilter } from "@/lib/service-followups";
import type { QueueItem } from "@/server/service-followups-data";
import { RemindMeModal, ReminderItem } from "@/components/service-reminders";
import { KindChip, WaitlistFollowUpItem } from "@/components/service-followups";
import { QuickInquiryModal } from "@/components/service-quick-inquiry";
import { useConvertToJob } from "@/components/service-waitlist-convert";
import { EmptyState, GhostButton, PrimaryButton, SectionCard } from "@/components/service-ui";

const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-svc-accent)]";

const FILTERS: { key: FollowUpFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "reminder", label: "Reminders" },
  { key: "waitlist", label: "Waitlist" },
];

/** The single follow-up queue: manual reminders and waitlist follow-ups, grouped overdue / today / upcoming. */
export default function RemindersClient({
  queue, customers, templates, technicians,
}: {
  queue: QueueItem[];
  customers: { id: string; name: string }[];
  templates: { key: string; name: string; body: string }[];
  technicians: { id: string; name: string }[];
}) {
  const [addOpen, setAddOpen] = useState(false);
  const [inquiryOpen, setInquiryOpen] = useState(false);
  const [filter, setFilter] = useState<FollowUpFilter>("all");
  // One "now" for the page so every row measures against the same moment.
  const [now] = useState(() => new Date());
  const convert = useConvertToJob({ technicians });
  const counts = useMemo(() => followUpCounts(queue, now), [queue, now]);
  const groups = useMemo(() => groupFollowUps(filterFollowUps(queue, filter), now), [queue, filter, now]);
  const shown = groups.overdue.length + groups.today.length + groups.upcoming.length;
  const tpl = (source: string, status: string) =>
    templates.find((t) => t.key === (source === "recall" && status === "waiting" ? "recall" : "follow_up"))?.body ?? "";

  const sections = [
    { key: "overdue", title: "Overdue", items: groups.overdue, color: "var(--color-svc-danger)" },
    { key: "today", title: "Today", items: groups.today, color: "var(--color-svc-warn)" },
    { key: "upcoming", title: "Upcoming", items: groups.upcoming, color: "var(--color-svc-text-dim)" },
  ] as const;

  const emptyAdd = (
    <div className="flex flex-wrap items-center justify-center gap-2">
      <PrimaryButton onClick={() => setAddOpen(true)}><Plus size={15} aria-hidden="true" /> Add reminder</PrimaryButton>
      <GhostButton onClick={() => setInquiryOpen(true)} className="!min-h-11"><Zap size={15} aria-hidden="true" /> Quick inquiry</GhostButton>
    </div>
  );

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-6 lg:py-8 app-page app-page-narrow [--page-w:900px] space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[12px] uppercase tracking-[0.2em]" style={{ color: "var(--color-svc-text-faint)" }}>Home Service</p>
          <h1 className="font-serif text-3xl mt-1" style={{ color: "var(--color-svc-text)" }}>Follow-ups</h1>
          <p className="text-[13px] mt-1" style={{ color: "var(--color-svc-text-dim)" }}>
            {counts.all === 0 ? "Nothing to follow up" : `${counts.all} open · ${counts.due} due now`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <GhostButton onClick={() => setInquiryOpen(true)} className="!min-h-11 !px-4 !text-[14px]"><Zap size={15} aria-hidden="true" /> Quick inquiry</GhostButton>
          <PrimaryButton onClick={() => setAddOpen(true)} className="!min-h-11"><Plus size={15} aria-hidden="true" /> Add reminder</PrimaryButton>
        </div>
      </header>

      {convert.notice}

      <div className="flex flex-wrap gap-2" role="group" aria-label="Show">
        {FILTERS.map((f) => {
          const active = filter === f.key;
          return (
            <button
              key={f.key} type="button" aria-pressed={active} onClick={() => setFilter(f.key)}
              className={`rounded-xl px-3.5 min-h-11 inline-flex items-center gap-2 text-[14px] border ${FOCUS}`}
              style={{
                borderColor: active ? "var(--color-svc-accent)" : "var(--color-svc-border)",
                background: active ? "var(--color-svc-accent-soft)" : "transparent",
                color: active ? "var(--color-svc-accent-text, var(--color-svc-text))" : "var(--color-svc-text-dim)",
              }}
            >
              {f.label} <span className="svc-num text-[13px]">{counts[f.key]}</span>
            </button>
          );
        })}
      </div>

      {shown === 0 ? (
        <SectionCard>
          {counts.all === 0 ? (
            <EmptyState
              icon={<Bell size={19} strokeWidth={1.7} />}
              title="Nothing to follow up"
              hint="Reminders and waitlist follow-ups show here. Add a reminder, or log a quick inquiry."
              action={emptyAdd}
            />
          ) : (
            <EmptyState
              icon={filter === "waitlist" ? <ListChecks size={19} strokeWidth={1.7} /> : <Bell size={19} strokeWidth={1.7} />}
              title={filter === "waitlist" ? "No waitlist follow-ups" : "No reminders"}
              hint={filter === "waitlist" ? "Nobody on the waitlist needs a message yet. A quick inquiry adds one." : "Add a reminder so you don't forget to call or message a client."}
              action={filter === "waitlist" ? <GhostButton onClick={() => setInquiryOpen(true)} className="!min-h-11"><Zap size={15} aria-hidden="true" /> Quick inquiry</GhostButton> : <PrimaryButton onClick={() => setAddOpen(true)}><Plus size={15} aria-hidden="true" /> Add reminder</PrimaryButton>}
            />
          )}
        </SectionCard>
      ) : (
        sections.filter((s) => s.items.length > 0).map((s) => (
          <SectionCard key={s.key} title={<span style={{ color: s.color }}>{s.title} · {s.items.length}</span>}>
            <ul className="svc-divide">
              {s.items.map((it) => it.kind === "reminder"
                ? <ReminderItem key={it.key} r={it.reminder} now={now} showClient badge={<KindChip kind="reminder" />} />
                : <WaitlistFollowUpItem
                    key={it.key} w={it.entry} dueDay={it.dueAt} now={now} template={tpl(it.entry.source, it.entry.status)}
                    convertLoading={convert.loadingId === it.entry.id} onConvert={() => { void convert.start(it.entry.id); }}
                  />)}
            </ul>
          </SectionCard>
        ))
      )}

      <RemindMeModal open={addOpen} onClose={() => setAddOpen(false)} customers={customers} />
      <QuickInquiryModal open={inquiryOpen} onClose={() => setInquiryOpen(false)} onConvert={(id) => { void convert.start(id); }} />
      {convert.modal}
    </div>
  );
}
