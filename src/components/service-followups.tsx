"use client";

import { waitlistPianoText } from "@/lib/service-piano-info";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, ListChecks, MessageSquare, Phone } from "lucide-react";
import { telHref } from "@/lib/service-customer-list";
import { reminderState } from "@/lib/service-reminders";
import { SERVICE_TYPE_LABEL } from "@/lib/service";
import { WAIT_SOURCE_LABEL, WAIT_STATUS_LABEL, WAIT_STATUS_TONE } from "@/lib/service-waitlist";
import { canConvertEntry } from "@/lib/service-waitlist-convert";
import type { FollowUpKind } from "@/lib/service-followups";
import type { WaitlistItem } from "@/server/service-waitlist-data";
import MessageActions from "@/components/service-message-actions";
import { ConvertButton } from "@/components/service-waitlist-convert";
import { Chip, TONE_TEXT } from "@/components/service-ui";

const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-svc-accent)]";
const DIM = { color: "var(--color-svc-text-dim)" } as const;
const GHOST = `btn-svc-ghost rounded-xl px-3.5 min-h-11 inline-flex items-center gap-1.5 text-[13px] ${FOCUS}`;

/** "Reminder" / "Waitlist": an icon plus the word, so the kind never depends on colour. */
export function KindChip({ kind }: { kind: FollowUpKind }) {
  return kind === "reminder"
    ? <Chip tone="violet"><Bell size={12} aria-hidden="true" /> Reminder</Chip>
    : <Chip tone="azure"><ListChecks size={12} aria-hidden="true" /> Waitlist</Chip>;
}

/**
 * One waitlist follow-up in the queue. Same shape as a reminder row (who + what / when / actions) with the waitlist's own
 * actions: Message (copy, Messenger, SMS, "Messaged ✓") and Convert to job.
 */
export function WaitlistFollowUpItem({
  w, dueDay, now, template, convertLoading, onConvert,
}: {
  w: WaitlistItem;
  /** The Manila day the follow-up falls on. */
  dueDay: Date;
  now: Date;
  template: string;
  convertLoading: boolean;
  onConvert: () => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  // A waitlist entry has no due date and is never "overdue": no date, no day counts; once its day has come the only cue is a
  // neutral "Follow up now" chip. Upcoming entries show nothing (the group heading says it).
  const followUpNow = reminderState(dueDay, now) !== "upcoming";
  const tel = telHref(w.customerPhone);
  const what = [waitlistPianoText(w), SERVICE_TYPE_LABEL[w.serviceType] ?? w.serviceType, w.areaLabel || null].filter(Boolean).join(" · ");

  return (
    <li className="@container px-4 sm:px-5 py-4">
      <div className="grid gap-x-5 gap-y-3 items-center @min-[40rem]:grid-cols-[minmax(0,1fr)_auto_auto]">
        <div className="min-w-0">
          <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
            <KindChip kind="waitlist" />
            <Chip tone={WAIT_STATUS_TONE[w.status] ?? "slate"}>{WAIT_STATUS_LABEL[w.status] ?? w.status}</Chip>
          </div>
          <Link href={`/service/customers/${w.customerId}`} className={`block text-[16px] font-semibold leading-snug break-words hover:underline rounded-sm ${FOCUS}`} style={{ color: "var(--color-svc-text)" }}>
            {w.customerName}
          </Link>
          <p className="text-[14px] mt-0.5 break-words" style={DIM}>{what}</p>
          <p className="text-[12px] mt-0.5" style={{ color: "var(--color-svc-text-faint)" }}>
            {WAIT_SOURCE_LABEL[w.source] ?? w.source} · message {w.followUpCount + 1}
          </p>
          {tel ? (
            <a href={tel} aria-label={`Call ${w.customerName} at ${w.customerPhone}`} className={`mt-1.5 inline-flex items-center gap-1.5 min-h-11 text-[13px] hover:underline rounded-sm ${FOCUS}`} style={{ color: TONE_TEXT.azure }}>
              <Phone size={12} aria-hidden="true" /> <span className="svc-num">{w.customerPhone}</span>
            </a>
          ) : null}
        </div>

        <p className="flex flex-wrap items-center gap-2 @min-[40rem]:justify-end">
          {followUpNow ? <Chip tone="slate">Follow up now</Chip> : null}
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-label={`Message ${w.customerName}`} className={GHOST}>
            <MessageSquare size={14} aria-hidden="true" /> Message
          </button>
          {canConvertEntry(w) ? <ConvertButton customerName={w.customerName} loading={convertLoading} onClick={onConvert} /> : null}
        </div>
      </div>
      {open ? (
        <div className="mt-3">
          <MessageActions
            entryId={w.id} customerName={w.customerName} phone={w.customerPhone} messenger={w.messenger} template={template}
            vars={{ area: w.areaLabel, piano: w.pianoLabel ?? "piano" }} onMessaged={() => { setOpen(false); router.refresh(); }}
          />
        </div>
      ) : null}
    </li>
  );
}
