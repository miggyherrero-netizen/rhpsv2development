"use client";

import { useState } from "react";
import { CheckCircle2, Coffee, AlertTriangle, HandCoins } from "lucide-react";
import type { TimesheetWorkerSummary } from "@/server/data";
import { Avatar, Spinner } from "@/components/ui";
import { recordPayment } from "@/server/admin";
import { fmtDate, fmtDuration, fmtTime, peso } from "@/lib/format";

function PaymentControl({
  entryId, balanceCents, busy, onPay,
}: {
  entryId: string; balanceCents: number; busy: boolean; onPay: (entryId: string, amountCents: number) => void;
}) {
  const [amount, setAmount] = useState(() => (balanceCents / 100).toFixed(0));

  if (balanceCents <= 0) {
    return (
      <span className="flex items-center gap-1.5 rounded-full px-2.5 py-1 border text-xs uppercase tracking-wide bg-emerald-400/15 text-emerald-300 border-emerald-400/25">
        <CheckCircle2 size={12} /> Paid in full
      </span>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      <span className="text-rose-300 text-xs tnum">{peso(balanceCents)} owed</span>
      <input
        type="number" min={1} inputMode="decimal" value={amount}
        onChange={(e) => setAmount(e.target.value)}
        className="w-16 bg-white/[0.06] border border-white/15 rounded-lg px-2 py-1 text-xs text-white tnum focus:outline-none focus:border-white/30"
      />
      <button
        disabled={busy}
        onClick={() => {
          const cents = Math.round(parseFloat(amount) * 100);
          if (cents > 0) onPay(entryId, cents);
        }}
        className="flex items-center gap-1 rounded-full px-2.5 py-1 border text-xs uppercase tracking-wide transition disabled:opacity-40 text-mist border-white/15 hover:text-white hover:bg-white/[0.06]"
      >
        {busy ? <Spinner className="w-3 h-3" /> : <HandCoins size={12} />} Pay
      </button>
    </div>
  );
}

export default function TodayTimesheet({ initial }: { initial: TimesheetWorkerSummary[] }) {
  const [summaries, setSummaries] = useState(initial);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function pay(entryId: string, amountCents: number) {
    setBusyId(entryId);
    await recordPayment(entryId, amountCents);
    setSummaries((prev) =>
      prev.map((s) => ({
        ...s,
        totalBalanceCents: s.entries.some((e) => e.entryId === entryId)
          ? Math.max(0, s.totalBalanceCents - Math.min(amountCents, s.entries.find((e) => e.entryId === entryId)!.balanceCents))
          : s.totalBalanceCents,
        entries: s.entries.map((e) =>
          e.entryId === entryId
            ? { ...e, paidCents: e.paidCents + amountCents, balanceCents: Math.max(0, e.balanceCents - amountCents) }
            : e,
        ),
      })),
    );
    setBusyId(null);
  }

  if (summaries.length === 0) {
    return (
      <section className="card-dark p-6 sm:p-7">
        <h2 className="font-serif text-xl text-white mb-1">Today&apos;s timesheet</h2>
        <p className="text-mist text-[12.5px]">No shifts recorded yet today.</p>
      </section>
    );
  }

  return (
    <section className="card-dark overflow-hidden">
      <div className="p-5 sm:p-6 border-b border-white/[0.07]">
        <h2 className="font-serif text-xl text-white">Today&apos;s timesheet</h2>
        <p className="text-mist text-[12px] mt-1">
          Today&apos;s hours per worker, plus any older unpaid shifts still owed. Log the exact amount you hand over — partial payments carry the balance forward.
        </p>
      </div>
      <ul className="divide-y divide-white/[0.06]">
        {summaries.map((s) => (
          <li key={s.workerId} className="p-4 sm:p-5">
            <div className="flex items-center gap-3">
              <Avatar name={s.name} url={s.avatarUrl} size={36} />
              <div className="flex-1">
                <p className="text-white text-[14px] font-medium">{s.name}</p>
                <p className="text-mist text-xs mt-0.5">{fmtDuration(s.totalMinutesToday * 60_000)} today</p>
              </div>
              <div className="text-right">
                <p className="text-emerald-300 font-medium text-[15px] tnum">{peso(s.totalEarnedCentsToday)}</p>
                {s.totalBalanceCents > 0 && <p className="text-rose-300 text-xs tnum mt-0.5">{peso(s.totalBalanceCents)} owed total</p>}
              </div>
            </div>
            <ul className="mt-3 space-y-2.5 pl-[48px]">
              {s.entries.map((e) => (
                <li key={e.entryId} className="text-xs">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <span className="tnum text-mist">
                      {!e.isToday && <span className="text-mist">{fmtDate(new Date(e.clockIn))} · </span>}
                      {fmtTime(new Date(e.clockIn))} – {e.clockOut ? fmtTime(new Date(e.clockOut)) : "now"}
                    </span>
                    <div className="flex items-center gap-2.5 shrink-0">
                      <span className="tnum text-chrome">{peso(e.earnedCents)}</span>
                      {e.clockOut ? (
                        <PaymentControl
                          key={`${e.entryId}-${e.balanceCents}`}
                          entryId={e.entryId} balanceCents={e.balanceCents} busy={busyId === e.entryId} onPay={pay}
                        />
                      ) : (
                        <span className="text-mist text-xs uppercase tracking-wide">Clock out first</span>
                      )}
                    </div>
                  </div>
                  {e.breaks.length > 0 && (
                    <ul className="mt-1.5 space-y-1">
                      {e.breaks.map((b, i) => (
                        <li key={i} className={`flex items-center gap-1.5 text-xs ${b.long ? "text-rose-300" : "text-amber-300/80"}`}>
                          {b.long ? <AlertTriangle size={10.5} /> : <Coffee size={10.5} />}
                          <span className="tnum">
                            {fmtTime(new Date(b.startedAt))} – {b.endedAt ? fmtTime(new Date(b.endedAt)) : "not back yet"}
                          </span>
                          {b.minutes !== null ? (
                            <span>({b.minutes}m{b.long ? " — long break" : ""})</span>
                          ) : (
                            <span>— still out{b.long ? ", flagged" : ""}</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </section>
  );
}
