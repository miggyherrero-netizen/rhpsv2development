"use client";

import { useCallback, useEffect, useState } from "react";
import { Delete, Lock, LogOut, Play, CheckCircle2, PackageOpen, Clock, ArrowLeft, RefreshCw, Coffee } from "lucide-react";
import {
  verifyWorkerPin, getWorkerState, signOutWorker, clockIn, clockOut,
  startTask, finishTask, startBreak, endBreak,
  type KioskWorker, type WorkerState, type KioskTask,
} from "@/server/workshop";
import { Avatar, Drawer, Spinner, EmptyState } from "@/components/ui";
import { LiveEarnings, DurationTicker } from "@/components/tickers";
import { PRIORITY_STYLE } from "@/lib/config";
import { fmtDuration, fmtTime } from "@/lib/format";

type Phase = "select" | "pin" | "dash";

function TaskChip({ t }: { t: KioskTask }) {
  const p = PRIORITY_STYLE[t.priority] ?? PRIORITY_STYLE.normal;
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs uppercase tracking-wide ${p.text}`}>
      <span className={`w-2 h-2 rounded-full ${p.dot}`} aria-hidden="true" /> {p.label}
    </span>
  );
}

export default function WorkshopKiosk({ workers }: { workers: KioskWorker[] }) {
  const [phase, setPhase] = useState<Phase>("select");
  const [selected, setSelected] = useState<KioskWorker | null>(null);
  const [pin, setPin] = useState("");
  const [pinError, setPinError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<WorkerState | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [actionError, setActionError] = useState("");

  const refresh = useCallback(async () => {
    const s = await getWorkerState();
    if (s) setState(s);
    else { setState(null); setPhase("select"); setSelected(null); }
  }, []);

  useEffect(() => {
    if (phase !== "dash") return;
    const t = setInterval(refresh, 30_000);
    return () => clearInterval(t);
  }, [phase, refresh]);

  async function submitPin(value: string) {
    if (!selected) return;
    setBusy(true);
    const res = await verifyWorkerPin(selected.id, value);
    if (res.ok) {
      const s = await getWorkerState();
      setState(s);
      setPhase("dash");
      setPin("");
      setBusy(false);
    } else {
      setPinError(true);
      setBusy(false);
      setTimeout(() => { setPin(""); setPinError(false); }, 500);
    }
  }

  function press(d: string) {
    if (busy || pinError) return;
    const next = pin + d;
    setPin(next);
    if (next.length === 4) submitPin(next);
  }

  async function act(fn: () => Promise<unknown>) {
    setBusy(true); setActionError("");
    try {
      const result = await fn() as { ok?: boolean; error?: string };
      if (result?.ok === false) setActionError(result.error ?? "Action failed. Please try again.");
      else setDrawerOpen(false);
      await refresh();
    } catch { setActionError("Could not update. Check your connection and try again."); }
    finally { setBusy(false); }
  }

  async function switchUser() {
    await signOutWorker();
    setState(null);
    setSelected(null);
    setPhase("select");
  }

  /* ---------------- worker select ---------------- */
  if (phase === "select" || phase === "pin") {
    return (
      <div className="kiosk-shell min-h-screen bg-coal text-chrome flex flex-col items-center justify-center px-5 py-14 relative overflow-hidden">
        <div className="absolute inset-0 opacity-[0.35]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/img/hero.jpg" alt="" className="h-full w-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-b from-coal/80 via-coal/70 to-coal" />
        </div>
        <main className="relative w-full max-w-3xl anim-fade-up">
          <p className="text-center text-xs uppercase tracking-[0.42em] text-mist">Herrero Pianos · Workshop</p>
          <h1 className="text-center text-3xl sm:text-4xl font-semibold text-white mt-3">Who&apos;s at the bench today?</h1>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mt-12">
            {workers.map((w) => (
              <button
                key={w.id}
                onClick={() => { setSelected(w); setPhase("pin"); setPin(""); }}
                className="card-dark cursor-pointer p-6 min-h-[168px] flex flex-col items-center justify-center gap-3 hover:border-slate-500 hover:bg-deepslate/60 transition-all duration-200 active:scale-[0.98]"
              >
                <Avatar name={w.name} url={w.avatarUrl} size={64} />
                <div className="text-center">
                  <p className="text-base font-semibold text-white">{w.name}</p>
                  <p className="text-xs uppercase tracking-wider text-mist mt-1">{w.title}</p>
                </div>
              </button>
            ))}
          </div>
        </main>

        {/* PIN overlay */}
        {phase === "pin" && selected && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-5">
            <div className="absolute inset-0 bg-black/70 backdrop-blur-md anim-fade-in" onClick={() => !busy && setPhase("select")} />
            <div className={`relative card-dark w-full max-w-xs p-7 anim-sheet ${pinError ? "anim-shake" : ""}`}>
              <div className="flex flex-col items-center">
                <Avatar name={selected.name} url={selected.avatarUrl} size={56} />
                <p className="text-white font-medium mt-3">{selected.name}</p>
                <p className="text-xs uppercase tracking-[0.2em] text-mist mt-1 flex items-center gap-1.5">
                  <Lock size={13} aria-hidden="true" /> Enter your 4-digit PIN
                </p>
              </div>
              <div className="flex justify-center gap-3.5 my-7">
                {[0, 1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className={`w-4 h-4 rounded-full border-2 transition-all duration-150 ${
                      pin.length > i ? "bg-[#22C55E] border-[#22C55E] scale-110" : pinError ? "border-red-400" : "border-slate-500"
                    }`}
                  />
                ))}
              </div>
              <div className="grid grid-cols-3 gap-3">
                {["1","2","3","4","5","6","7","8","9"].map((d) => (
                  <button key={d} onClick={() => press(d)} disabled={busy}
                    className="h-16 rounded-xl bg-deepslate border border-slate-600 font-mono text-2xl font-medium text-white cursor-pointer hover:bg-slate-700 active:scale-95 transition disabled:opacity-50 disabled:cursor-not-allowed">
                    {d}
                  </button>
                ))}
                <button aria-label="Back to worker list" onClick={() => !busy && setPhase("select")} className="h-16 rounded-xl text-mist cursor-pointer hover:text-white hover:bg-white/5 flex items-center justify-center transition">
                  <ArrowLeft size={22} aria-hidden="true" />
                </button>
                <button onClick={() => press("0")} disabled={busy}
                  className="h-16 rounded-xl bg-deepslate border border-slate-600 font-mono text-2xl font-medium text-white cursor-pointer hover:bg-slate-700 active:scale-95 transition disabled:opacity-50 disabled:cursor-not-allowed">
                  0
                </button>
                <button aria-label="Delete last digit" onClick={() => !busy && setPin((p) => p.slice(0, -1))} className="h-16 rounded-xl text-mist cursor-pointer hover:text-white hover:bg-white/5 flex items-center justify-center transition">
                  <Delete size={22} aria-hidden="true" />
                </button>
              </div>
              {busy && <div className="flex justify-center mt-4"><Spinner /></div>}
            </div>
          </div>
        )}
      </div>
    );
  }

  /* ---------------- worker dashboard ---------------- */
  const st = state!;
  const clock = st.clock;
  const current = st.myActive.find((t) => t.status === "in_progress");

  return (
    <div className="kiosk-shell min-h-screen bg-coal text-chrome">
      <header className="glass-top sticky top-0 z-30">
        <div className="max-w-4xl mx-auto px-5 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Avatar name={st.worker.name} url={st.worker.avatarUrl} size={38} />
            <div>
              <p className="text-sm font-medium text-white leading-none">{st.worker.name}</p>
              <p className="text-xs uppercase tracking-wider text-mist mt-1">{st.worker.title}</p>
            </div>
          </div>
          <button onClick={switchUser} className="flex items-center gap-2 min-h-12 text-sm text-mist cursor-pointer hover:text-white hover:bg-white/5 transition border border-slate-600 rounded-full px-5">
            <LogOut size={15} aria-hidden="true" /> Switch user
          </button>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-5 py-8 space-y-6 pb-24">
        {/* clock card */}
        <section className="card-dark p-6 sm:p-8 relative overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-6">
            <div>
              <p className="text-xs uppercase tracking-[0.28em] text-mist flex items-center gap-2">
                <Clock size={14} aria-hidden="true" /> {clock ? "On the clock" : "Off the clock"}
              </p>
              {clock ? (
                <>
                  <LiveEarnings clockIn={clock.clockIn} rateCents={clock.rateCents}
                    breakMinutes={clock.breakMinutes} breakStartedAt={clock.breakStartedAt}
                    className="block font-mono tabular-nums font-medium text-5xl sm:text-6xl text-white mt-3" />
                  <p className="text-mist text-xs mt-2.5">
                    since {fmtTime(new Date(clock.clockIn))} · <DurationTicker clockIn={clock.clockIn} className="text-chrome" />
                    {clock.onBreak && <span className="text-amber-300 ml-2">· On break</span>}
                  </p>
                </>
              ) : (
                <p className="text-4xl sm:text-5xl font-semibold text-white mt-3">Ready when you are.</p>
              )}
            </div>
            <div className="flex flex-col items-center gap-3">
              <button
                disabled={busy}
                onClick={() => act(clock ? clockOut : clockIn)}
                className={`h-32 w-32 sm:h-40 sm:w-40 rounded-full font-bold text-lg uppercase tracking-wider cursor-pointer transition-all duration-200 active:scale-95 disabled:opacity-60 disabled:cursor-not-allowed shadow-xl ${
                  clock
                    ? "bg-[#EF4444] text-white shadow-red-950/50 hover:brightness-110"
                    : "bg-[#22C55E] text-[#04210F] shadow-black/50 hover:brightness-110"
                }`}
              >
                {busy ? <Spinner className="mx-auto" /> : clock ? "Clock Out" : "Clock In"}
              </button>
              {clock && (
                <button
                  disabled={busy}
                  onClick={() => act(clock.onBreak ? endBreak : startBreak)}
                  className={`flex items-center gap-2 min-h-14 text-sm rounded-full px-6 border cursor-pointer transition disabled:opacity-50 disabled:cursor-not-allowed ${
                    clock.onBreak
                      ? "bg-amber-400/15 text-amber-300 border-amber-400/40 hover:bg-amber-400/25"
                      : "text-chrome border-slate-600 hover:text-white hover:bg-white/[0.06]"
                  }`}
                >
                  <Coffee size={16} aria-hidden="true" /> {clock.onBreak ? "Back from break" : "Take a break"}
                </button>
              )}
            </div>
          </div>
          {clock && (
            <div className="mt-6 pt-5 border-t border-white/10 text-sm text-mist flex items-center gap-2">
              {clock.taskId && current ? (
                <>Working on <span className="text-white">{current.title}</span> · {current.piano}</>
              ) : (
                <>No task attached — take one from your bench below.</>
              )}
            </div>
          )}
        </section>

        {actionError && <p role="alert" className="text-rose-400 text-sm">{actionError}</p>}
        {/* current task */}
        {current && (
          <section className="card-dark p-5 sm:p-6 border-l-4 border-l-[#22C55E]">
            <p className="text-xs uppercase tracking-[0.28em] text-mist mb-2.5">Current task</p>
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <p className="text-white font-medium text-[15.5px]">{current.title}</p>
                <p className="text-mist text-xs mt-1">{current.piano}{current.client ? ` · ${current.client}` : ""} · est. {fmtDuration(current.estimatedMinutes * 60000)}</p>
                <div className="mt-2"><TaskChip t={current} /></div>
              </div>
              <button onClick={() => act(() => finishTask(current.id))} disabled={busy}
                className="flex items-center gap-2 min-h-16 bg-emerald-400/15 text-emerald-300 border border-emerald-400/40 rounded-xl px-6 text-base font-medium cursor-pointer hover:bg-emerald-400/25 transition disabled:opacity-50 disabled:cursor-not-allowed">
                <CheckCircle2 size={18} aria-hidden="true" /> Done
              </button>
            </div>
          </section>
        )}

        {/* my bench */}
        <section className="card-dark p-5 sm:p-6">
          <div className="flex items-center justify-between mb-4">
            <p className="text-xs uppercase tracking-[0.28em] text-mist">My bench</p>
            <button onClick={() => setDrawerOpen(true)}
              className="flex items-center gap-2 min-h-14 bg-[#22C55E] text-[#04210F] text-sm font-semibold rounded-full px-6 cursor-pointer hover:brightness-110 transition">
              <PackageOpen size={18} aria-hidden="true" /> Take a task
            </button>
          </div>
          {st.myActive.filter((t) => t.status !== "in_progress").length === 0 && st.myAssigned.length === 0 ? (
            <EmptyState title="Your bench is clear" body="Take available work from the shop queue." />
          ) : (
            <ul className="divide-y divide-white/[0.07]">
              {st.myActive.filter((t) => t.status !== "in_progress").map((t) => (
                <li key={t.id} className="py-3.5 flex items-center justify-between gap-3 flex-wrap">
                  <div>
                    <p className="text-[14px] text-white">{t.title}</p>
                    <p className="text-xs text-mist mt-0.5">{t.piano}{t.client ? ` · ${t.client}` : ""} · est. {fmtDuration(t.estimatedMinutes * 60000)}</p>
                    <div className="mt-1.5 flex items-center gap-3">
                      <TaskChip t={t} />
                      {t.waitingParts && <span className="text-xs text-amber-300 uppercase tracking-wide">waiting parts</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => act(() => startTask(t.id))} disabled={busy}
                      className="flex items-center gap-2 min-h-16 bg-[#22C55E] text-[#04210F] text-sm font-semibold rounded-xl px-5 cursor-pointer hover:brightness-110 transition disabled:opacity-50 disabled:cursor-not-allowed">
                      <Play size={16} aria-hidden="true" /> Continue
                    </button>
                    <button onClick={() => act(() => finishTask(t.id))} disabled={busy} className="min-h-16 text-sm font-medium text-emerald-300 cursor-pointer hover:text-white px-4 transition disabled:opacity-50 disabled:cursor-not-allowed">
                      Done
                    </button>
                  </div>
                </li>
              ))}
              {st.myAssigned.map((t) => (
                <li key={t.id} className="py-3.5 flex items-center justify-between gap-3 flex-wrap">
                  <div>
                    <p className="text-[14px] text-white">{t.title} <span className="text-xs text-sky-300 uppercase tracking-wide ml-1.5">assigned to you</span></p>
                    <p className="text-xs text-mist mt-0.5">{t.piano} · est. {fmtDuration(t.estimatedMinutes * 60000)}</p>
                    <div className="mt-1.5"><TaskChip t={t} /></div>
                  </div>
                  <button onClick={() => act(() => startTask(t.id))} disabled={busy}
                    className="flex items-center gap-2 min-h-16 bg-deepslate border border-slate-500 text-white text-sm font-medium rounded-xl px-5 cursor-pointer hover:bg-slate-700 transition disabled:opacity-50 disabled:cursor-not-allowed">
                    <Play size={16} aria-hidden="true" /> Take
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
        {st.completed.length > 0 && (
          <section className="card-dark p-5 sm:p-6">
            <p className="text-xs uppercase tracking-[0.28em] text-mist">Done · awaiting owner review</p>
            <p className="text-xs text-mist mt-2">The owner will review and archive or delete these tasks.</p>
            <ul className="divide-y divide-white/[0.07] mt-3">
              {st.completed.map((t) => <li key={t.id} className="py-3 flex items-start gap-3">
                <CheckCircle2 size={16} className="text-emerald-300 mt-0.5 shrink-0" />
                <div><p className="text-sm text-mist line-through">{t.title}</p>
                  <p className="text-xs text-mist mt-1">{t.piano}{t.client ? ` · ${t.client}` : ""}</p></div>
              </li>)}
            </ul>
          </section>
        )}
      </main>

      {/* available tasks drawer */}
      <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)}>
        <div className="p-6">
          <div className="flex items-center justify-between mb-1">
            <h3 className="text-2xl font-semibold text-white">Available work</h3>
            <button onClick={() => refresh()} aria-label="Refresh available work" className="h-12 w-12 flex items-center justify-center rounded-lg text-mist cursor-pointer hover:text-white hover:bg-white/5 transition"><RefreshCw size={18} aria-hidden="true" /></button>
          </div>
          <p className="text-mist text-[12.5px] mb-5">Take a task to begin, then mark it Done when finished.</p>
          {actionError && <p role="alert" className="text-rose-400 text-sm mb-3">{actionError}</p>}
          {st.available.length === 0 ? (
            <EmptyState title="No available tasks" body="The queue is empty — ask the owner for work." />
          ) : (
            <ul className="space-y-3">
              {st.available.map((t) => (
                <li key={t.id} className="card-dark p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-white text-[14px]">{t.title}</p>
                      <p className="text-mist text-xs mt-1">{t.piano}{t.client ? ` · ${t.client}` : ""}</p>
                      <div className="flex items-center gap-3 mt-2 text-xs text-mist">
                        <TaskChip t={t} />
                        <span>est. {fmtDuration(t.estimatedMinutes * 60000)}</span>
                        {t.dueDate && <span>due {new Date(t.dueDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>}
                      </div>
                    </div>
                    <button onClick={() => act(() => startTask(t.id))} disabled={busy}
                      className="shrink-0 min-h-16 bg-[#22C55E] text-[#04210F] text-sm font-semibold rounded-xl px-6 cursor-pointer hover:brightness-110 transition disabled:opacity-50 disabled:cursor-not-allowed">
                      Take
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Drawer>
    </div>
  );
}
