"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, Check, Phone } from "lucide-react";
import { fmtDate } from "@/lib/format";
import { telHref } from "@/lib/service-customer-list";
import {
  NOTE_MAX, PRESETS, SNOOZE_CHOICES, parseDayInput, presetDate, reminderLabel, reminderState, toDayInput,
} from "@/lib/service-reminders";
import { completeReminder, createReminder, deleteReminder, snoozeReminder } from "@/server/service-reminders";
import type { ReminderRow } from "@/server/service-reminders-data";
import { Chip, ErrorLine, Field, GhostButton, PrimaryButton, Select, SvcModal, TextArea, TextInput, TONE_TEXT } from "@/components/service-ui";

const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-svc-accent)]";
const DIM = { color: "var(--color-svc-text-dim)" } as const;
const FAINT = { color: "var(--color-svc-text-faint)" } as const;

/* ------------------------------------------------------------------ set one */

/** "Remind me" box. The client's name is in the title, so it is always clear who the reminder is for. */
export function RemindMeModal({
  open, onClose, customerId, customerName, customers,
}: {
  open: boolean;
  onClose: () => void;
  /** Known client (customer page). Left out on the Reminders page, where `customers` is given to choose from. */
  customerId?: string;
  customerName?: string;
  customers?: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [now] = useState(() => new Date());
  const [day, setDay] = useState(() => toDayInput(presetDate("tomorrow", new Date())));
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState("");
  const chosenId = customerId ?? picked;
  const chosenName = customerName ?? customers?.find((c) => c.id === picked)?.name;

  const save = () => {
    setError(null);
    if (!chosenId) { setError("Choose a client first."); return; }
    startTransition(async () => {
      const res = await createReminder({ customerId: chosenId, day, note });
      if (!res.ok) { setError(res.error); return; }
      setNote("");
      setPicked("");
      onClose();
      router.refresh();
    });
  };

  return (
    <SvcModal open={open} onClose={onClose} title={chosenName ? `Remind me about ${chosenName}` : "Add a reminder"} subtitle="It will show on Today when it's due.">
      <div className="space-y-4">
        {!customerId ? (
          <Field label="Client">
            <Select value={picked} onChange={(e) => setPicked(e.target.value)} required>
              <option value="">Choose a client…</option>
              {(customers ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
        ) : null}
        <div>
          <p className="text-[12px] mb-2" style={DIM}>When?</p>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Quick dates">
            {PRESETS.map((p) => {
              const value = toDayInput(presetDate(p.key, now));
              const active = day === value;
              return (
                <button
                  key={p.key} type="button" aria-pressed={active} onClick={() => setDay(value)}
                  className={`rounded-xl px-3.5 min-h-11 text-[13px] border ${FOCUS}`}
                  style={{
                    borderColor: active ? "var(--color-svc-accent)" : "var(--color-svc-border)",
                    background: active ? "rgba(79,140,255,0.14)" : "transparent",
                    color: active ? "var(--color-svc-accent-text, var(--color-svc-text))" : "var(--color-svc-text-dim)",
                  }}
                >
                  {p.label}
                </button>
              );
            })}
          </div>
        </div>
        <Field label="Date">
          <TextInput type="date" value={day} min={toDayInput(now)} onChange={(e) => setDay(e.target.value)} />
        </Field>
        {parseDayInput(day) ? <p className="text-[12.5px] -mt-2" style={DIM}>{fmtDate(parseDayInput(day)!)}</p> : null}
        <Field label="What is it about?" hint="Optional. For example: ask about the Yamaha quote.">
          <TextArea rows={3} maxLength={NOTE_MAX} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ask about the quote, confirm the schedule…" />
        </Field>
        <ErrorLine>{error}</ErrorLine>
        <div className="flex flex-wrap justify-end gap-2 pt-1">
          <GhostButton type="button" className="!min-h-11" onClick={onClose}>Cancel</GhostButton>
          <PrimaryButton type="button" pending={pending} className="!min-h-11" onClick={save}><Bell size={14} /> Set reminder</PrimaryButton>
        </div>
      </div>
    </SvcModal>
  );
}

/* ----------------------------------------------------------- one reminder */

/**
 * One reminder. `showClient` puts the client's name first (Today, where several clients mix);
 * on the client's own page it is left out because the page already says who it is.
 */
export function ReminderItem({ r, now, showClient }: { r: ReminderRow; now: Date; showClient: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const tel = telHref(r.customerPhone);
  const state = reminderState(r.dueAt, now);
  const label = reminderLabel(r.dueAt, now);

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) setError(res.error ?? "Something went wrong.");
      else router.refresh();
    });
  };

  return (
    <li className="px-5 py-3.5 space-y-2.5">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <div className="min-w-0">
          {showClient ? (
            <Link href={`/service/customers/${r.customerId}`} className={`text-[14.5px] font-medium hover:underline rounded-sm ${FOCUS}`} style={{ color: "var(--color-svc-text)" }}>
              {r.customerName}
            </Link>
          ) : null}
          <p className="text-[13px] break-words" style={r.note ? { color: "var(--color-svc-text)" } : FAINT}>
            {r.note ?? "No note"}
          </p>
        </div>
        <span className="inline-flex items-center gap-2 shrink-0">
          <span className="svc-num text-[12.5px]" style={DIM}>{fmtDate(r.dueAt)}</span>
          {label ? <Chip tone={state === "overdue" ? "danger" : state === "today" ? "warn" : "slate"}>{label}</Chip> : null}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {showClient && tel ? (
          <a href={tel} aria-label={`Call ${r.customerName}`} className={`btn-svc-ghost rounded-xl px-3.5 min-h-11 inline-flex items-center gap-1.5 text-[12.5px] ${FOCUS}`} style={{ color: TONE_TEXT.azure }}>
            <Phone size={13} /> Call
          </a>
        ) : null}
        <GhostButton type="button" disabled={pending} className="!min-h-11 inline-flex items-center gap-1.5" onClick={() => run(() => completeReminder(r.id))} aria-label={`Mark done: reminder for ${r.customerName}`}>
          <Check size={13} /> Done
        </GhostButton>
        <Select
          aria-label={`Snooze reminder for ${r.customerName}`} value="" disabled={pending}
          onChange={(e) => { const d = Number(e.target.value); if (d) run(() => snoozeReminder(r.id, d)); }}
          className="!w-auto !min-h-11 !text-[12.5px]"
        >
          <option value="">Snooze…</option>
          {SNOOZE_CHOICES.map((c) => <option key={c.days} value={c.days}>{c.label}</option>)}
        </Select>
        <GhostButton type="button" disabled={pending} className="!min-h-11" onClick={() => run(() => deleteReminder(r.id))} aria-label={`Delete reminder for ${r.customerName}`}>
          Delete
        </GhostButton>
      </div>
      <ErrorLine>{error}</ErrorLine>
    </li>
  );
}
