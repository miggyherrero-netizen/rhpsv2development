"use client";

import Link from "next/link";
import { LineChart, TrendingUp, Wallet2, Receipt, Gauge } from "lucide-react";
import { peso } from "@/lib/format";
import { EXPENSE_CATEGORY_LABEL } from "@/lib/service";
import type { FinanceReport } from "@/server/service-data";
import {
  Bar, Chip, Money, SectionCard, StatCard, TONE_BAR, TONE_TEXT,
} from "@/components/service-ui";

export default function FinanceClient({ report }: { report: FinanceReport }) {
  const { kpis, months, aging, expenseByCategory, topCustomers, jobMargins, options } = report;
  const avgSub = options.avgInvoiceBasis === "job" ? "invoiced ÷ completed jobs" : "invoiced ÷ invoices";
  const revenueHeading = options.marginExcludesVat ? "Revenue excl. VAT" : "Invoiced";
  const maxMonth = Math.max(
    1,
    ...months.map((m) => Math.max(m.invoicedCents, m.collectedCents, m.expenseCents)),
  );
  const maxCat = Math.max(1, ...expenseByCategory.map((c) => c.amountCents));
  const maxBucket = Math.max(1, ...aging.buckets.map((b) => b.amountCents));

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-6 lg:py-8 max-w-[1400px] mx-auto space-y-5">
      <header>
        <p className="text-[10px] uppercase tracking-[0.3em]" style={{ color: "var(--color-svc-text-faint)" }}>
          Home Service
        </p>
        <h1 className="font-serif text-3xl mt-1" style={{ color: "var(--color-svc-text)" }}>
          Finance
        </h1>
        <p className="text-[12.5px] mt-1" style={{ color: "var(--color-svc-text-dim)" }}>
          Invoicing, collections, costs, and job profitability
        </p>
      </header>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Invoiced" value={<Money cents={kpis.invoicedCents} />} icon={<Receipt size={15} />} sub="all time, excl. void" />
        <StatCard label="Collected" value={<Money cents={kpis.collectedCents} />} tone="success" icon={<Wallet2 size={15} />} sub={`${kpis.collectionRatePct}% of invoiced`} />
        <StatCard label="Expenses" value={<Money cents={kpis.expenseCents} />} tone="violet" sub="last 6 months" />
        <StatCard
          label="Net collected"
          value={<Money cents={kpis.netCents} />}
          tone={kpis.netCents >= 0 ? "success" : "danger"}
          sub="collected − expenses"
          icon={<TrendingUp size={15} />}
        />
        <StatCard label="Outstanding" value={<Money cents={kpis.outstandingCents} />} tone="warn" sub="unpaid balance" />
        <StatCard label="Overdue" value={<Money cents={kpis.overdueCents} />} tone="danger" sub="past due date" />
        <StatCard label="Avg invoice" value={<Money cents={kpis.avgInvoiceCents} />} sub={avgSub} />
        <StatCard label="Collection rate" value={`${kpis.collectionRatePct}%`} icon={<Gauge size={15} />} sub="collected ÷ invoiced" />
      </div>

      {/* Monthly chart */}
      <SectionCard title="Cashflow" action={<Legend />}>
        <div className="px-5 py-6">
          <div className="flex items-end gap-3 sm:gap-5 h-52">
            {months.map((m) => (
              <div key={m.key} className="flex-1 flex flex-col items-center gap-2 h-full">
                <div className="flex-1 w-full flex items-end justify-center gap-1">
                  <Bar3 value={m.invoicedCents} max={maxMonth} color="var(--color-svc-accent)" label="Invoiced" />
                  <Bar3 value={m.collectedCents} max={maxMonth} color="var(--color-svc-success)" label="Collected" />
                  <Bar3 value={m.expenseCents} max={maxMonth} color="var(--color-svc-violet)" label="Expenses" />
                </div>
                <p className="text-[10.5px] whitespace-nowrap" style={{ color: "var(--color-svc-text-faint)" }}>
                  {m.label}
                </p>
              </div>
            ))}
          </div>
        </div>
      </SectionCard>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <SectionCard title="Accounts receivable aging">
          <div className="px-5 py-4 space-y-4">
            {aging.buckets.map((b) => (
              <div key={b.key}>
                <div className="flex items-center justify-between text-[12.5px] mb-1.5">
                  <span style={{ color: "var(--color-svc-text-dim)" }}>{b.label}</span>
                  <span className="tnum" style={{ color: "var(--color-svc-text)" }}>{peso(b.amountCents)}</span>
                </div>
                <Bar
                  pct={(b.amountCents / maxBucket) * 100}
                  color={TONE_BAR[b.key === "current" ? "azure" : b.key === "90_plus" ? "danger" : "warn"]}
                />
                <p className="text-[10.5px] mt-1" style={{ color: "var(--color-svc-text-faint)" }}>
                  {b.count} invoice{b.count === 1 ? "" : "s"}
                </p>
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard title="Expenses by category" action={<span className="text-[11px]" style={{ color: "var(--color-svc-text-faint)" }}>last 6 months</span>}>
          <div className="px-5 py-4 space-y-3">
            {expenseByCategory.length === 0 ? (
              <p className="text-[12px]" style={{ color: "var(--color-svc-text-faint)" }}>No expenses recorded.</p>
            ) : (
              expenseByCategory.map((c) => (
                <div key={c.category}>
                  <div className="flex items-center justify-between text-[12.5px] mb-1.5">
                    <span style={{ color: "var(--color-svc-text-dim)" }}>
                      {EXPENSE_CATEGORY_LABEL[c.category] ?? c.category}
                    </span>
                    <span className="tnum" style={{ color: "var(--color-svc-text)" }}>{peso(c.amountCents)}</span>
                  </div>
                  <Bar pct={(c.amountCents / maxCat) * 100} color="var(--color-svc-violet)" />
                </div>
              ))
            )}
          </div>
        </SectionCard>
      </div>

      <div className={`grid grid-cols-1 gap-5 ${options.showJobMargins ? "lg:grid-cols-2" : ""}`}>
        <SectionCard title="Top customers">
          <div className="svc-divide">
            {topCustomers.length === 0 ? (
              <p className="px-5 py-6 text-[12px]" style={{ color: "var(--color-svc-text-faint)" }}>No billing history yet.</p>
            ) : (
              topCustomers.map((c) => (
                <div key={c.customerId} className="flex items-center justify-between gap-3 px-5 py-3">
                  <span className="text-[13px]" style={{ color: "var(--color-svc-text)" }}>{c.name}</span>
                  <span className="text-right">
                    <Money cents={c.billedCents} className="text-[13px]" />
                    <p className="text-[11px]" style={{ color: "var(--color-svc-text-faint)" }}>
                      {peso(c.paidCents)} paid
                    </p>
                  </span>
                </div>
              ))
            )}
          </div>
        </SectionCard>

        {options.showJobMargins ? (
          <SectionCard title="Recent job margins">
            {jobMargins.length === 0 ? (
              <p className="px-5 py-6 text-[12px]" style={{ color: "var(--color-svc-text-faint)" }}>
                Complete and invoice a job to see its margin.
              </p>
            ) : (
              <div className="overflow-x-auto thin-scroll">
                <table className="w-full text-left">
                  <thead>
                    <tr style={{ color: "var(--color-svc-text-faint)" }}>
                      {["Job", revenueHeading, "Cost", "Profit", "Margin"].map((h) => (
                        <th key={h} className="px-5 py-2.5 text-[10px] uppercase tracking-[0.16em] font-normal">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="svc-divide">
                    {jobMargins.map((j) => (
                      <tr key={j.jobId}>
                        <td className="px-5 py-2.5 max-w-[180px]">
                          <Link href={`/service/jobs/${j.jobId}`} className="text-[12.5px] hover:underline" style={{ color: "var(--color-svc-text)" }}>
                            {j.title}
                          </Link>
                          <p className="text-[11px] truncate" style={{ color: "var(--color-svc-text-faint)" }}>{j.customerName}</p>
                        </td>
                        <td className="px-5 py-2.5"><Money cents={j.revenueCents} className="text-[12.5px]" /></td>
                        <td className="px-5 py-2.5"><Money cents={j.costCents} className="text-[12.5px]" /></td>
                        <td className="px-5 py-2.5">
                          <Money cents={j.profitCents} signed className="text-[12.5px]" />
                        </td>
                        <td className="px-5 py-2.5">
                          <Chip tone={j.marginPct >= 40 ? "success" : j.marginPct >= 15 ? "warn" : "danger"}>
                            {j.revenueCents > 0 ? `${j.marginPct}%` : "—"}
                          </Chip>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>
        ) : null}
      </div>

      {options.showJobMargins ? (
        <p className="text-[11.5px] flex items-center gap-1.5" style={{ color: "var(--color-svc-text-faint)" }}>
          <LineChart size={13} />
          {options.includeLaborCost
            ? "Costs include labor (crew rate × on-site hours), parts, and expenses linked to the job."
            : "Costs include parts and expenses linked to the job; crew labor is excluded."}        </p>
      ) : null}
    </div>
  );
}

function Legend() {
  return (
    <div className="flex items-center gap-3 text-[10.5px]" style={{ color: "var(--color-svc-text-faint)" }}>
      <span className="inline-flex items-center gap-1.5">
        <Dot color="var(--color-svc-accent)" /> Invoiced
      </span>
      <span className="inline-flex items-center gap-1.5">
        <Dot color="var(--color-svc-success)" /> Collected
      </span>
      <span className="inline-flex items-center gap-1.5">
        <Dot color="var(--color-svc-violet)" /> Expenses
      </span>
    </div>
  );
}

function Dot({ color }: { color: string }) {
  return <span className="w-2 h-2 rounded-full inline-block" style={{ background: color }} />;
}

function Bar3({ value, max, color, label }: { value: number; max: number; color: string; label: string }) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <div
      className="w-1/4 rounded-t-md transition-all"
      style={{ height: `${Math.max(2, pct)}%`, background: color }}
      title={`${label}: ${peso(value)}`}
    />
  );
}
