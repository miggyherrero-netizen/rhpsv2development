"use client";

import { useState } from "react";
import { Save, Plus, Trash2, Eye, EyeOff, KeyRound } from "lucide-react";
import type { OwnerCategory, OwnerPreference } from "@/db/schema";
import { CATEGORY_COLORS, DAYS_SHORT } from "@/lib/config";
import { Spinner } from "@/components/ui";
import { updatePreferences, createCategory, updateCategory, deleteCategory, type PrefsPatch } from "@/server/owner";
import { resetLoginGatePin } from "@/server/auth-actions";
import type { WorkingHours } from "@/lib/owner-utils";

const minToStr = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const strToMin = (s: string) => { const [h, m] = s.split(":").map(Number); return (h || 0) * 60 + (m || 0); };

export default function OwnerSettingsClient({ categories, prefs }: { categories: OwnerCategory[]; prefs: OwnerPreference | null }) {
  const [form, setForm] = useState<PrefsPatch>({
    defaultView: prefs?.defaultView ?? "week",
    weekStart: prefs?.weekStart ?? 1,
    timeFormat: prefs?.timeFormat ?? "12h",
    defaultEventMinutes: prefs?.defaultEventMinutes ?? 60,
    defaultTaskPriority: prefs?.defaultTaskPriority ?? "normal",
    showWeekends: prefs?.showWeekends ?? true,
    showCompleted: prefs?.showCompleted ?? true,
    workingHours: (prefs?.workingHours ?? { 0: null, 1: [480, 1080], 2: [480, 1080], 3: [480, 1080], 4: [480, 1080], 5: [480, 1080], 6: [540, 840] }) as WorkingHours,
  });
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [pin, setPin] = useState("");
  const [pinBusy, setPinBusy] = useState(false);
  const [pinMessage, setPinMessage] = useState("");
  const [newCat, setNewCat] = useState({ name: "", color: CATEGORY_COLORS[0] });

  const wh = (form.workingHours ?? {}) as WorkingHours;
  const setWh = (day: number, val: [number, number] | null) =>
    setForm({ ...form, workingHours: { ...wh, [day]: val } });

  async function save() {
    setBusy(true);
    await updatePreferences(form);
    setBusy(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 1600);
  }

  async function savePin() {
    setPinBusy(true);
    setPinMessage("");
    const res = await resetLoginGatePin(pin);
    setPinBusy(false);
    if (res.ok) {
      setPin("");
      setPinMessage("PIN updated.");
      setTimeout(() => setPinMessage(""), 1800);
    } else {
      setPinMessage(res.error ?? "Could not update PIN.");
    }
  }

  const inp = "input-ow";
  const sel = `${inp} !w-auto`;

  return (
    <div className="p-4 sm:p-7 app-page app-page-narrow [--page-w:672px]">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-serif text-2xl sm:text-3xl text-[var(--color-ow-text)]">Workspace settings</h1>
          <p className="text-[var(--color-ow-text-dim)] text-[13px] mt-1">Shape the space around the way you work.</p>
        </div>
        <button onClick={save} disabled={busy} className="btn-ow-primary flex items-center gap-2 text-[14px] rounded-[10px] px-5 shrink-0">
          {busy ? <Spinner /> : <Save size={14} />} {saved ? "Saved" : "Save all"}
        </button>
      </div>

      <div className="space-y-4">
        <section className="card-ow p-5">
          <p className="text-[12px] uppercase tracking-[0.1em] text-[var(--color-ow-text-faint)] mb-4">General</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <label className="text-[12px] text-[var(--color-ow-text-dim)]">Default view
              <select className="input-ow mt-1" value={form.defaultView} onChange={(e) => setForm({ ...form, defaultView: e.target.value })}>
                <option value="day">Day</option><option value="week">Week</option><option value="month">Month</option><option value="agenda">Agenda</option>
              </select>
            </label>
            <label className="text-[12px] text-[var(--color-ow-text-dim)]">Week starts
              <select className="input-ow mt-1" value={form.weekStart} onChange={(e) => setForm({ ...form, weekStart: Number(e.target.value) })}>
                <option value={1}>Monday</option><option value={0}>Sunday</option>
              </select>
            </label>
            <label className="text-[12px] text-[var(--color-ow-text-dim)]">Clock format
              <select className="input-ow mt-1" value={form.timeFormat} onChange={(e) => setForm({ ...form, timeFormat: e.target.value })}>
                <option value="12h">12-hour</option><option value="24h">24-hour</option>
              </select>
            </label>
            <label className="text-[12px] text-[var(--color-ow-text-dim)]">Default duration
              <select className="input-ow mt-1" value={form.defaultEventMinutes} onChange={(e) => setForm({ ...form, defaultEventMinutes: Number(e.target.value) })}>
                <option value={30}>30 min</option><option value={45}>45 min</option><option value={60}>1 hour</option><option value={90}>1.5 hours</option>
              </select>
            </label>
          </div>
          <div className="flex flex-wrap gap-2 mt-4">
            {([["showWeekends", "Show weekends"], ["showCompleted", "Show completed"]] as const).map(([k, label]) => (
              <button key={k} onClick={() => setForm({ ...form, [k]: !form[k] })}
                className="text-[13px] rounded-full px-4 min-h-11 border transition hover:bg-white/[0.05]"
                style={form[k]
                  ? { background: "var(--color-ow-accent-soft)", borderColor: "var(--color-ow-accent)", color: "var(--color-ow-accent-text)" }
                  : { borderColor: "var(--color-ow-border-strong)", color: "var(--color-ow-text-dim)" }}>
                {label} {form[k] ? "✓" : ""}
              </button>
            ))}
            <label className="text-[12px] text-[var(--color-ow-text-dim)] flex items-center gap-2 rounded-full px-4 min-h-11 border" style={{ borderColor: "var(--color-ow-border-strong)" }}>
              Default priority
              <select className="bg-transparent outline-none text-[var(--color-ow-text)] min-h-11" value={form.defaultTaskPriority} onChange={(e) => setForm({ ...form, defaultTaskPriority: e.target.value })}>
                <option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option>
              </select>
            </label>
          </div>
        </section>

        <section className="card-ow p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[12px] uppercase tracking-[0.1em] text-[var(--color-ow-text-faint)] mb-1.5 flex items-center gap-2">
                <KeyRound size={13} /> Login access PIN
              </p>
              <p className="text-[12px] text-[var(--color-ow-text-dim)]">Used by the lock button before the login page opens. Default is 0000 until you change it.</p>
            </div>
          </div>
          <div className="grid sm:grid-cols-[1fr_auto] gap-2.5 mt-4">
            <input
              className={inp}
              aria-label="New 4-digit PIN"
              inputMode="numeric"
              maxLength={4}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
              placeholder="New 4-digit PIN"
            />
            <button
              onClick={savePin}
              disabled={pinBusy || pin.length !== 4}
              className="btn-ow-primary flex items-center justify-center gap-2 text-[14px] rounded-[10px] px-5"
            >
              {pinBusy ? <Spinner /> : <Save size={14} />} Reset PIN
            </button>
          </div>
          {pinMessage && <p className="text-[12px] mt-2 text-[var(--color-ow-text-dim)]">{pinMessage}</p>}
        </section>

        <section className="card-ow p-5">
          <p className="text-[12px] uppercase tracking-[0.1em] text-[var(--color-ow-text-faint)] mb-1.5">Working hours</p>
          <p className="text-[12px] text-[var(--color-ow-text-dim)] mb-4">Visual guidance only — you can schedule anything outside these hours.</p>
          <div className="space-y-2">
            {[1, 2, 3, 4, 5, 6, 0].map((day) => {
              const val = wh[day] ?? null;
              return (
                <div key={day} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="w-10 text-[13px] text-[var(--color-ow-text)]">{DAYS_SHORT[day]}</span>
                  {val ? (
                    <>
                      <input type="time" aria-label={`${DAYS_SHORT[day]} start time`} className={sel} value={minToStr(val[0])} onChange={(e) => setWh(day, [strToMin(e.target.value), val[1]])} />
                      <span className="text-[var(--color-ow-text-faint)]">–</span>
                      <input type="time" aria-label={`${DAYS_SHORT[day]} end time`} className={sel} value={minToStr(val[1])} onChange={(e) => setWh(day, [val[0], strToMin(e.target.value)])} />
                      <button onClick={() => setWh(day, null)} className="text-[13px] text-[var(--color-ow-text-dim)] hover:text-[var(--color-ow-rose)] transition ml-1 min-h-11 px-2">day off</button>
                    </>
                  ) : (
                    <button onClick={() => setWh(day, [480, 1080])} className="text-[13px] rounded-[10px] px-3 min-h-11 transition text-[var(--color-ow-text-dim)] hover:text-[var(--color-ow-text)] hover:bg-white/[0.04]"
                      style={{ border: "1px dashed var(--color-ow-border-strong)" }}>Day off — set hours</button>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        <section className="card-ow p-5">
          <p className="text-[12px] uppercase tracking-[0.1em] text-[var(--color-ow-text-faint)] mb-4">Categories</p>
          <ul className="space-y-2">
            {categories.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="w-4 h-4 rounded-full shrink-0" style={{ backgroundColor: c.color, border: "1px solid rgba(255,255,255,0.15)" }} />
                <input aria-label={`Category name: ${c.name}`} className="bg-transparent outline-none text-[14px] flex-1 min-w-[8rem] min-h-11 border-b border-transparent transition text-[var(--color-ow-text)] hover:border-[var(--color-ow-border-strong)] focus:border-[var(--color-ow-accent-text)]"
                  defaultValue={c.name} onBlur={(e) => e.target.value.trim() && e.target.value !== c.name && updateCategory(c.id, { name: e.target.value.trim() })} />
                <div className="flex flex-wrap shrink-0">
                  {CATEGORY_COLORS.slice(0, 6).map((col) => (
                    <button key={col} onClick={() => updateCategory(c.id, { color: col })} aria-pressed={c.color === col}
                      className="ow-swatch" style={{ "--sw": col } as React.CSSProperties} aria-label={`Colour ${col}`} />
                  ))}
                </div>
                <button onClick={() => updateCategory(c.id, { hidden: !c.hidden })} className="ow-icon-btn transition text-[var(--color-ow-text-faint)] hover:text-[var(--color-ow-text)]" title={c.hidden ? "Unhide" : "Hide"} aria-label={c.hidden ? `Unhide ${c.name}` : `Hide ${c.name}`}>
                  {c.hidden ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
                <button onClick={() => { if (confirm(`Delete “${c.name}”? Items keep their history but lose the category.`)) deleteCategory(c.id, null); }}
                  aria-label={`Delete ${c.name}`} className="ow-icon-btn transition text-[var(--color-ow-text-faint)] hover:text-[var(--color-ow-rose)]"><Trash2 size={14} /></button>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center gap-2.5 mt-4 pt-4" style={{ borderTop: "1px solid var(--color-ow-border)" }}>
            <input value={newCat.name} onChange={(e) => setNewCat({ ...newCat, name: e.target.value })} placeholder="New category…" aria-label="New category name" className={`${inp} flex-1 min-w-[10rem]`} />
            <div className="flex flex-wrap">
              {CATEGORY_COLORS.map((col) => (
                <button key={col} onClick={() => setNewCat({ ...newCat, color: col })} aria-pressed={newCat.color === col}
                  className="ow-swatch" style={{ "--sw": col } as React.CSSProperties} aria-label={`New category colour ${col}`} />
              ))}
            </div>
            <button onClick={async () => { if (newCat.name.trim()) { await createCategory(newCat.name.trim(), newCat.color); setNewCat({ name: "", color: CATEGORY_COLORS[0] }); } }}
              className="btn-ow-primary flex items-center gap-1.5 text-[14px] rounded-[10px] px-4 shrink-0">
              <Plus size={13} /> Add
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
