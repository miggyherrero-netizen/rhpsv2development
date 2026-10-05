"use client";

import Link from "next/link";
import { LineChart, TrendingUp, Wallet2, Receipt, Gauge, FileClock } from "lucide-react";
import { peso } from "@/lib/format";
import { EXPENSE_CATEGORY_LABEL } from "@/lib/service";
import { RANGES, chartScale, compactPeso } from "@/lib/service-reports";
import type { FinanceReport } from "@/server/service-data";
import {
  Bar, Chip, Money, RangePicker, SectionCard, StatCard, TONE_BAR, TONE_TEXT,
} from "@/components/service-ui";

const FAINT = { color: "var(--color-svc-text-faint)" } as const;
const SERIES = [
  { key: "invoicedCents", label: "Invoiced", color: "var(--color-svc-accent)" },
  { key: "collectedCents", label: "Collected", color: "var(--color-svc-success)" },
  { key: "expenseCents", label: "Expenses", color: "var(--color-svc-violet)" },
] as const;

export default function FinanceClient({ report }: { report: FinanceReport }) {
  const { kpis, split, months, aging, expenseByCategory, topCustomers, jobMargins, options, range, drafts, granularity } = report;
  const avgSub = options.avgInvoiceBasis === "job" ? "invoiced ÷ jobs completed" : "invoiced ÷ invoices issued";
  const revenueHeading = options.marginExcludesVat ? "Revenue excl. VAT" : "Invoiced";
  const scale = chartScale(Math.max(0, ...months.map((m) => Math.max(m.invoicedCents, m.collectedCents, m.expenseCents))));
  const maxCat = Math.max(1, ...expenseByCategory.map((c) => c.amountCents));
  const maxBucket = Math.max(1, ...aging.buckets.map((b) => b.amountCents));
  const labelEvery = granularity === "day" ? 5 : 1;

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-6 lg:py-8 max-w-[1400px] mx-auto space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[11px] uppercase tracking-[0.2em]" style={FAINT}>Home Service</p>
          <h1 className="font-serif text-3xl mt-1" style={{ color: "var(--color-svc-text)" }}>Finance</h1>
          <p className="text-[12.5px] mt-1" style={{ color: "var(--color-svc-text-dim)" }}>
            Invoicing, collections, costs, and job profitability
          </p>
        </div>
        <RangePicker options={RANGES} value={range.key} />
      </header>

      {drafts.count > 0 && (
        <Link
          href="/service/invoices?filter=draft"
          className="inline-flex items-center gap-2 rounded-xl px-3.5 min-h-10 text-[12.5px] card-svc card-svc-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-svc-accent)]"
          style={{ color: "var(--color-svc-text-dim)" }}
        >
          <FileClock size={14} />
          <span className="svc-num">{drafts.count} draft{drafts.count === 1 ? "" : "s"} · {peso(drafts.totalCents)} not yet sent</span>
          <span style={FAINT}>(not counted below)</span>
        </Link>
      )}

      <section aria-labelledby="fin-range" className="space-y-2.5">
        <h2 id="fin-range" className="text-[13px] font-medium" style={{ color: "var(--color-svc-text-dim)" }}>
          {range.label}
        </h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard label="Invoiced" value={<Money cents={kpis.invoicedCents} />} icon={<Receipt size={15} />} sub={`${kpis.invoiceCount} sent invoice${kpis.invoiceCount === 1 ? "" : "s"}`} />
          <StatCard label="Collected" value={<Money cents={kpis.collectedCents} />} tone="success" icon={<Wallet2 size={15} />} sub="payments received" />
          <StatCard label="Expenses" value={<Money cents={kpis.expenseCents} />} tone="violet" sub="money spent" />
          <StatCard
            label="Net collected"
            value={<Money cents={kpis.netCents} />}
            tone={kpis.netCents >= 0 ? "success" : "danger"}
            sub="collected − expenses"
            icon={<TrendingUp size={15} />}
          />
        </div>
      </section>

      <section aria-labelledby="fin-split" className="space-y-2.5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="fin-split" className="text-[13px] font-medium" style={{ color: "var(--color-svc-text-dim)" }}>
            Profit by business line · {range.label.toLowerCase()}
          </h2>
          {split.unreviewedCount > 0 && (
            <Link href="/service/expenses/review" className="inline-flex items-center min-h-11 text-[12px] hover:underline" style={{ color: TONE_TEXT.warn }}>
              {split.unreviewedCount} expense{split.unreviewedCount === 1 ? "" : "s"} not reviewed yet — sorted by category for now
            </Link>
          )}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <StatCard
            label="Home service" value={<Money cents={split.service.profitCents} />} tone={split.service.profitCents >= 0 ? "success" : "danger"}
            sub={`${peso(split.service.collectedCents)} collected − ${peso(split.service.jobCostCents)} job costs`}
          />
          <StatCard
            label="Piano sales" value={<Money cents={split.sales.profitCents} />} tone={split.sales.profitCents >= 0 ? "azure" : "danger"}
            sub={split.sales.count === 0 ? "no pianos sold in this period" : `${split.sales.count} sold · ${peso(split.sales.revenueCents)} − ${peso(split.sales.costOfGoodsCents)} cost`}
          />
          <StatCard
            label="Overhead" value={<Money cents={-split.overhead.cents} />} tone="violet"
            sub="rent, marketing, running the business"
          />
        </div>
        <p className="text-[12.5px] svc-num" style={FAINT}>
          After overhead: <b className="font-medium" style={{ color: "var(--color-svc-text-dim)" }}>{peso(split.netCents)}</b>
          {split.stockOnHandCents > 0 ? <> · <b className="font-medium" style={{ color: "var(--color-svc-text-dim)" }}>{peso(split.stockOnHandCents)}</b> tied up in unsold piano stock (not counted until sold)</> : null}
        </p>
      </section>

      <section aria-labelledby="fin-now" className="space-y-2.5">
        <h2 id="fin-now" className="text-[13px] font-medium" style={{ color: "var(--color-svc-text-dim)" }}>
          Owed to you · as of today
        </h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard label="Outstanding" href="/service/invoices?filter=open" value={<Money cents={kpis.outstandingCents} />} tone="warn" sub="sent, unpaid balance" />
          <StatCard label="Overdue" href="/service/invoices?filter=overdue" value={<Money cents={kpis.overdueCents} />} tone="danger" sub="past due date" />
          <StatCard label="Avg invoice" value={<Money cents={kpis.avgInvoiceCents} />} sub={`${avgSub} · ${range.label.toLowerCase()}`} />
          <StatCard label="Collection rate" value={`${kpis.collectionRatePct}%`} icon={<Gauge size={15} />} sub="of invoiced, paid so far" />
        </div>
      </section>

      <SectionCard title={`Cashflow · ${range.label.toLowerCase()}`} action={<Legend />}>
        <div className="px-4 sm:px-5 py-5">
          {range.key === "all" && months.length >= 24 && (
            <p className="text-[12px] mb-3" style={FAINT}>Chart shows the latest 24 months; the totals above cover all time.</p>
          )}
          {months.length === 0 ? (
            <p className="text-[12.5px]" style={FAINT}>Nothing to plot yet.</p>
          ) : (
            <div className="flex gap-2" role="group" aria-label={`Cashflow by ${granularity}, ${range.label}. Use Tab to hear each ${granularity}.`}>
              {/* y-axis */}
              <div className="relative w-12 shrink-0 h-56 mt-3 mb-6" aria-hidden="true">
                {scale.ticks.map((t) => (
                  <span key={t} className="svc-num absolute right-0 -translate-y-1/2 text-[11px]" style={{ bottom: `${(t / scale.max) * 100}%`, ...FAINT }}>
                    {compactPeso(t)}
                  </span>
                ))}
              </div>
              <div className="flex-1 min-w-0 mt-3">
                <div className="relative h-56">
                  {scale.ticks.map((t) => (
                    <div key={t} className="absolute inset-x-0 border-t" aria-hidden="true"
                      style={{ bottom: `${(t / scale.max) * 100}%`, borderColor: t === 0 ? "var(--color-svc-border-strong)" : "rgba(255,255,255,0.06)" }} />
                  ))}
                  <div className="absolute inset-0 flex items-end gap-1 sm:gap-2">
                    {months.map((m) => {
                      const summary = `${m.label}: invoiced ${peso(m.invoicedCents)}, collected ${peso(m.collectedCents)}, expenses ${peso(m.expenseCents)}`;
                      return (
                        <div key={m.key} role="group" tabIndex={0} title={summary} aria-label={summary}
                          className="group relative flex-1 h-full flex items-end justify-center gap-px rounded-sm hover:bg-white/[0.04] focus-visible:bg-white/[0.06] focus-visible:outline-2 focus-visible:outline-[var(--color-svc-accent)]">
                          {SERIES.map((s) => (
                            <div key={s.key} className="flex-1 max-w-4 rounded-t-sm"
                              style={{ height: `${Math.max(m[s.key] > 0 ? 1.5 : 0, (m[s.key] / scale.max) * 100)}%`, background: s.color }} />
                          ))}
                          <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-1 z-10 hidden group-hover:block group-focus-visible:block whitespace-nowrap rounded-lg px-2.5 py-1.5 text-[11.5px] card-svc svc-num"
                            style={{ color: "var(--color-svc-text)" }}>
                            <b className="font-medium">{m.label}</b><br />
                            {SERIES.map((s) => <span key={s.key} className="block" style={{ color: s.color }}>{s.label}: {peso(m[s.key])}</span>)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
                <div className="flex gap-1 sm:gap-2 mt-2" aria-hidden="true">
                  {months.map((m, i) => (
                    <p key={m.key} className="flex-1 text-center text-[11px] whitespace-nowrap overflow-visible" style={FAINT}>
                      {i % labelEvery === 0 ? (granularity === "day" ? m.label.replace(/^[A-Za-z]+ /, "") : m.label) : ""}
                    </p>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </SectionCard>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <SectionCard title="Accounts receivable aging" action={<span className="text-[12px]" style={FAINT}>as of today · sent invoices only</span>}>
          <div className="px-5 py-4 space-y-4">
            {aging.buckets.map((b) => (
              <div key={b.key}>
                <div className="flex items-center justify-between text-[12.5px] mb-1.5">
                  <span style={{ color: "var(--color-svc-text-dim)" }}>{b.label}</span>
                  <span className="svc-num" style={{ color: "var(--color-svc-text)" }}>{peso(b.amountCents)}</span>
                </div>
                <Bar
                  pct={(b.amountCents / maxBucket) * 100}
                  color={TONE_BAR[b.key === "current" ? "azure" : b.key === "90_plus" ? "danger" : "warn"]}
                />
                <p className="text-[11.5px] mt-1" style={FAINT}>
                  {b.count} invoice{b.count === 1 ? "" : "s"}
                </p>
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard title="Expenses by category" action={<span className="text-[12px]" style={FAINT}>{range.label.toLowerCase()}</span>}>
          <div className="px-5 py-4 space-y-3">
            {expenseByCategory.length === 0 ? (
              <p className="text-[12.5px]" style={FAINT}>No expenses recorded in this range.</p>
            ) : (
              expenseByCategory.map((c) => (
                <div key={c.category}>
                  <div className="flex items-center justify-between text-[12.5px] mb-1.5">
                    <span style={{ color: "var(--color-svc-text-dim)" }}>
                      {EXPENSE_CATEGORY_LABEL[c.category] ?? c.category}
                    </span>
                    <span className="svc-num" style={{ color: "var(--color-svc-text)" }}>{peso(c.amountCents)}</span>
                  </div>
                  <Bar pct={(c.amountCents / maxCat) * 100} color="var(--color-svc-violet)" />
                </div>
              ))
            )}
          </div>
        </SectionCard>
      </div>

      <div className={`grid grid-cols-1 gap-5 ${options.showJobMargins ? "lg:grid-cols-2" : ""}`}>
        <SectionCard title="Top customers" action={<span className="text-[12px]" style={FAINT}>{range.label.toLowerCase()}</span>}>
          <div className="svc-divide">
            {topCustomers.length === 0 ? (
              <p className="px-5 py-6 text-[12.5px]" style={FAINT}>No billing in this range.</p>
            ) : (
              topCustomers.map((c) => (
                <div key={c.customerId} className="flex items-center justify-between gap-3 px-5 py-3">
                  <span className="text-[13px]" style={{ color: "var(--color-svc-text)" }}>{c.name}</span>
                  <span className="text-right">
                    <Money cents={c.billedCents} className="text-[13px]" />
                    <p className="text-[11.5px]" style={FAINT}>{peso(c.paidCents)} paid</p>
                  </span>
                </div>
              ))
            )}
          </div>
        </SectionCard>

        {options.showJobMargins ? (
          <SectionCard title="Job margins" action={<span className="text-[12px]" style={FAINT}>completed in {range.label.toLowerCase()}</span>}>
            {jobMargins.length === 0 ? (
              <p className="px-5 py-6 text-[12.5px]" style={FAINT}>
                Complete and invoice a job in this range to see its margin.
              </p>
            ) : (
              <div className="overflow-x-auto thin-scroll">
                <table className="w-full text-left">
                  <thead>
                    <tr style={FAINT}>
                      {["Job", revenueHeading, "Cost", "Profit", "Margin"].map((h) => (
                        <th key={h} className="px-5 py-2.5 text-[11px] uppercase tracking-[0.08em] font-normal">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="svc-divide">
                    {jobMargins.map((j) => (
                      <tr key={j.jobId}>
                        <td className="px-5 py-2.5 max-w-[180px]">
                          <Link href={`/service/jobs/${j.jobId}`} className="inline-flex items-center min-h-11 text-[12.5px] hover:underline" style={{ color: "var(--color-svc-text)" }}>
                            {j.title}
                          </Link>
                          <p className="text-[11.5px] truncate" style={FAINT}>{j.customerName}</p>
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
        <p className="text-[12px] flex items-center gap-1.5" style={FAINT}>
          <LineChart size={13} />
          {options.includeLaborCost
            ? "Costs include labor (crew rate × on-site hours), parts, and expenses linked to the job."
            : "Costs include parts and expenses linked to the job; crew labor is excluded."}
        </p>
      ) : null}
    </div>
  );
}

function Legend() {
  return (
    <div className="flex items-center gap-3 text-[11.5px]" style={FAINT}>
      {SERIES.map((s) => (
        <span key={s.key} className="inline-flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full inline-block" style={{ background: s.color }} /> {s.label}
        </span>
      ))}
    </div>
  );
}
