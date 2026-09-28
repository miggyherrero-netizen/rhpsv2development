"use client";

import Link from "next/link";
import { RefreshCw, Wallet, TrendingUp, TrendingDown, Receipt, ShieldAlert, Landmark, AlertTriangle } from "lucide-react";
import type { OverviewBundle } from "@/server/accounting-data";
import { syncNow } from "@/server/accounting";
import {
  AccountingHeader, Bar, Btn, Day, FormError, KindChip, Money, SectionCard, StatCard, StreamChip, barTone, useAction,
} from "@/components/accounting-ui";
import { STREAM_LABEL } from "@/lib/accounting";
import { peso } from "@/lib/format";

const walletTone: Record<string, string> = { cash: "emerald", bank: "sky", ewallet: "violet", other: "slate" };

export default function AccountingOverview({ data }: { data: OverviewBundle }) {
  const action = useAction();
  const { month, booksToDate, equity, safeToWithdraw } = data;
  const totalAr = data.serviceAr.outstandingCents + data.projectArCents + data.pianoArCents;

  return (
    <div className="p-4 sm:p-7 max-w-[1600px] mx-auto">
      <AccountingHeader
        title="Money overview"
        sub={`Books since ${new Date(data.booksStart).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "Asia/Manila" })} · billing and collections from all workspaces`}
        action={
          <Btn variant="ghost" busy={action.busy} onClick={() => action.run(() => syncNow(), { notice: "Books synced" })}>
            <RefreshCw size={13} /> Sync now
          </Btn>
        }
      />
      {action.error && <div className="mb-4"><FormError error={action.error} /></div>}
      {action.notice && <p className="mb-4 text-[12px] text-emerald-300">{action.notice}</p>}

      {(data.openExceptions > 0 || data.unpaidWagesCents > 0) && (
        <div className="flex flex-wrap gap-2.5 mb-5">
          {data.openExceptions > 0 && (
            <Link href="/admin/accounting/settings" className="card-dark px-3.5 py-2 text-[12px] text-amber-300 border-amber-400/20 flex items-center gap-2 hover:bg-white/[0.04]">
              <AlertTriangle size={13} /> {data.openExceptions} accounting exception{data.openExceptions === 1 ? "" : "s"} to review
            </Link>
          )}
          {data.unpaidWagesCents > 0 && (
            <span className="card-dark px-3.5 py-2 text-[12px] text-sky-300 border-sky-400/20 flex items-center gap-2">
              <ShieldAlert size={13} /> Unpaid shop wages: {peso(data.unpaidWagesCents)}
            </span>
          )}
        </div>
      )}

      {/* Cash position */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 mb-5">
        <div className="card-dark p-4 border-white/[0.14]">
          <p className="text-[10px] uppercase tracking-[0.18em] text-mist mb-2">Total cash</p>
          <p className="font-serif text-[22px] text-white tnum">{peso(data.totalCashCents)}</p>
          <p className="text-[11px] text-mist mt-1.5">{data.wallets.filter((w) => w.active).length} active wallet{data.wallets.filter((w) => w.active).length === 1 ? "" : "s"}</p>
        </div>
        {data.wallets.map((w) => (
          <Link key={w.id} href={`/admin/accounting/accounts/${w.id}`} className="card-dark p-4 hover:bg-white/[0.04] transition">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] uppercase tracking-[0.18em] text-mist truncate">{w.name}</p>
              <Wallet size={13} className="text-mist/60 shrink-0" />
            </div>
            <p className={`font-serif text-[19px] tnum ${w.active ? "text-white" : "text-mist"}`}>{peso(w.balanceCents)}</p>
            <p className="text-[10.5px] text-mist/70 mt-1.5">
              {!w.active ? "inactive" : w.hasOpenRecon ? "reconciliation in progress" : w.lastReconciledAt ? `reconciled to ${new Date(w.lastReconciledAt).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "Asia/Manila" })}` : "never reconciled"}
              {w.lastDifferenceCents != null && w.lastDifferenceCents !== 0 ? ` · diff ${peso(w.lastDifferenceCents)}` : ""}
            </p>
          </Link>
        ))}
      </div>

      {/* Month strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <StatCard label={`Money in — ${month.label.split(" ")[0]}`} value={<Money cents={month.cash.inCents} />} tone="emerald" icon={<TrendingUp size={14} />} sub={`cash received, all streams`} />
        <StatCard label="Money out" value={<Money cents={month.cash.outCents} />} tone="rose" icon={<TrendingDown size={14} />} sub="cash spent, all streams" />
        <StatCard label="Revenue (billed)" value={<Money cents={month.pnl.revenueCents} />} tone="sky" sub={`expenses ${peso(month.pnl.expenseCents)} · net ${peso(month.pnl.netCents)}`} />
        <StatCard label="Receivables" value={<Money cents={totalAr} />} tone={totalAr > 0 ? "amber" : undefined} icon={<Receipt size={14} />} sub={`${peso(data.serviceAr.overdueCents)} overdue · ${peso(data.depositsHeldCents)} deposits held`} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-5">
        {/* Safe to withdraw */}
        <SectionCard title="Safe to withdraw (advisory)">
          <p className="font-serif text-[26px] text-white tnum mb-1">{peso(safeToWithdraw.amountCents)}</p>
          <p className="text-[11.5px] text-mist mb-4">
            retained profit {peso(safeToWithdraw.retainedProfitCents)} minus money that already belongs to others. Draws are never blocked — you decide.
          </p>
          <div className="space-y-2">
            {safeToWithdraw.parts.map((p) => (
              <div key={p.label}>
                <div className="flex items-center justify-between text-[12px] mb-1">
                  <span className="text-mist">{p.label}</span>
                  <span className="tnum text-chrome">−{peso(p.cents)}</span>
                </div>
                <Bar pct={safeToWithdraw.retainedProfitCents > 0 ? (p.cents / safeToWithdraw.retainedProfitCents) * 100 : 0} color={barTone("rose")} />
              </div>
            ))}
          </div>
          <Link href="/admin/accounting/owner" className="inline-flex items-center gap-2 mt-4 text-[12px] text-sky-300 hover:underline">
            Record a draw, contribution, or personal expense →
          </Link>
        </SectionCard>

        {/* P&L books-to-date */}
        <SectionCard title="Profit &amp; loss — books to date" action={<Link href="/admin/accounting/reports" className="text-[11.5px] text-sky-300 hover:underline">Full reports →</Link>}>
          <div className="grid grid-cols-3 gap-3 mb-4">
            <div>
              <p className="text-[10px] uppercase tracking-[0.16em] text-mist mb-1">Revenue</p>
              <p className="tnum text-emerald-300 text-[15px]">{peso(booksToDate.revenueCents)}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-[0.16em] text-mist mb-1">Expenses</p>
              <p className="tnum text-rose-300 text-[15px]">{peso(booksToDate.expenseCents)}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-[0.16em] text-mist mb-1">Net</p>
              <p className={`tnum text-[15px] ${booksToDate.netCents >= 0 ? "text-emerald-300" : "text-rose-300"}`}>{peso(booksToDate.netCents)}</p>
            </div>
          </div>
          <div className="space-y-2.5">
            {Object.entries(booksToDate.revenueByStream).sort((a, b) => b[1] - a[1]).map(([stream, cents]) => (
              <div key={stream}>
                <div className="flex items-center justify-between text-[12px] mb-1">
                  <span className="text-mist">{STREAM_LABEL[stream] ?? stream}</span>
                  <span className="tnum text-chrome">{peso(cents)}</span>
                </div>
                <Bar pct={booksToDate.revenueCents > 0 ? (cents / booksToDate.revenueCents) * 100 : 0} color={barTone("emerald")} />
              </div>
            ))}
            {Object.keys(booksToDate.revenueByStream).length === 0 && (
              <p className="text-[12px] text-mist">No revenue posted yet. Record payments in Service, Projects, or Showroom — or press “Sync now”.</p>
            )}
          </div>
          <div className="mt-4 pt-3 border-t border-white/[0.06] text-[11.5px] text-mist/80 leading-relaxed">
            Owner&apos;s equity: {peso(equity.totalCents)} = opening {peso(equity.openingCents)} + capital {peso(equity.capitalCents)} + retained {peso(equity.retainedProfitCents)} − draws {peso(equity.drawsCents)} − personal {peso(equity.personalCents)}
          </div>
        </SectionCard>
      </div>

      {/* Deposits + AR detail */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-5">
        <SectionCard title="Customer deposits held" action={<Link href="/admin/accounting/receivables" className="text-[11.5px] text-sky-300 hover:underline">Receivables →</Link>}>
          {data.depositsList.length === 0 ? (
            <p className="text-[12px] text-mist py-2">No unearned deposits right now.</p>
          ) : (
            <div className="divide-y divide-white/[0.05]">
              {data.depositsList.map((d, i) => (
                <div key={i} className="flex items-center justify-between py-2.5 text-[12.5px]">
                  <div>
                    <p className="text-chrome">{d.label}</p>
                    <p className="text-[10.5px] text-mist/70">{d.source === "project" ? "Restoration deposit" : "Piano reservation"} · <Day iso={d.date} /></p>
                  </div>
                  <span className="tnum text-white">{peso(d.amountCents)}</span>
                </div>
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard title="Recent money movements">
          {data.recent.length === 0 ? (
            <p className="text-[12px] text-mist py-2">Nothing posted yet.</p>
          ) : (
            <div className="divide-y divide-white/[0.05]">
              {data.recent.map((e) => (
                <div key={e.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <KindChip kind={e.kind} />
                      {e.voided && <span className="text-[10px] text-rose-300/90">voided</span>}
                      {e.isCorrection && <span className="text-[10px] text-mist/60">correction</span>}
                    </div>
                    <p className="text-[12px] text-chrome truncate mt-1">{e.memo}</p>
                    <p className="text-[10.5px] text-mist/60"><Day iso={e.occurredAt} /> · <StreamChip stream={e.stream} /></p>
                  </div>
                  <div className="text-right shrink-0">
                    {e.walletInCents > 0 && <p className="tnum text-emerald-300 text-[13px]">+{peso(e.walletInCents)}</p>}
                    {e.walletOutCents > 0 && <p className="tnum text-rose-300 text-[13px]">−{peso(e.walletOutCents)}</p>}
                    {e.walletInCents === 0 && e.walletOutCents === 0 && <p className="tnum text-mist/60 text-[13px]">—</p>}
                  </div>
                </div>
              ))}
            </div>
          )}
          <Link href="/admin/accounting/transactions" className="inline-flex items-center gap-2 mt-4 text-[12px] text-sky-300 hover:underline">
            <Landmark size={13} /> All transactions →
          </Link>
        </SectionCard>
      </div>
    </div>
  );
}
