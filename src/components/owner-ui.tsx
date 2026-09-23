"use client";

import { useEffect, useState } from "react";
import { Repeat, MapPin, User, Bell } from "lucide-react";
import type { OwnerCategory, OwnerTask } from "@/db/schema";
import { REMINDER_OPTIONS, CATEGORY_COLORS } from "@/lib/config";

/** Muted, non-yellow priority palette for the Personal Workspace dark theme. */
const PRIORITY_STYLE_OW: Record<string, { label: string; dot: string }> = {
  low: { label: "Low", dot: "bg-[var(--color-ow-text-faint)]" },
  normal: { label: "Normal", dot: "bg-[var(--color-ow-blue)]" },
  high: { label: "High", dot: "bg-[var(--color-ow-violet)]" },
  urgent: { label: "Urgent", dot: "bg-[var(--color-ow-rose)]" },
};
import { RECURRENCE_PRESETS } from "@/lib/dates";
import { toDateInput, fmtTime } from "@/lib/format";
import { OwnerModal, Field, Spinner } from "@/components/ui";
import {
  createOwnerEvent, updateOwnerEvent, createOwnerTask, updateOwnerTask,
  type OwnerEventInput, type OwnerTaskInput,
} from "@/server/owner";

export type EditEvent = {
  type: "event" | "focus" | "reminder"; id: string; title: string; date: string; startTime: string; endTime: string;
  isAllDay: boolean; location: string; person: string; categoryId: string | null; reminderMinutes: number | null;
  recurrenceKey: string; notes: string;
};
export type EditTask = {
  type: "task"; id: string; title: string; dueDate: string; startTime: string; endTime: string;
  priority: string; categoryId: string | null; notes: string; recurrenceKey: string;
};
export type ItemEdit = EditEvent | EditTask;

export function taskToEdit(t: OwnerTask): EditTask {
  return {
    type: "task", id: t.id, title: t.title,
    dueDate: t.dueDate ? toDateInput(new Date(t.dueDate)) : toDateInput(new Date()),
    startTime: t.scheduledStart ? toTimeStr(new Date(t.scheduledStart)) : "",
    endTime: t.scheduledEnd ? toTimeStr(new Date(t.scheduledEnd)) : "",
    priority: t.priority, categoryId: t.categoryId, notes: t.notes ?? "",
    recurrenceKey: recKeyOf(t.recurrence),
  };
}

export const toTimeStr = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

const combine = (date: string, time: string) => new Date(`${date}T${time || "09:00"}`);

function recKeyOf(rec: unknown): string {
  if (!rec || typeof rec !== "object") return "none";
  const r = rec as { freq: string; interval: number };
  return RECURRENCE_PRESETS.find((p) => p.rec && p.rec.freq === r.freq && p.rec.interval === r.interval)?.key ?? "none";
}

type FormState = {
  type: "event" | "focus" | "reminder" | "task";
  title: string; date: string; startTime: string; endTime: string; isAllDay: boolean;
  location: string; person: string; categoryId: string; priority: string;
  reminderMinutes: string; recurrenceKey: string; notes: string;
};

export function ItemModal({
  open, onClose, categories, edit, defaultDate, defaultTime,
}: {
  open: boolean; onClose: () => void; categories: OwnerCategory[];
  edit?: ItemEdit | null; defaultDate?: Date; defaultTime?: string;
}) {
  const [form, setForm] = useState<FormState | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    const d = defaultDate ?? new Date();
    let nextForm: FormState;
    if (edit && edit.type === "task") {
      nextForm = {
        type: "task", title: edit.title, date: edit.dueDate, startTime: edit.startTime, endTime: edit.endTime,
        isAllDay: false, location: "", person: "", categoryId: edit.categoryId ?? "", priority: edit.priority,
        reminderMinutes: "", recurrenceKey: edit.recurrenceKey, notes: edit.notes,
      };
    } else if (edit) {
      nextForm = {
        type: edit.type, title: edit.title, date: edit.date, startTime: edit.startTime, endTime: edit.endTime,
        isAllDay: edit.isAllDay, location: edit.location, person: edit.person, categoryId: edit.categoryId ?? "",
        priority: "normal", reminderMinutes: edit.reminderMinutes?.toString() ?? "",
        recurrenceKey: edit.recurrenceKey, notes: edit.notes,
      };
    } else {
      nextForm = {
        type: "task", title: "", date: toDateInput(d), startTime: defaultTime ?? "", endTime: "",
        isAllDay: false, location: "", person: "", categoryId: "", priority: "normal",
        reminderMinutes: "", recurrenceKey: "none", notes: "",
      };
    }
    queueMicrotask(() => setForm(nextForm));
  }, [open, edit, defaultDate, defaultTime]);

  if (!form) return null;
  const isTask = form.type === "task";

  async function save() {
    if (!form || !form.title.trim()) return;
    setBusy(true);
    if (isTask) {
      const input: OwnerTaskInput = {
        title: form.title.trim(),
        dueDate: form.date || null,
        scheduledStart: form.startTime ? combine(form.date, form.startTime).toISOString() : null,
        scheduledEnd: form.endTime ? combine(form.date, form.endTime).toISOString() : null,
        estimatedMinutes: form.startTime && form.endTime ? Math.max(15, (combine(form.date, form.endTime).getTime() - combine(form.date, form.startTime).getTime()) / 60000) : null,
        priority: form.priority, categoryId: form.categoryId || null, notes: form.notes || undefined,
        recurrenceKey: form.recurrenceKey !== "none" ? form.recurrenceKey : undefined,
      };
      if (edit?.type === "task") await updateOwnerTask(edit.id, input);
      else await createOwnerTask(input);
    } else {
      const start = form.isAllDay ? new Date(`${form.date}T00:00`) : combine(form.date, form.startTime || "09:00");
      const end = form.isAllDay || !form.endTime ? null : combine(form.date, form.endTime);
      const input: OwnerEventInput = {
        title: form.title.trim(), kind: form.type,
        startAt: start.toISOString(), endAt: end ? end.toISOString() : null,
        isAllDay: form.isAllDay, location: form.location || undefined, person: form.person || undefined,
        categoryId: form.categoryId || null, reminderMinutes: form.reminderMinutes ? Number(form.reminderMinutes) : null,
        recurrenceKey: form.recurrenceKey, notes: form.notes || undefined,
      };
      if (edit && edit.type !== "task") await updateOwnerEvent(edit.id, input);
      else await createOwnerEvent(input);
    }
    setBusy(false);
    onClose();
  }

  const inp = "input-ow";

  return (
    <OwnerModal open={open} onClose={onClose} title={edit ? "Edit item" : "Add to your day"} wide>
      <div className="space-y-3.5">
        {/* kind switch */}
        <div className="flex rounded-xl p-1 gap-1" style={{ background: "var(--color-ow-surface-2)" }}>
          {([["task", "Task"], ["event", "Appointment"], ["focus", "Focus block"], ["reminder", "Reminder"]] as const).map(([k, label]) => (
            <button key={k} onClick={() => setForm({ ...form, type: k })}
              className={`flex-1 text-[12px] rounded-lg py-2 transition ${
                form.type === k ? "font-medium text-[var(--color-ow-accent)]" : "text-[var(--color-ow-text-dim)] hover:text-[var(--color-ow-text)]"
              }`}
              style={form.type === k ? { background: "var(--color-ow-accent-soft)" } : undefined}
            >
              {label}
            </button>
          ))}
        </div>

        <Field label="Title">
          <input className={inp} autoFocus value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
            placeholder={isTask ? "e.g. Order hammer felt" : "e.g. Piano tuning — Santos"} />
        </Field>

        <div className="grid grid-cols-2 gap-3.5">
          <Field label={isTask ? "Due date" : "Date"}>
            <input type="date" className={inp} value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
          </Field>
          {!isTask && (
            <Field label="All day">
              <button type="button" onClick={() => setForm({ ...form, isAllDay: !form.isAllDay })}
                className="w-full text-[12.5px] rounded-[10px] border py-[9px] transition"
                style={form.isAllDay
                  ? { background: "var(--color-ow-accent-soft)", borderColor: "var(--color-ow-accent)", color: "var(--color-ow-accent)" }
                  : { borderColor: "var(--color-ow-border)", color: "var(--color-ow-text-dim)" }}
              >
                {form.isAllDay ? "All day ✓" : "Timed"}
              </button>
            </Field>
          )}
          {form.type === "task" && (
            <Field label="Priority">
              <select className={inp} value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
                <option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option>
              </select>
            </Field>
          )}
          {(form.type !== "reminder" || isTask) && !(form.type !== "task" && form.isAllDay) && (
            <>
              <Field label={isTask ? "Block start (optional)" : "Starts"}>
                <input type="time" className={inp} value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} />
              </Field>
              <Field label={isTask ? "Block end (optional)" : "Ends"}>
                <input type="time" className={inp} value={form.endTime} onChange={(e) => setForm({ ...form, endTime: e.target.value })} />
              </Field>
            </>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3.5">
          <Field label="Category">
            <select className={inp} value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}>
              <option value="">None</option>
              {categories.filter((c) => !c.hidden).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <Field label="Repeat">
            <select className={inp} value={form.recurrenceKey} onChange={(e) => setForm({ ...form, recurrenceKey: e.target.value })}>
              {RECURRENCE_PRESETS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
            </select>
          </Field>
          {!isTask && (
            <>
              <Field label="Location"><input className={inp} value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="Optional" /></Field>
              <Field label="With / for"><input className={inp} value={form.person} onChange={(e) => setForm({ ...form, person: e.target.value })} placeholder="Client or person" /></Field>
            </>
          )}
          <Field label="Remind me">
            <select className={inp} value={form.reminderMinutes} onChange={(e) => setForm({ ...form, reminderMinutes: e.target.value })}>
              <option value="">No reminder</option>
              {REMINDER_OPTIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </Field>
        </div>

        <Field label="Notes">
          <textarea className={`${inp} min-h-[64px] resize-y`} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Optional details, links, measurements…" />
        </Field>

        <button onClick={save} disabled={busy || !form.title.trim() || !form.date}
          className="btn-ow-primary w-full text-[13px] rounded-xl py-3 flex items-center justify-center gap-2">
          {busy && <Spinner />} {edit ? "Save changes" : "Add"}
        </button>
      </div>
    </OwnerModal>
  );
}

/* ============== small shared pieces ============== */

export function PriorityDot({ priority }: { priority: string }) {
  const p = PRIORITY_STYLE_OW[priority] ?? PRIORITY_STYLE_OW.normal;
  return <span className={`inline-block w-1.5 h-1.5 rounded-full ${p.dot}`} title={p.label} />;
}

export function CategoryChip({ category }: { category: OwnerCategory | undefined }) {
  if (!category) return null;
  return (
    <span className="inline-flex items-center gap-1.5 text-[10.5px] text-[var(--color-ow-text-dim)]">
      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: category.color }} />
      {category.name}
    </span>
  );
}

export function TaskCheck({ done, onToggle }: { done: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onToggle(); }}
      aria-label={done ? "Mark not done" : "Mark done"}
      className="w-[18px] h-[18px] rounded-full border-2 shrink-0 transition-all flex items-center justify-center"
      style={done
        ? { background: "var(--color-ow-accent)", borderColor: "var(--color-ow-accent)" }
        : { borderColor: "var(--color-ow-border-strong)" }}
    >
      {done && <svg width="9" height="7" viewBox="0 0 9 7" fill="none"><path d="M1 3.5L3.2 5.5L8 1" stroke="#06211d" strokeWidth="1.6" strokeLinecap="round" /></svg>}
    </button>
  );
}

export function KindGlyph({ kind }: { kind: string }) {
  const map: Record<string, { bg: string; fg: string }> = {
    event: { bg: "rgba(107,147,201,0.16)", fg: "var(--color-ow-blue)" },
    focus: { bg: "rgba(155,138,209,0.16)", fg: "var(--color-ow-violet)" },
    reminder: { bg: "var(--color-ow-accent-soft)", fg: "var(--color-ow-accent)" },
    "task-block": { bg: "var(--color-ow-surface-2)", fg: "var(--color-ow-text-dim)" },
    "task-due": { bg: "var(--color-ow-rose-soft)", fg: "var(--color-ow-rose)" },
  };
  const letter: Record<string, string> = { event: "A", focus: "F", reminder: "R", "task-block": "T", "task-due": "D" };
  const c = map[kind] ?? { bg: "var(--color-ow-surface-2)", fg: "var(--color-ow-text-dim)" };
  return (
    <span className="w-[18px] h-[18px] rounded-md text-[9px] font-semibold flex items-center justify-center shrink-0"
      style={{ background: c.bg, color: c.fg }}>
      {letter[kind] ?? "·"}
    </span>
  );
}

export { CATEGORY_COLORS, Repeat, MapPin, User, Bell, fmtTime };
