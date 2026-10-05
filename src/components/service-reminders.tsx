"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, Check, Phone, Trash2 } from "lucide-react";
import { fmtDate } from "@/lib/format";
import { telHref } from "@/lib/service-customer-list";
import {
  NOTE_MAX, PRESETS, SNOOZE_CHOICES, parseDayInput, presetDate, reminderLabel, reminderState, softCaps, toDayInput,
} from "@/lib/service-reminders";
import { completeReminder, createReminder, deleteReminder, snoozeReminder } from "@/server/service-reminders";
import type { ReminderRow } from "@/server/service-reminders-data";
import { Chip, ConfirmDialog, ErrorLine, Field, GhostButton, PrimaryButton, Select, SvcModal, TextArea, TextInput, TONE_TEXT } from "@/components/service-ui";

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
 * One reminder. The client's name leads (Today / Reminders page, where several clients mix); on the client's own
 * page `showClient` is off because the page already says who it is, and the note leads instead.
 * Wide: who + note on the left, when in the middle, actions on the right. Narrow: stacked, Done gets the width.
 */
export function ReminderItem({ r, now, showClient }: { r: ReminderRow; now: Date; showClient: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const tel = telHref(r.customerPhone);
  const state = reminderState(r.dueAt, now);
  const label = reminderLabel(r.dueAt, now);
  const note = r.note ? softCaps(r.note) : null;

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) setError(res.error ?? "Something went wrong.");
      else router.refresh();
    });
  };

  return (
    <li className="@container px-4 sm:px-5 py-4">
      <div className="grid gap-x-5 gap-y-3 items-center @min-[40rem]:grid-cols-[minmax(0,1fr)_auto_auto]">
        {/* Who + what */}
        <div className="min-w-0">
          {showClient ? (
            <Link
              href={`/service/customers/${r.customerId}`}
              className={`block text-[16px] font-semibold leading-snug break-words hover:underline rounded-sm ${FOCUS}`}
              style={{ color: "var(--color-svc-text)" }}
            >
              {r.customerName}
            </Link>
          ) : null}
          <p
            className={`break-words ${showClient ? "text-[13.5px] mt-0.5" : "text-[15px] font-medium"}`}
            style={note ? { color: showClient ? "var(--color-svc-text-dim)" : "var(--color-svc-text)" } : FAINT}
          >
            {note ?? "No note"}
          </p>
          {showClient && tel ? (
            <a
              href={tel}
              aria-label={`Call ${r.customerName} at ${r.customerPhone}`}
              className={`mt-1.5 inline-flex items-center gap-1.5 min-h-8 text-[12.5px] hover:underline rounded-sm ${FOCUS}`}
              style={{ color: TONE_TEXT.azure }}
            >
              <Phone size={12} aria-hidden="true" /> <span className="svc-num">{r.customerPhone}</span>
            </a>
          ) : null}
        </div>

        {/* When */}
        <p className="flex flex-wrap items-center gap-2 @min-[40rem]:justify-end">
          <span className="svc-num text-[13px]" style={DIM}>{fmtDate(r.dueAt)}</span>
          {label ? <Chip tone={state === "overdue" ? "danger" : state === "today" ? "warn" : "slate"}>{label}</Chip> : null}
        </p>

        {/* What to do: Done is the one coloured action; Snooze is quiet; Delete is a small icon that asks first */}
        <div className="flex items-center gap-2">
          <button
            type="button" disabled={pending} onClick={() => run(() => completeReminder(r.id))}
            aria-label={`Mark done: reminder for ${r.customerName}`}
            className={`flex-1 @min-[40rem]:flex-none inline-flex items-center justify-center gap-1.5 rounded-xl px-4 min-h-11 text-[13px] font-medium disabled:opacity-60 ${FOCUS}`}
            style={{ background: "var(--color-svc-accent-soft)", color: "var(--color-svc-accent-text, var(--color-svc-accent))" }}
          >
            <Check size={15} aria-hidden="true" /> Done
          </button>
          <Select
            aria-label={`Snooze reminder for ${r.customerName}`} value="" disabled={pending}
            onChange={(e) => { const d = Number(e.target.value); if (d) run(() => snoozeReminder(r.id, d)); }}
            className="!w-auto !min-h-11 !text-[13px] !bg-transparent"
          >
            <option value="">Snooze</option>
            {SNOOZE_CHOICES.map((c) => <option key={c.days} value={c.days}>{c.label}</option>)}
          </Select>
          <button
            type="button" disabled={pending} onClick={() => setConfirmDelete(true)}
            aria-label={`Delete reminder for ${r.customerName}`}
            className={`inline-flex items-center justify-center w-11 min-h-11 rounded-xl hover:bg-white/[0.05] disabled:opacity-60 ${FOCUS}`}
            style={{ color: "var(--color-svc-text-faint)" }}
          >
            <Trash2 size={15} aria-hidden="true" />
          </button>
        </div>
      </div>
      <ErrorLine>{error}</ErrorLine>
      <ConfirmDialog
        open={confirmDelete}
        title="Delete this reminder?"
        message={showClient ? `The reminder for ${r.customerName} will be removed.` : "This reminder will be removed."}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => { setConfirmDelete(false); run(() => deleteReminder(r.id)); }}
      />
    </li>
  );
}
