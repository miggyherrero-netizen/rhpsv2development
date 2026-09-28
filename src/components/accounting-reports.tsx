"use client";

import { useState } from "react";
import { FileDown } from "lucide-react";
import type { ReportsBundle } from "@/server/accounting-data";
import { AccountingHeader, Bar, Btn, Money, SectionCard, StatCard, barTone, downloadCsv } from "@/components/accounting-ui";
import { STREAM_LABEL, monthKeyLabel } from "@/lib/accounting";
import { peso } from "@/lib/format";

const TABS = ["pnl", "cash", "projects", "sales", "payroll", "equity", "vat", "balance"] as const;
type Tab = (typeof TABS)[number];
const TAB_LABEL: Record<Tab, string> = {
  pnl: "P&L", cash: "Cash flow", projects: "Projects", sales: "Sales register",
  payroll: "Payroll", equity: "Equity", vat: "VAT", balance: "Balance sheet",
};

export default function AccountingReports({ data }: { data: ReportsBundle }) {
  const [tab, setTab] = useState<Tab>("pnl");
  const maxPnl = Math.max(1, ...data.pnlByMonth.map((m) => Math.max(m.revenueCents, m.expenseCents)));
  const maxCash = Math.max(1, ...data.cashByMonth.map((m) => Math.max(m.inCents, m.outCents)));

  function csv(name: string, rows: (string | number | null | undefined)[][]) {
    downloadCsv(`${name}-${new Date().toISOString().slice(0, 10)}.csv`, rows);
  }

  return (
    <div className="p-4 sm:p-7 max-w-[1400px] mx-auto">
      <AccountingHeader
        title="Reports"
        sub={`Accountant-ready views since the books started (${new Date(data.booksStart).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "Asia/Manila" })}). Every amount derives from the journal.`}
      />

      <div className="flex flex-wrap gap-2 mb-5">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-xl px-3.5 py-2 text-[12.5px] transition border ${
              tab === t ? "bg-white/[0.09] text-white border-white/[0.08]" : "card-dark text-mist hover:text-white"
            }`}
          >
            {TAB_LABEL[t]}
          </button>
        ))}
      </div>

      {tab === "pnl" && (
        <div className="space-y-5">
          <SectionCard
            title="Profit & loss by month (accrual — billing based)"
            action={
              <Btn variant="ghost" onClick={() => csv("profit-and-loss", [
                ["Month", "Revenue", "Expenses", "Net"],
                ...data.pnlByMonth.map((m) => [m.key, m.revenueCents / 100, m.expenseCents / 100, m.netCents / 100]),
              ])}><FileDown size={13} /> CSV</Btn>
            }
          >
            <div className="flex items-end gap-2 sm:gap-3 h-48 mb-4">
              {data.pnlByMonth.map((m) => (
                <div key={m.key} className="flex-1 flex flex-col items-center gap-1.5 h-full">
                  <div className="flex-1 w-full flex items-end justify-center gap-1">
                    <div className="w-1/2 rounded-t" style={{ height: `${(m.revenueCents / maxPnl) * 100}%`, background: "rgba(110,231,183,0.75)", minHeight: m.revenueCents > 0 ? 3 : 0 }} title={`Revenue ${peso(m.revenueCents)}`} />
                    <div className="w-1/2 rounded-t" style={{ height: `${(m.expenseCents / maxPnl) * 100}%`, background: "rgba(253,164,175,0.7)", minHeight: m.expenseCents > 0 ? 3 : 0 }} title={`Expenses ${peso(m.expenseCents)}`} />
                  </div>
                  <p className="text-[10px] text-mist/70 whitespace-nowrap">{monthKeyLabel(m.key)}</p>
                </div>
              ))}
              {data.pnlByMonth.length === 0 && <p className="text-[12px] text-mist m-auto">No months in range yet.</p>}
            </div>
            <div className="overflow-x-auto thin-scroll">
              <table className="w-full text-left">
                <thead>
                  <tr className="text-mist/70">
                    {["Month", "Revenue", "Expenses", "Net"].map((h) => <th key={h} className="text-[9.5px] uppercase tracking-[0.16em] font-normal pb-2 pr-4">{h}</th>)}
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.045]">
                  {[...data.pnlByMonth].reverse().map((m) => (
                    <tr key={m.key}>
                      <td className="py-2 pr-4 text-[12px] text-chrome">{monthKeyLabel(m.key)}</td>
                      <td className="py-2 pr-4 tnum text-[12px] text-emerald-300">{peso(m.revenueCents)}</td>
                      <td className="py-2 pr-4 tnum text-[12px] text-rose-300">{peso(m.expenseCents)}</td>
                      <td className={`py-2 tnum text-[12px] ${m.netCents >= 0 ? "text-emerald-300" : "text-rose-300"}`}>{peso(m.netCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </SectionCard>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <SectionCard title="By stream">
              <div className="divide-y divide-white/[0.05]">
                {data.pnlByStream.sort((a, b) => (b.revenueCents - b.expenseCents) - (a.revenueCents - a.expenseCents)).map((s) => (
                  <div key={s.stream} className="py-2.5">
                    <div className="flex items-center justify-between text-[12.5px]">
                      <span className="text-chrome">{STREAM_LABEL[s.stream] ?? s.stream}</span>
                      <span className={`tnum ${s.netCents >= 0 ? "text-emerald-300" : "text-rose-300"}`}>{peso(s.netCents)}</span>
                    </div>
                    <p className="text-[10.5px] text-mist/70 mt-0.5">revenue {peso(s.revenueCents)} · expenses {peso(s.expenseCents)}</p>
                  </div>
                ))}
                {data.pnlByStream.length === 0 && <p className="text-[12px] text-mist py-2">Nothing posted yet.</p>}
              </div>
            </SectionCard>

            <SectionCard
              title="By account"
              action={
                <Btn variant="ghost" onClick={() => csv("pl-by-account", [
                  ["Account", "Type", "Amount"],
                  ...data.pnlByAccount.map((a) => [a.name, a.type, a.amountCents / 100]),
                ])}><FileDown size={13} /> CSV</Btn>
              }
            >
              <div className="divide-y divide-white/[0.05] max-h-96 overflow-y-auto thin-scroll">
                {data.pnlByAccount.map((a) => (
                  <div key={a.name} className="flex items-center justify-between py-2 text-[12.5px]">
                    <span className="text-chrome">{a.name}</span>
                    <span className={`tnum ${a.type === "revenue" ? "text-emerald-300" : "text-rose-300"}`}>{peso(a.amountCents)}</span>
                  </div>
                ))}
                {data.pnlByAccount.length === 0 && <p className="text-[12px] text-mist py-2">Nothing posted yet.</p>}
              </div>
            </SectionCard>
          </div>
        </div>
      )}

      {tab === "cash" && (
        <div className="space-y-5">
          <SectionCard
            title="Cash in / out by month (collections based)"
            action={
              <Btn variant="ghost" onClick={() => csv("cash-flow", [
                ["Month", "Money in", "Money out", "Net"],
                ...data.cashByMonth.map((m) => [m.key, m.inCents / 100, m.outCents / 100, m.netCents / 100]),
              ])}><FileDown size={13} /> CSV</Btn>
            }
          >
            <div className="flex items-end gap-2 sm:gap-3 h-48 mb-4">
              {data.cashByMonth.map((m) => (
                <div key={m.key} className="flex-1 flex flex-col items-center gap-1.5 h-full">
                  <div className="flex-1 w-full flex items-end justify-center gap-1">
                    <div className="w-1/2 rounded-t" style={{ height: `${(m.inCents / maxCash) * 100}%`, background: "rgba(125,211,252,0.75)", minHeight: m.inCents > 0 ? 3 : 0 }} title={`In ${peso(m.inCents)}`} />
                    <div className="w-1/2 rounded-t" style={{ height: `${(m.outCents / maxCash) * 100}%`, background: "rgba(196,181,253,0.7)", minHeight: m.outCents > 0 ? 3 : 0 }} title={`Out ${peso(m.outCents)}`} />
                  </div>
                  <p className="text-[10px] text-mist/70 whitespace-nowrap">{monthKeyLabel(m.key)}</p>
                </div>
              ))}
            </div>
            <div className="overflow-x-auto thin-scroll">
              <table className="w-full text-left">
                <thead>
                  <tr className="text-mist/70">
                    {["Wallet", ...data.months.map((k) => monthKeyLabel(k))].map((h, i) => (
                      <th key={i} className="text-[9.5px] uppercase tracking-[0.16em] font-normal pb-2 pr-4">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.045]">
                  {data.cashFlowByAccount.map((a) => (
                    <tr key={a.name}>
                      <td className="py-2 pr-4 text-[12px] text-chrome whitespace-nowrap">{a.name}</td>
                      {data.months.map((k) => {
                        const cell = a.byMonth[k];
                        return (
                          <td key={k} className="py-2 pr-4 tnum text-[11.5px] text-mist">
                            {cell && (cell.inCents || cell.outCents) ? `+${peso(cell.inCents)} / −${peso(cell.outCents)}` : "—"}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </SectionCard>
        </div>
      )}

      {tab === "projects" && (
        <SectionCard
          title="Restoration profitability"
          action={
            <Btn variant="ghost" onClick={() => csv("project-profitability", [
              ["Project", "Status", "Contract", "Paid", "Labor", "Costs", "Revenue (finalized)", "Profit", "Margin %"],
              ...data.projectProfit.map((p) => [p.label, p.status, p.contractCents / 100, p.paidCents / 100, p.laborCents / 100, p.costsCents / 100, p.revenueCents / 100, p.profitCents / 100, p.marginPct]),
            ])}><FileDown size={13} /> CSV</Btn>
          }
        >
          <p className="text-[11.5px] text-mist mb-3 leading-relaxed">
            Labor is derived from workshop time entries at each worker&apos;s clock-in rate. Profit counts revenue only after billing is finalized — before that, payments are deposits held, not income.
          </p>
          <div className="overflow-x-auto thin-scroll">
            <table className="w-full text-left">
              <thead>
                <tr className="text-mist/70">
                  {["Project", "Contract", "Paid", "Labor", "Costs", "Revenue", "Profit", "Margin"].map((h) => (
                    <th key={h} className="text-[9.5px] uppercase tracking-[0.16em] font-normal pb-2 pr-4">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.045]">
                {data.projectProfit.map((p) => (
                  <tr key={p.projectId}>
                    <td className="py-2.5 pr-4 text-[12px] text-chrome max-w-[240px] truncate">
                      {p.label}
                      {!p.finalized && <span className="text-[10px] text-mist/50"> · not finalized</span>}
                    </td>
                    <td className="py-2.5 pr-4 tnum text-[12px] text-chrome">{peso(p.contractCents)}</td>
                    <td className="py-2.5 pr-4 tnum text-[12px] text-sky-300">{peso(p.paidCents)}</td>
                    <td className="py-2.5 pr-4 tnum text-[12px] text-mist">{peso(p.laborCents)}</td>
                    <td className="py-2.5 pr-4 tnum text-[12px] text-mist">{peso(p.costsCents)}</td>
                    <td className="py-2.5 pr-4 tnum text-[12px] text-chrome">{p.revenueCents ? peso(p.revenueCents) : "—"}</td>
                    <td className={`py-2.5 pr-4 tnum text-[12px] ${p.profitCents >= 0 ? "text-emerald-300" : "text-rose-300"}`}>{p.finalized ? peso(p.profitCents) : "—"}</td>
                    <td className="py-2.5 tnum text-[12px] text-mist">{p.finalized ? `${p.marginPct}%` : "—"}</td>
                  </tr>
                ))}
                {data.projectProfit.length === 0 && <tr><td colSpan={8} className="py-6 text-center text-[12px] text-mist">No projects.</td></tr>}
              </tbody>
            </table>
          </div>
        </SectionCard>
      )}

      {tab === "sales" && (
        <SectionCard
          title="Piano sales register"
          action={
            <Btn variant="ghost" onClick={() => csv("sales-register", [
              ["Piano", "Status", "Buyer", "Sold at", "Price (incl. VAT)", "VAT", "Net revenue", "Cost snapshot", "Profit", "Margin %", "Paid", "Balance"],
              ...data.salesRegister.map((s) => [
                s.label, s.status, s.buyerName, s.soldAt ? s.soldAt.slice(0, 10) : "", s.priceCents / 100, s.taxCents / 100,
                s.netRevenueCents / 100, s.costCents / 100, s.profitCents / 100, s.marginPct, s.paidCents / 100, s.balanceCents / 100,
              ]),
            ])}><FileDown size={13} /> CSV</Btn>
          }
        >
          <div className="overflow-x-auto thin-scroll">
            <table className="w-full text-left">
              <thead>
                <tr className="text-mist/70">
                  {["Piano", "Buyer", "Price", "VAT", "Net", "Cost", "Profit", "Margin", "Balance"].map((h) => (
                    <th key={h} className="text-[9.5px] uppercase tracking-[0.16em] font-normal pb-2 pr-4">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.045]">
                {data.salesRegister.map((s) => (
                  <tr key={s.saleId} className={s.status !== "completed" ? "opacity-70" : ""}>
                    <td className="py-2.5 pr-4 text-[12px] text-chrome max-w-[200px] truncate">{s.label}{s.status !== "completed" ? ` (${s.status})` : ""}</td>
                    <td className="py-2.5 pr-4 text-[12px] text-mist max-w-[140px] truncate">{s.buyerName ?? "—"}</td>
                    <td className="py-2.5 pr-4 tnum text-[12px] text-chrome">{peso(s.priceCents)}</td>
                    <td className="py-2.5 pr-4 tnum text-[12px] text-mist">{peso(s.taxCents)}</td>
                    <td className="py-2.5 pr-4 tnum text-[12px] text-chrome">{peso(s.netRevenueCents)}</td>
                    <td className="py-2.5 pr-4 tnum text-[12px] text-mist">{s.status === "completed" ? peso(s.costCents) : "—"}</td>
                    <td className={`py-2.5 pr-4 tnum text-[12px] ${s.profitCents >= 0 ? "text-emerald-300" : "text-rose-300"}`}>{s.status === "completed" ? peso(s.profitCents) : "—"}</td>
                    <td className="py-2.5 pr-4 tnum text-[12px] text-mist">{s.status === "completed" ? `${s.marginPct}%` : "—"}</td>
                    <td className="py-2.5 tnum text-[12px] text-amber-300">{peso(s.balanceCents)}</td>
                  </tr>
                ))}
                {data.salesRegister.length === 0 && <tr><td colSpan={9} className="py-6 text-center text-[12px] text-mist">No piano sales yet. Reserve and complete sales from a piano&apos;s Costs &amp; Sale page.</td></tr>}
              </tbody>
            </table>
          </div>
        </SectionCard>
      )}

      {tab === "payroll" && (
        <div className="space-y-5">
          <SectionCard
            title="Payroll register (payouts by month)"
            action={
              <Btn variant="ghost" onClick={() => csv("payroll-register", [
                ["Month", "Worker", "Paid"],
                ...data.payrollRegister.map((r) => [r.month, r.worker, r.paidCents / 100]),
              ])}><FileDown size={13} /> CSV</Btn>
            }
          >
            <div className="overflow-x-auto thin-scroll">
              <table className="w-full text-left">
                <thead>
                  <tr className="text-mist/70">
                    {["Month", "Worker", "Paid"].map((h) => <th key={h} className="text-[9.5px] uppercase tracking-[0.16em] font-normal pb-2 pr-4">{h}</th>)}
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.045]">
                  {data.payrollRegister.map((r) => (
                    <tr key={`${r.month}-${r.worker}`}>
                      <td className="py-2 pr-4 text-[12px] text-chrome">{monthKeyLabel(r.month)}</td>
                      <td className="py-2 pr-4 text-[12px] text-chrome">{r.worker}</td>
                      <td className="py-2 tnum text-[12px] text-chrome">{peso(r.paidCents)}</td>
                    </tr>
                  ))}
                  {data.payrollRegister.length === 0 && <tr><td colSpan={3} className="py-6 text-center text-[12px] text-mist">No payouts since the books started.</td></tr>}
                </tbody>
              </table>
            </div>
          </SectionCard>
          <SectionCard title="Totals by worker">
            <div className="divide-y divide-white/[0.05]">
              {data.payrollTotals.map((w) => (
                <div key={w.worker} className="flex items-center justify-between py-2 text-[12.5px]">
                  <span className="text-chrome">{w.worker}</span>
                  <span className="tnum">{peso(w.paidCents)}</span>
                </div>
              ))}
              {data.payrollTotals.length === 0 && <p className="text-[12px] text-mist py-2">No payouts recorded.</p>}
            </div>
          </SectionCard>
        </div>
      )}

      {tab === "equity" && (
        <SectionCard
          title="Owner's equity statement"
          action={
            <Btn variant="ghost" onClick={() => csv("equity", [
              ["Component", "Amount"],
              ["Opening equity", data.equity.openingCents / 100],
              ["Owner capital", data.equity.capitalCents / 100],
              ["Retained profit", data.equity.retainedProfitCents / 100],
              ["Owner draws", -data.equity.drawsCents / 100],
              ["Personal expenses", -data.equity.personalCents / 100],
              ["Owner's equity", data.equity.totalCents / 100],
            ])}><FileDown size={13} /> CSV</Btn>
          }
        >
          <div className="max-w-md mx-auto divide-y divide-white/[0.05]">
            {[
              { label: "Opening equity", cents: data.equity.openingCents },
              { label: "Owner capital contributed", cents: data.equity.capitalCents },
              { label: "Retained profit (books to date)", cents: data.equity.retainedProfitCents },
              { label: "Owner draws", cents: -data.equity.drawsCents },
              { label: "Personal expenses from business", cents: -data.equity.personalCents },
            ].map((r) => (
              <div key={r.label} className="flex items-center justify-between py-2.5 text-[13px]">
                <span className="text-mist">{r.label}</span>
                <Money cents={r.cents} colored />
              </div>
            ))}
            <div className="flex items-center justify-between py-3.5 text-[14px]">
              <span className="text-white font-medium">Owner&apos;s equity</span>
              <Money cents={data.equity.totalCents} className="text-white" />
            </div>
          </div>
        </SectionCard>
      )}

      {tab === "vat" && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
            <StatCard label="VAT payable now" value={<Money cents={data.vatPayableCents} />} tone={data.vatPayableCents > 0 ? "amber" : "emerald"} sub="output VAT − payments" />
          </div>
          <SectionCard
            title="VAT by quarter (decision support — confirm with your accountant)"
            action={
              <Btn variant="ghost" onClick={() => csv("vat-summary", [
                ["Quarter", "Output VAT (billed)", "Payments made", "Net"],
                ...data.vatByQuarter.map((q) => [q.quarter, q.outputCents / 100, q.paidCents / 100, (q.outputCents - q.paidCents) / 100]),
              ])}><FileDown size={13} /> CSV</Btn>
            }
          >
            <div className="overflow-x-auto thin-scroll">
              <table className="w-full text-left">
                <thead>
                  <tr className="text-mist/70">
                    {["Quarter", "Output VAT (billed)", "Paid to BIR", "Net payable"].map((h) => (
                      <th key={h} className="text-[9.5px] uppercase tracking-[0.16em] font-normal pb-2 pr-4">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.045]">
                  {data.vatByQuarter.map((q) => (
                    <tr key={q.quarter}>
                      <td className="py-2 pr-4 text-[12px] text-chrome">{q.quarter}</td>
                      <td className="py-2 pr-4 tnum text-[12px] text-chrome">{peso(q.outputCents)}</td>
                      <td className="py-2 pr-4 tnum text-[12px] text-mist">{peso(q.paidCents)}</td>
                      <td className={`py-2 tnum text-[12px] ${q.outputCents - q.paidCents > 0 ? "text-amber-300" : "text-emerald-300"}`}>{peso(q.outputCents - q.paidCents)}</td>
                    </tr>
                  ))}
                  {data.vatByQuarter.length === 0 && <tr><td colSpan={4} className="py-6 text-center text-[12px] text-mist">No VAT billed since the books started.</td></tr>}
                </tbody>
              </table>
            </div>
          </SectionCard>
        </div>
      )}

      {tab === "balance" && (
        <SectionCard
          title="Balance sheet"
          action={
            <Btn variant="ghost" onClick={() => csv("balance-sheet", [
              ["Section", "Account", "Amount"],
              ...data.balanceSheet.assets.map((r) => ["Asset", r.name, r.amountCents / 100]),
              ...data.balanceSheet.liabilities.map((r) => ["Liability", r.name, r.amountCents / 100]),
              ...data.balanceSheet.equity.map((r) => ["Equity", r.name, r.amountCents / 100]),
            ])}><FileDown size={13} /> CSV</Btn>
          }
        >
          {!data.balanceSheet.balanced && (
            <p className="text-[12px] text-amber-300 bg-amber-400/10 border border-amber-400/20 rounded-lg px-3 py-2 mb-4">
              Assets ≠ Liabilities + Equity — an entry may be unbalanced. Check the audit log.
            </p>
          )}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {([
              { title: "Assets", rows: data.balanceSheet.assets, total: data.balanceSheet.totalAssetsCents, tone: "sky" },
              { title: "Liabilities", rows: data.balanceSheet.liabilities, total: data.balanceSheet.totalLiabilitiesCents, tone: "amber" },
              { title: "Equity", rows: data.balanceSheet.equity, total: data.balanceSheet.totalEquityCents, tone: "violet" },
            ] as const).map((col) => (
              <div key={col.title}>
                <p className="text-[10px] uppercase tracking-[0.18em] text-mist mb-2.5">{col.title}</p>
                <div className="divide-y divide-white/[0.05] mb-3">
                  {col.rows.map((r) => (
                    <div key={r.name} className="flex items-center justify-between py-2 text-[12.5px]">
                      <span className="text-chrome">{r.name}</span>
                      <Money cents={r.amountCents} colored />
                    </div>
                  ))}
                  {col.rows.length === 0 && <p className="text-[12px] text-mist py-2">None.</p>}
                </div>
                <div className="flex items-center justify-between pt-2.5 border-t border-white/[0.1] text-[13px]">
                  <span className="text-white">Total</span>
                  <span className="tnum text-white">{peso(col.total)}</span>
                </div>
                <div className="mt-2"><Bar pct={data.balanceSheet.totalAssetsCents > 0 ? (Math.abs(col.total) / data.balanceSheet.totalAssetsCents) * 100 : 0} color={barTone(col.tone)} /></div>
              </div>
            ))}
          </div>
        </SectionCard>
      )}
    </div>
  );
}
