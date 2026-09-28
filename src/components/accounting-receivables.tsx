"use client";

import Link from "next/link";
import { Receipt, Piano, Workflow } from "lucide-react";
import type { ReceivablesBundle } from "@/server/accounting-data";
import { AccountingHeader, Bar, Chip, Day, Money, SectionCard, StatCard, barTone } from "@/components/accounting-ui";
import { peso } from "@/lib/format";

export default function AccountingReceivables({ data }: { data: ReceivablesBundle }) {
  const serviceTotal = data.service.aging.totalOutstandingCents;
  const projectTotal = data.projects.reduce((s, p) => s + p.balanceCents, 0);
  const pianoTotal = data.pianos.reduce((s, p) => s + p.balanceCents, 0);
  const grand = serviceTotal + projectTotal + pianoTotal;

  return (
    <div className="p-4 sm:p-7 max-w-[1300px] mx-auto">
      <AccountingHeader
        title="Receivables & deposits"
        sub="Who owes the business across all three streams, and customer money held before it is earned."
      />

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-5">
        <StatCard label="Total receivables" value={<Money cents={grand} />} tone={grand > 0 ? "amber" : undefined} icon={<Receipt size={14} />} />
        <StatCard label="Home service" value={<Money cents={serviceTotal} />} sub={`${peso(data.service.aging.overdueCents)} overdue`} />
        <StatCard label="Restorations" value={<Money cents={projectTotal} />} sub={`${data.projects.length} project${data.projects.length === 1 ? "" : "s"}`} />
        <StatCard label="Piano sales" value={<Money cents={pianoTotal} />} sub={`${data.pianos.length} sale${data.pianos.length === 1 ? "" : "s"}`} />
        <StatCard label="Deposits held" value={<Money cents={data.depositsTotalCents} />} tone="violet" sub="unearned customer money" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-5">
        <SectionCard title="Service invoice aging">
          <div className="space-y-3 mb-4">
            {data.service.aging.buckets.map((b) => {
              const tone = b.key === "current" ? "emerald" : b.key === "1_30" ? "amber" : b.key === "31_60" ? "amber" : b.key === "61_90" ? "rose" : "rose";
              return (
                <div key={b.key}>
                  <div className="flex items-center justify-between text-[12px] mb-1">
                    <span className="text-mist">{b.label} · {b.count}</span>
                    <span className="tnum text-chrome">{peso(b.amountCents)}</span>
                  </div>
                  <Bar pct={serviceTotal > 0 ? (b.amountCents / serviceTotal) * 100 : 0} color={barTone(tone)} />
                </div>
              );
            })}
          </div>
          <div className="divide-y divide-white/[0.05] max-h-72 overflow-y-auto thin-scroll">
            {data.service.rows.map((r) => (
              <Link key={r.invoiceId} href={`/service/invoices/${r.invoiceId}`} className="flex items-center justify-between gap-3 py-2.5 hover:bg-white/[0.03] rounded-lg px-1 transition">
                <div className="min-w-0">
                  <p className="text-[12.5px] text-chrome truncate">{r.customerName}</p>
                  <p className="text-[10.5px] text-mist/60">
                    invoice #{r.number}
                    {r.dueDate ? <> · due <Day iso={r.dueDate} /></> : " · no due date"}
                    {r.daysOverdue > 0 && <span className="text-rose-300"> · {r.daysOverdue}d overdue</span>}
                  </p>
                </div>
                <span className="tnum text-[13px] text-white">{peso(r.balanceCents)}</span>
              </Link>
            ))}
            {data.service.rows.length === 0 && <p className="text-[12px] text-mist py-3 text-center">No unpaid service invoices. 🎉</p>}
          </div>
        </SectionCard>

        <div className="space-y-5">
          <SectionCard title="Restoration balances" action={<Workflow size={13} className="text-mist/60" />}>
            <div className="divide-y divide-white/[0.05]">
              {data.projects.map((p) => (
                <Link key={p.projectId} href={`/admin/projects/${p.projectId}`} className="flex items-center justify-between gap-3 py-2.5 hover:bg-white/[0.03] rounded-lg px-1 transition">
                  <div className="min-w-0">
                    <p className="text-[12.5px] text-chrome truncate">{p.label}</p>
                    <p className="text-[10.5px] text-mist/60">
                      {p.finalized ? "billing finalized" : "in progress — quote basis"} · paid {peso(p.paidCents)} of {peso(p.contractCents)}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="tnum text-[13px] text-white">{peso(p.balanceCents)}</p>
                    {!p.finalized && <p className="text-[10px] text-mist/50">not yet billed</p>}
                  </div>
                </Link>
              ))}
              {data.projects.length === 0 && <p className="text-[12px] text-mist py-3 text-center">No open project balances.</p>}
            </div>
          </SectionCard>

          <SectionCard title="Piano sale balances" action={<Piano size={13} className="text-mist/60" />}>
            <div className="divide-y divide-white/[0.05]">
              {data.pianos.map((p) => (
                <div key={p.saleId} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="text-[12.5px] text-chrome truncate">{p.label}{p.buyerName ? ` — ${p.buyerName}` : ""}</p>
                    <p className="text-[10.5px] text-mist/60">{p.status === "completed" ? "sold — balance due" : "reserved"} · paid {peso(p.paidCents)} of {peso(p.priceCents)}</p>
                  </div>
                  <span className="tnum text-[13px] text-white">{peso(p.balanceCents)}</span>
                </div>
              ))}
              {data.pianos.length === 0 && <p className="text-[12px] text-mist py-3 text-center">No piano sale balances.</p>}
            </div>
          </SectionCard>
        </div>
      </div>

      <SectionCard title="Deposits held (unearned)" action={<Chip tone="violet">customer money</Chip>}>
        <p className="text-[11.5px] text-mist mb-3 leading-relaxed">
          These payments sit in your wallets but still belong to customers until billing is finalized (restorations) or the sale completes (pianos). They reduce what is safe to withdraw.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 divide-y divide-white/[0.05] md:divide-y-0">
          {data.deposits.map((d, i) => (
            <div key={i} className="flex items-center justify-between py-2.5 border-b border-white/[0.05]">
              <div>
                <p className="text-[12.5px] text-chrome">{d.label}</p>
                <p className="text-[10.5px] text-mist/60">{d.source === "project" ? "Restoration" : "Piano"} · last <Day iso={d.date} /></p>
              </div>
              <span className="tnum text-[13px] text-white">{peso(d.amountCents)}</span>
            </div>
          ))}
          {data.deposits.length === 0 && <p className="text-[12px] text-mist py-3">No deposits held.</p>}
        </div>
      </SectionCard>
    </div>
  );
}
