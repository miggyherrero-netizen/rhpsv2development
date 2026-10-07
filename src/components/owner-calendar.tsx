"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronLeft, ChevronRight, Plus, Search, CheckCheck, Trash2, CopyPlus, Pencil,
  X, AlarmClockOff, Minus, Plus as PlusSm, CalendarOff,
} from "lucide-react";
import type { OwnerBundle, CalItem, WorkingHours } from "@/lib/owner-utils";
import { findConflicts, deserializeOwnerBundle } from "@/lib/owner-utils";
import { ymd, addDays, minutesOf, sameDay, RECURRENCE_PRESETS } from "@/lib/dates";
import { fmtTime, fmtMonthYear, fmtDate, toDateInput } from "@/lib/format";
import { ItemModal, TaskCheck, CategoryChip, PriorityDot, toTimeStr, type ItemEdit, type EditEvent, taskToEdit } from "@/components/owner-ui";
import {
  updateOwnerEvent, deleteOwnerEvent, completeOwnerEvent, duplicateOwnerEvent,
  setOwnerTaskDone, scheduleOwnerTask, cancelOwnerTask,
} from "@/server/owner";

const START_MIN = 6 * 60;
const END_MIN = 21 * 60;
const HOURS = (END_MIN - START_MIN) / 60;
const PX = 0.9; // px per minute

function hexA(hex: string, a: number): string {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

const KIND_TINT: Record<string, { bg: string; border: string; text: string }> = {
  focus: { bg: "rgba(167,139,250,0.2)", border: "#a78bfa", text: "#ece6ff" },
  reminder: { bg: "rgba(45,212,191,0.16)", border: "#2dd4bf", text: "#c9f7f0" },
  "task-block": { bg: "rgba(255,255,255,0.08)", border: "#8a98b0", text: "#dbe3ee" },
};

type View = "day" | "week" | "month" | "agenda";

export default function CalendarClient({ bundle: rawBundle, now: nowIso }: { bundle: OwnerBundle; now: string }) {
  const [now] = useState(() => new Date(nowIso));
  const bundle = useMemo(() => deserializeOwnerBundle(rawBundle), [rawBundle]);
  const [view, setView] = useState<View>((bundle.prefs?.defaultView as View) || "week");
  const [cursor, setCursor] = useState(now);
  const [addModal, setAddModal] = useState<null | { date: Date; time?: string; edit?: ItemEdit }>(null);
  const [detail, setDetail] = useState<CalItem | null>(null);
  const [scope, setScope] = useState<null | { item: CalItem; action: "complete" | "delete" }>(null);
  const [kindFilter, setKindFilter] = useState<string>("all");
  const [catFilter, setCatFilter] = useState<string>("all");
  const [showDone, setShowDone] = useState(bundle.prefs?.showCompleted ?? true);
  const [search, setSearch] = useState("");

  const tf = (bundle.prefs?.timeFormat as "12h" | "24h") ?? "12h";
  const wh = (bundle.prefs?.workingHours ?? {}) as WorkingHours;
  const weekStart = bundle.prefs?.weekStart ?? 1;
  const catMap = useMemo(() => new Map(bundle.categories.map((c) => [c.id, c])), [bundle.categories]);
  const showWeekends = bundle.prefs?.showWeekends ?? true;
  const nowMs = now.getTime();

  const items = useMemo(() => {
    return bundle.items.filter((i) => {
      if (!showDone && i.status === "done") return false;
      if (kindFilter === "appointments" && i.kind !== "event") return false;
      if (kindFilter === "tasks" && !i.kind.startsWith("task")) return false;
      if (kindFilter === "focus" && i.kind !== "focus") return false;
      if (catFilter !== "all" && i.categoryId !== catFilter) return false;
      return true;
    });
  }, [bundle.items, kindFilter, catFilter, showDone]);

  const weekDays = useMemo(() => {
    const d = new Date(cursor);
    const day = d.getDay();
    const start = addDays(d, -((day - weekStart + 7) % 7));
    return Array.from({ length: 7 }, (_, i) => addDays(start, i)).filter((dayD) => showWeekends || (dayD.getDay() !== 0 && dayD.getDay() !== 6));
  }, [cursor, weekStart, showWeekends]);

  const days = view === "week" ? weekDays : view === "day" ? [cursor] : [];
  const unscheduled = bundle.tasks.filter((t) => t.status !== "done" && t.status !== "cancelled" && !t.scheduledStart);

  const searchResults = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (q.length < 2) return [];
    return [
      ...bundle.items.filter((i) => i.title.toLowerCase().includes(q) && i.start.getTime() > nowMs - 90 * 86_400_000).slice(0, 6).map((i) => ({ type: "item" as const, item: i })),
      ...bundle.tasks.filter((t) => t.title.toLowerCase().includes(q)).slice(0, 6).map((t) => ({ type: "task" as const, task: t })),
    ].slice(0, 8);
  }, [search, bundle, nowMs]);

  function nav(dir: number) {
    if (view === "day") setCursor(addDays(cursor, dir));
    else if (view === "week") setCursor(addDays(cursor, dir * 7));
    else if (view === "month") setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + dir, 1));
    else setCursor(addDays(cursor, dir * 14));
  }

  function openEdit(item: CalItem) {
    if (item.kind.startsWith("task")) {
      const task = bundle.tasks.find((t) => t.id === item.sourceId);
      if (task) setAddModal({ date: item.start, edit: taskToEdit(task) });
    } else {
      const ev = bundle.events.find((e) => e.id === item.sourceId);
      if (!ev) return;
      const isRec = !!ev.recurrence;
      const base = isRec ? item.start : new Date(ev.startAt);
      const end = ev.endAt ? (isRec ? item.end : new Date(ev.endAt)) : null;
      setAddModal({
        date: base,
        edit: {
          type: ev.kind as EditEvent["type"], id: ev.id, title: ev.title,
          date: toDateInput(new Date(ev.startAt)), startTime: toTimeStr(new Date(ev.startAt)),
          endTime: end ? toTimeStr(end) : "", isAllDay: ev.isAllDay, location: ev.location ?? "",
          person: ev.person ?? "", categoryId: ev.categoryId, reminderMinutes: ev.reminderMinutes,
          recurrenceKey: RECURRENCE_PRESETS.find((p) => p.rec && ev.recurrence && p.rec.freq === ev.recurrence.freq && p.rec.interval === ev.recurrence.interval)?.key ?? "none",
          notes: ev.notes ?? "",
        },
      });
    }
    setDetail(null);
  }

  async function dragToSlot(payload: { id: string; kind: string; dur: number; recurring?: boolean }, day: Date, minutes: number) {
    const snapped = Math.round(minutes / 15) * 15;
    const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), Math.floor(snapped / 60), snapped % 60);
    if (payload.kind.startsWith("task")) {
      const task = bundle.tasks.find((t) => t.id === payload.id);
      const durMs = (task?.estimatedMinutes ?? 60) * 60000;
      await scheduleOwnerTask(payload.id, start.toISOString(), new Date(start.getTime() + durMs).toISOString());
    } else if (!payload.recurring) {
      await updateOwnerEvent(payload.id, { startAt: start.toISOString(), endAt: new Date(start.getTime() + payload.dur * 60000).toISOString() });
    }
  }

  /* ---------- shared renderers ---------- */

  function blockStyle(item: CalItem): React.CSSProperties {
    const cat = catMap.get(item.categoryId ?? "");
    if (item.kind === "event" || !KIND_TINT[item.kind]) {
      const color = item.color ?? cat?.color ?? "#7cb0ff";
      return { backgroundColor: hexA(color, 0.2), borderLeft: `2.5px solid ${color}`, color: "var(--color-ow-text)" };
    }
    const t = KIND_TINT[item.kind];
    return { backgroundColor: t.bg, borderLeft: `2.5px solid ${t.border}`, color: t.text };
  }

  function timeGrid() {
    return (
      <div className="overflow-x-auto thin-scroll">
        <div className="min-w-[720px]" style={{ minWidth: `${180 + days.length * 128}px` }}>
          {/* day headers */}
          <div className="grid sticky top-0 z-10" style={{ gridTemplateColumns: `56px repeat(${days.length}, 1fr)`, borderBottom: "1px solid var(--color-ow-border)", background: "var(--color-ow-surface)" }}>
            <div />
            {days.map((d) => {
              const isToday = sameDay(d, now);
              return (
                <div key={d.toISOString()} className={`text-center py-2.5 cursor-pointer `} onClick={() => { setCursor(d); setView("day"); }}>
                  <p className="text-[12px] uppercase tracking-[0.1em] text-[var(--color-ow-text-faint)]">{d.toLocaleDateString("en-US", { weekday: "short" })}</p>
                  <p className="font-serif text-lg leading-tight text-[var(--color-ow-text)]">
                    <span className={isToday ? "rounded-full px-2.5 py-0.5" : ""} style={isToday ? { background: "var(--color-ow-accent)", color: "#ffffff" } : undefined}>{d.getDate()}</span>
                  </p>
                </div>
              );
            })}
          </div>
          {/* all-day row */}
          <div className="grid" style={{ gridTemplateColumns: `56px repeat(${days.length}, 1fr)`, borderBottom: "1px solid var(--color-ow-border)" }}>
            <div className="text-[12px] text-[var(--color-ow-text-faint)] text-right pr-2 py-1.5">all-day</div>
            {days.map((d) => (
              <div key={d.toISOString()} className="px-1 py-1.5 space-y-1 min-h-[30px] min-w-0 overflow-hidden" style={{ borderLeft: "1px solid var(--color-ow-border)" }}>
                {items.filter((i) => i.allDay && ymd(i.start) === ymd(d)).map((i) => (
                  <button key={i.key} onClick={() => setDetail(i)} className={`block w-full max-w-full text-left text-[12px] rounded-md px-1.5 py-1 truncate ${i.status === "done" ? "line-through ow-done-block" : ""}`} style={blockStyle(i)}>
                    {i.title}
                  </button>
                ))}
              </div>
            ))}
          </div>
          {/* time grid */}
          <div className="grid" style={{ gridTemplateColumns: `56px repeat(${days.length}, 1fr)` }}>
            <div className="relative" style={{ height: HOURS * 60 * PX }}>
              {Array.from({ length: HOURS + 1 }, (_, h) => (
                <p key={h} className="absolute right-2 text-[12px] text-[var(--color-ow-text-faint)] -translate-y-1/2 tnum" style={{ top: h * 60 * PX }}>
                  {h > 0 ? fmtTime(new Date(2000, 0, 1, START_MIN / 60 + h, 0), tf).replace(":00", "") : ""}
                </p>
              ))}
            </div>
            {days.map((d) => {
              const dayItems = items.filter((i) => !i.allDay && ymd(i.start) === ymd(d));
              const conflicts = findConflicts(items, d);
              const whToday: [number, number] | null = wh[d.getDay()] ?? [480, 1080];
              const isToday = sameDay(d, now);
              const nowY = (minutesOf(now) - START_MIN) * PX;
              return (
                <div
                  key={d.toISOString()}
                  className="relative"
                  style={{ height: HOURS * 60 * PX, borderLeft: "1px solid var(--color-ow-border)", background: isToday ? "var(--color-ow-accent-soft)" : undefined }}
                  onDragOver={(e) => e.preventDefault()}
                  onDoubleClick={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    const mins = START_MIN + (e.clientY - rect.top) / PX;
                    const snapped = Math.round(mins / 30) * 30;
                    setAddModal({ date: d, time: `${String(Math.floor(snapped / 60)).padStart(2, "0")}:${String(snapped % 60).padStart(2, "0")}` });
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    try {
                      const payload = JSON.parse(e.dataTransfer.getData("application/json"));
                      const rect = e.currentTarget.getBoundingClientRect();
                      dragToSlot(payload, d, START_MIN + (e.clientY - rect.top) / PX);
                    } catch { /* not ours */ }
                  }}
                >
                  {/* working hours shading */}
                  {whToday && whToday[0] > START_MIN && (
                    <div className="absolute inset-x-0 top-0" style={{ height: (whToday[0] - START_MIN) * PX, background: "rgba(0,0,0,0.22)" }} />
                  )}
                  {whToday && whToday[1] < END_MIN && (
                    <div className="absolute inset-x-0 bottom-0" style={{ top: (whToday[1] - START_MIN) * PX, background: "rgba(0,0,0,0.22)" }} />
                  )}
                  {!whToday && <div className="absolute inset-0" style={{ background: "rgba(0,0,0,0.22)" }} />}
                  {Array.from({ length: HOURS }, (_, h) => (
                    <div key={h} className="absolute inset-x-0" style={{ top: h * 60 * PX, borderTop: "1px solid var(--color-ow-border)" }} />
                  ))}
                  {isToday && nowY >= 0 && nowY <= HOURS * 60 * PX && (
                    <div className="absolute inset-x-0 z-10 pointer-events-none" style={{ top: nowY }}>
                      <div className="h-[1.5px]" style={{ background: "var(--color-ow-rose)" }} />
                      <div className="w-2 h-2 rounded-full -mt-[4.5px] -ml-0.5" style={{ background: "var(--color-ow-rose)" }} />
                    </div>
                  )}
                  {dayItems.map((i, idx) => {
                    const top = Math.max(0, (minutesOf(i.start) - START_MIN)) * PX;
                    const dur = i.end ? (i.end.getTime() - i.start.getTime()) / 60000 : 30;
                    const hgt = Math.max(20, dur * PX - 2);
                    const conflicted = conflicts.some((c) => c.a === i.key || c.b === i.key);
                    return (
                      <button
                        key={i.key}
                        draggable={!i.recurring}
                        onDragStart={(e) => e.dataTransfer.setData("application/json", JSON.stringify({ id: i.sourceId, kind: i.kind, dur, recurring: i.recurring }))}
                        onClick={() => setDetail(i)}
                        className={`absolute inset-x-1 rounded-md px-1.5 py-1 text-left overflow-hidden transition-shadow hover:shadow-md cursor-pointer ${i.status === "done" ? "ow-done-block line-through" : ""}`}
                        style={{ top, height: hgt, ...blockStyle(i), zIndex: 5 + idx, boxShadow: conflicted ? "0 0 0 1px var(--color-ow-rose)" : undefined }}
                      >
                        <p className="text-[12px] font-medium leading-tight truncate">{i.title}</p>
                        {hgt > 34 && <p className="text-[12px] tnum">{fmtTime(i.start, tf)}{i.recurring ? " ↻" : ""}</p>}
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  function monthGrid() {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const start = addDays(first, -((first.getDay() - weekStart + 7) % 7));
    const cells = Array.from({ length: 42 }, (_, i) => addDays(start, i));
    return (
      <div>
        <div className="grid grid-cols-7 text-[12px] uppercase tracking-[0.1em] text-[var(--color-ow-text-faint)] pb-2">
          {Array.from({ length: 7 }, (_, i) => addDays(start, i)).map((d) => (
            <p key={d.toISOString()} className="text-center">{d.toLocaleDateString("en-US", { weekday: "short" })}</p>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {cells.map((d) => {
            const inMonth = d.getMonth() === cursor.getMonth();
            const dayItems = items.filter((i) => ymd(i.start) === ymd(d));
            const isToday = sameDay(d, now);
            return (
              <div key={d.toISOString()}
                onClick={() => { setCursor(d); setView("day"); }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  try {
                    const payload = JSON.parse(e.dataTransfer.getData("application/json"));
                    if (payload.kind.startsWith("task")) {
                      scheduleOwnerTask(payload.id, new Date(d.getFullYear(), d.getMonth(), d.getDate(), 9, 0).toISOString(), null);
                    }
                  } catch { /* ignore */ }
                }}
                className="min-h-[92px] rounded-xl p-1.5 cursor-pointer transition"
                style={{
                  background: inMonth ? "var(--color-ow-surface-2)" : "transparent",
                  border: isToday ? "1.5px solid var(--color-ow-accent)" : "1px solid var(--color-ow-border)",
                }}>
                <p className="text-[12px] tnum mb-1" style={{ color: isToday ? "var(--color-ow-accent-text)" : inMonth ? "var(--color-ow-text)" : "var(--color-ow-text-faint)", fontWeight: isToday ? 700 : 400 }}>{d.getDate()}</p>
                <div className="space-y-0.5">
                  {dayItems.slice(0, 3).map((i) => (
                    <button type="button" key={i.key} onClick={(e) => { e.stopPropagation(); setDetail(i); }}
                      className={`block w-full text-left text-[12px] truncate rounded px-1 py-0.5 ${i.status === "done" ? "line-through ow-done-block" : ""}`} style={blockStyle(i)}>
                      {i.title}
                    </button>
                  ))}
                  {dayItems.length > 3 && <p className="text-[12px] text-[var(--color-ow-text-faint)] pl-1">+{dayItems.length - 3} more</p>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  function agendaList() {
    const from = cursor;
    return (
      <div className="space-y-6">
        {Array.from({ length: 14 }, (_, i) => addDays(from, i)).map((d) => {
          const dayItems = items.filter((i) => ymd(i.start) === ymd(d)).sort((a, b) => (a.allDay === b.allDay ? a.start.getTime() - b.start.getTime() : a.allDay ? -1 : 1));
          if (dayItems.length === 0) return null;
          const isToday = sameDay(d, now);
          return (
            <div key={d.toISOString()}>
              <p className="text-[12px] uppercase tracking-[0.1em] mb-2" style={{ color: isToday ? "var(--color-ow-accent-text)" : "var(--color-ow-text-faint)", fontWeight: isToday ? 600 : 400 }}>
                {fmtDate(d)} {isToday && "· Today"}
              </p>
              <ul className="space-y-1.5">
                {dayItems.map((i) => (
                  <li key={i.key}>
                    <button onClick={() => setDetail(i)} className={`w-full flex items-center gap-3 card-ow card-ow-hover px-3.5 py-2.5 text-left transition ${i.status === "done" ? "ow-done-block" : ""}`}>
                      <span className="w-16 shrink-0 text-[12px] text-[var(--color-ow-text-dim)] tnum">{i.allDay ? "All day" : fmtTime(i.start, tf)}</span>
                      <span className="w-1 h-4 rounded-full shrink-0" style={{ background: (blockStyle(i).borderLeft as string | undefined)?.split(" ").pop() ?? "#7cb0ff" }} />
                      <span className={`text-[13px] truncate text-[var(--color-ow-text)] ${i.status === "done" ? "line-through" : ""}`}>{i.title}</span>
                      {i.recurring && <span className="text-[12px] text-[var(--color-ow-text-faint)]">↻</span>}
                      <span className="ml-auto text-[12px] text-[var(--color-ow-text-faint)] shrink-0 hidden sm:block">{i.location ?? ""}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    );
  }

  const title = view === "month" ? fmtMonthYear(cursor)
    : view === "week" ? `${fmtDate(weekDays[0])} — ${fmtDate(weekDays[weekDays.length - 1])}`
    : view === "day" ? fmtDate(cursor)
    : "Agenda";

  /* ============ layout ============ */
  return (
    <div className="p-4 sm:p-6 max-w-[1500px] mx-auto">
      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-2.5 mb-5">
        <div className="flex items-center gap-1 mr-1">
          <button aria-label="Previous" onClick={() => nav(-1)} className="ow-icon-btn transition text-[var(--color-ow-text-dim)] hover:bg-white/[0.06]"><ChevronLeft size={16} /></button>
          <button onClick={() => setCursor(new Date())} className="text-[13px] rounded-[10px] px-3.5 min-h-11 transition text-[var(--color-ow-text-dim)] hover:text-[var(--color-ow-text)] hover:bg-white/[0.05]" style={{ border: "1px solid var(--color-ow-border-strong)" }}>Today</button>
          <button aria-label="Next" onClick={() => nav(1)} className="ow-icon-btn transition text-[var(--color-ow-text-dim)] hover:bg-white/[0.06]"><ChevronRight size={16} /></button>
        </div>
        <h1 className="font-serif text-xl sm:text-2xl mr-auto text-[var(--color-ow-text)]">{title}</h1>
        <div className="relative max-sm:w-full max-sm:order-last">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-ow-text-faint)]" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search…" aria-label="Search calendar" className="input-ow !w-44 max-sm:!w-full !pl-8 !text-[14px]" />
          {searchResults.length > 0 && (
            <div className="absolute right-0 top-11 w-72 card-ow p-1.5 z-30 max-h-80 overflow-auto thin-scroll">
              {searchResults.map((r, i) => r.type === "item" ? (
                <button key={i} onClick={() => { setCursor(r.item.start); setView("day"); setDetail(r.item); setSearch(""); }}
                  className="w-full text-left px-3 min-h-11 py-1.5 rounded-lg hover:bg-white/[0.06]">
                  <p className="text-[13px] truncate text-[var(--color-ow-text)]">{r.item.title}</p>
                  <p className="text-[12px] text-[var(--color-ow-text-faint)]">{fmtDate(r.item.start)} · {r.item.kind}</p>
                </button>
              ) : (
                <button key={i} onClick={() => { setAddModal({ date: new Date(), edit: taskToEdit(r.task) }); setSearch(""); }}
                  className="w-full text-left px-3 py-2 rounded-lg hover:bg-white/[0.06]">
                  <p className="text-[13px] truncate text-[var(--color-ow-text)]">{r.task.title}</p>
                  <p className="text-[12px] text-[var(--color-ow-text-faint)]">task · {r.task.status}</p>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="flex rounded-xl p-1 gap-1" role="group" aria-label="Calendar view" style={{ background: "var(--color-ow-surface-2)", border: "1px solid var(--color-ow-border)" }}>
          {(["day", "week", "month", "agenda"] as View[]).map((v) => (
            <button key={v} onClick={() => setView(v)} aria-pressed={view === v}
              className="px-3 min-h-10 rounded-lg text-[13px] capitalize transition hover:bg-white/[0.05]"
              style={view === v ? { background: "var(--color-ow-accent-soft)", color: "var(--color-ow-accent-text)", fontWeight: 500 } : { color: "var(--color-ow-text-dim)" }}>
              {v}
            </button>
          ))}
        </div>
        <button onClick={() => setAddModal({ date: cursor })}
          className="btn-ow-primary flex items-center gap-1.5 text-[14px] rounded-[10px] px-5">
          <Plus size={14} /> Add
        </button>
      </div>

      {/* filters */}
      <div className="flex flex-wrap items-center gap-2 mb-5 text-[13px]">
        {[["all", "Everything"], ["appointments", "Appointments"], ["tasks", "Tasks"], ["focus", "Focus"]].map(([k, l]) => (
          <button key={k} onClick={() => setKindFilter(k)} aria-pressed={kindFilter === k}
            className="rounded-full px-4 min-h-11 border transition hover:bg-white/[0.05]"
            style={kindFilter === k
              ? { background: "var(--color-ow-accent-soft)", borderColor: "var(--color-ow-accent)", color: "var(--color-ow-accent-text)" }
              : { borderColor: "var(--color-ow-border-strong)", color: "var(--color-ow-text-dim)" }}>
            {l}
          </button>
        ))}
        <select aria-label="Category filter" value={catFilter} onChange={(e) => setCatFilter(e.target.value)} className="input-ow !w-auto !text-[13px] !rounded-full">
          <option value="all">All categories</option>
          {bundle.categories.filter((c) => !c.hidden).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <button onClick={() => setShowDone(!showDone)} aria-pressed={showDone}
          className="rounded-full px-4 min-h-11 border transition hover:bg-white/[0.05]"
          style={showDone ? { borderColor: "var(--color-ow-border-strong)", color: "var(--color-ow-text-dim)" } : { background: "var(--color-ow-surface-2)", borderColor: "var(--color-ow-border-strong)", color: "var(--color-ow-text)" }}>
          {showDone ? "Showing completed" : "Completed hidden"}
        </button>
      </div>

      <div className="grid xl:grid-cols-[minmax(0,1fr)_264px] gap-5 items-start">
        <div className="card-ow p-3 sm:p-4 overflow-hidden">
          {view === "month" ? monthGrid() : view === "agenda" ? agendaList() : timeGrid()}
          {view !== "month" && view !== "agenda" && (
            <p className="text-[12px] text-[var(--color-ow-text-faint)] mt-2 pl-14">Double-click a time slot to add · drag tasks from the right panel onto the grid</p>
          )}
        </div>

        {/* right rail */}
        <div className="space-y-4 hidden xl:block">
          {/* mini calendar */}
          <div className="card-ow p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[12px] uppercase tracking-[0.1em] text-[var(--color-ow-text-faint)]">{fmtMonthYear(cursor)}</p>
              <div className="flex gap-0.5">
                <button aria-label="Previous month" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))} className="ow-icon-btn text-[var(--color-ow-text-dim)] hover:bg-white/[0.06]"><ChevronLeft size={13} /></button>
                <button aria-label="Next month" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))} className="ow-icon-btn text-[var(--color-ow-text-dim)] hover:bg-white/[0.06]"><ChevronRight size={13} /></button>
              </div>
            </div>
            <div className="grid grid-cols-7 gap-0.5 text-center text-[12px]">
              {(() => {
                const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
                const start = addDays(first, -((first.getDay() - weekStart + 7) % 7));
                return Array.from({ length: 42 }, (_, i) => addDays(start, i)).map((d) => {
                  const has = bundle.items.some((it) => ymd(it.start) === ymd(d));
                  const sel = sameDay(d, cursor);
                  const tod = sameDay(d, now);
                  return (
                    <button key={d.toISOString()} onClick={() => setCursor(d)}
                      className="relative aspect-square rounded-lg text-[12px] tnum transition"
                      style={sel
                        ? { background: "var(--color-ow-accent)", color: "#ffffff" }
                        : tod
                        ? { background: "var(--color-ow-surface-2)", color: "var(--color-ow-text)" }
                        : d.getMonth() === cursor.getMonth()
                        ? { color: "var(--color-ow-text-dim)" }
                        : { color: "var(--color-ow-text-faint)" }}>
                      {d.getDate()}
                      {has && !sel && <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full" style={{ background: "var(--color-ow-accent-text)" }} />}
                    </button>
                  );
                });
              })()}
            </div>
          </div>

          {/* unscheduled */}
          <div className="card-ow p-4">
            <p className="text-[12px] uppercase tracking-[0.1em] text-[var(--color-ow-text-faint)] mb-2.5">Unscheduled · {unscheduled.length}</p>
            <ul className="space-y-1.5 max-h-[300px] overflow-auto thin-scroll">
              {unscheduled.slice(0, 12).map((t) => (
                <li key={t.id} draggable
                  onDragStart={(e) => e.dataTransfer.setData("application/json", JSON.stringify({ id: t.id, kind: "task-block", dur: (t.estimatedMinutes ?? 60) }))}
                  className="flex items-center gap-2 rounded-lg px-2.5 py-2 cursor-grab active:cursor-grabbing group" style={{ background: "var(--color-ow-surface-2)" }}>
                  <TaskCheck done={false} onToggle={() => setOwnerTaskDone(t.id, true)} />
                  <span className="text-[12px] leading-snug flex-1 truncate flex items-center gap-1.5 text-[var(--color-ow-text)]"><PriorityDot priority={t.priority} />{t.title}</span>
                </li>
              ))}
              {unscheduled.length === 0 && <li className="text-[12px] text-[var(--color-ow-text-dim)]">Every task has a place.</li>}
            </ul>
          </div>
        </div>
      </div>

      {/* ============ detail modal ============ */}
      {detail && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-6">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm anim-fade-in" onClick={() => setDetail(null)} />
          <div role="dialog" aria-modal="true" aria-label={detail.title} className="relative card-ow rounded-t-2xl sm:rounded-2xl p-6 w-full max-w-sm anim-sheet">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[12px] uppercase tracking-[0.2em] text-[var(--color-ow-text-faint)]">
                  {detail.kind === "task-block" ? "Scheduled task" : detail.kind === "task-due" ? "Task due" : detail.kind}
                  {detail.recurring ? " · recurring ↻" : ""}
                </p>
                <h3 className="font-serif text-xl mt-1.5 text-[var(--color-ow-text)]">{detail.title}</h3>
                <p className="text-[12px] text-[var(--color-ow-text-dim)] mt-1.5 tnum">
                  {fmtDate(detail.start)} {detail.allDay ? "· all day" : `· ${fmtTime(detail.start, tf)}${detail.end ? ` – ${fmtTime(detail.end, tf)}` : ""}`}
                </p>
                {(detail.location || detail.person) && (
                  <p className="text-[12px] text-[var(--color-ow-text-dim)] mt-1">{detail.location} {detail.person ? `· ${detail.person}` : ""}</p>
                )}
                <div className="mt-2"><CategoryChip category={catMap.get(detail.categoryId ?? "")} /></div>
              </div>
              <button aria-label="Close details" onClick={() => setDetail(null)} className="ow-icon-btn text-[var(--color-ow-text-faint)] hover:text-[var(--color-ow-text)]"><X size={16} /></button>
            </div>

            {detail.kind.startsWith("task") ? (
              <div className="mt-5 space-y-2">
                <button onClick={() => { const t = bundle.tasks.find((x) => x.id === detail.sourceId); setOwnerTaskDone(detail.sourceId, t?.status !== "done"); setDetail(null); }}
                  className="w-full flex items-center gap-2.5 text-[13px] rounded-[10px] min-h-11 px-3.5 transition"
                  style={{ background: "var(--color-ow-accent-soft)", color: "var(--color-ow-accent-text)", border: "1px solid rgba(143,179,255,0.35)" }}>
                  <CheckCheck size={15} /> {bundle.tasks.find((x) => x.id === detail.sourceId)?.status === "done" ? "Mark not done" : "Mark complete"}
                </button>
                {detail.kind === "task-block" && (
                  <button onClick={() => { scheduleOwnerTask(detail.sourceId, null, null); setDetail(null); }}
                    className="w-full flex items-center gap-2.5 text-[13px] rounded-[10px] min-h-11 px-3.5 transition text-[var(--color-ow-text-dim)] hover:text-[var(--color-ow-text)]"
                    style={{ border: "1px solid var(--color-ow-border-strong)" }}>
                    <AlarmClockOff size={15} className="text-[var(--color-ow-text-faint)]" /> Back to unscheduled
                  </button>
                )}
                <div className="flex gap-2">
                  <button onClick={() => openEdit(detail)} className="flex-1 flex items-center justify-center gap-2 text-[13px] rounded-[10px] min-h-11 transition hover:brightness-125 text-[var(--color-ow-text-dim)] hover:text-[var(--color-ow-text)]" style={{ border: "1px solid var(--color-ow-border-strong)" }}><Pencil size={13} /> Edit</button>
                  <button onClick={() => { cancelOwnerTask(detail.sourceId); setDetail(null); }} className="flex-1 flex items-center justify-center gap-2 text-[13px] rounded-[10px] min-h-11 transition hover:brightness-125" style={{ color: "var(--color-ow-rose)", border: "1px solid rgba(251,113,133,0.4)" }}><Trash2 size={13} /> Cancel task</button>
                </div>
              </div>
            ) : (
              <div className="mt-5 space-y-2">
                <button onClick={() => detail.recurring ? setScope({ item: detail, action: "complete" }) : (completeOwnerEvent(detail.sourceId, "series"), setDetail(null))}
                  className="w-full flex items-center gap-2.5 text-[13px] rounded-[10px] min-h-11 px-3.5 transition"
                  style={{ background: "var(--color-ow-accent-soft)", color: "var(--color-ow-accent-text)", border: "1px solid rgba(143,179,255,0.35)" }}>
                  <CheckCheck size={15} /> Mark done
                </button>
                <div className="flex gap-2">
                  <button onClick={() => openEdit(detail)} className="flex-1 flex items-center justify-center gap-2 text-[13px] rounded-[10px] min-h-11 transition hover:brightness-125 text-[var(--color-ow-text-dim)] hover:text-[var(--color-ow-text)]" style={{ border: "1px solid var(--color-ow-border-strong)" }}><Pencil size={13} /> Edit</button>
                  <button onClick={() => { duplicateOwnerEvent(detail.sourceId); setDetail(null); }} className="flex-1 flex items-center justify-center gap-2 text-[13px] rounded-[10px] min-h-11 transition hover:brightness-125 text-[var(--color-ow-text-dim)] hover:text-[var(--color-ow-text)]" style={{ border: "1px solid var(--color-ow-border-strong)" }}><CopyPlus size={13} /> Duplicate</button>
                  <button onClick={() => detail.recurring ? setScope({ item: detail, action: "delete" }) : (deleteOwnerEvent(detail.sourceId, "series"), setDetail(null))}
                    className="flex-1 flex items-center justify-center gap-2 text-[13px] rounded-[10px] min-h-11 transition hover:brightness-125" style={{ color: "var(--color-ow-rose)", border: "1px solid rgba(251,113,133,0.4)" }}><Trash2 size={13} /> Delete</button>
                </div>
                {/* nudge */}
                {!detail.recurring && !detail.allDay && (
                  <div className="flex gap-2 pt-1">
                    {[-15, 15].map((delta) => (
                      <button key={delta} onClick={async () => {
                        const ev = bundle.events.find((e) => e.id === detail.sourceId);
                        if (!ev) return;
                        const s = new Date(ev.startAt.getTime() + delta * 60000);
                        await updateOwnerEvent(ev.id, { startAt: s.toISOString(), endAt: ev.endAt ? new Date(ev.endAt.getTime() + delta * 60000).toISOString() : null });
                        setDetail(null);
                      }} className="flex-1 text-[12px] rounded-[10px] min-h-11 transition flex items-center justify-center gap-1 text-[var(--color-ow-text-dim)] hover:text-[var(--color-ow-text)]" style={{ border: "1px solid var(--color-ow-border-strong)" }}>
                        {delta < 0 ? <Minus size={11} /> : <PlusSm size={11} />} {Math.abs(delta)}m
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* scope choice */}
      {scope && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-5">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setScope(null)} />
          <div role="dialog" aria-modal="true" aria-label="Recurring item" className="relative card-ow p-6 max-w-xs w-full anim-sheet">
            <p className="font-serif text-lg text-[var(--color-ow-text)]">Recurring item</p>
            <p className="text-[13px] text-[var(--color-ow-text-dim)] mt-1.5">{scope.action === "complete" ? "Mark done" : "Delete"} — apply to?</p>
            <div className="mt-4 space-y-2">
              <button onClick={async () => {
                if (scope.action === "complete") await completeOwnerEvent(scope.item.sourceId, "occurrence", ymd(scope.item.start));
                else await deleteOwnerEvent(scope.item.sourceId, "occurrence", ymd(scope.item.start));
                setScope(null); setDetail(null);
              }} className="w-full text-[13px] rounded-[10px] min-h-11 transition hover:brightness-125 text-[var(--color-ow-text-dim)] hover:text-[var(--color-ow-text)]" style={{ border: "1px solid var(--color-ow-border-strong)" }}>Just this occurrence</button>
              <button onClick={async () => {
                if (scope.action === "complete") await completeOwnerEvent(scope.item.sourceId, "series");
                else await deleteOwnerEvent(scope.item.sourceId, "series");
                setScope(null); setDetail(null);
              }} className="btn-ow-primary w-full text-[13px] rounded-xl py-2.5">Whole series</button>
            </div>
          </div>
        </div>
      )}

      <ItemModal
        open={!!addModal}
        onClose={() => setAddModal(null)}
        categories={bundle.categories}
        edit={addModal?.edit}
        defaultDate={addModal?.date}
        defaultTime={addModal?.time}
      />
    </div>
  );
}
