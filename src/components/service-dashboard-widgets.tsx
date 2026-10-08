import Link from "next/link";
import {
  ArrowDownRight, ArrowRight, ArrowUpRight, CheckCircle2, Minus, ShieldAlert, Users,
} from "lucide-react";
import { fmtDate, peso } from "@/lib/format";
import { compactPeso } from "@/lib/service-reports";
import { JOB_STATUS_LABEL, JOB_STATUS_TONE } from "@/lib/service";
import {
  barPct, type AttentionItem, type CrewStatus, type Delta, type DashboardMonth, type InvoicedByKind, type PeriodDelta,
} from "@/lib/service-dashboard";
import type { DashboardFinance } from "@/server/service-dashboard-data";
import { Chip, Dot, EmptyState, SectionCard, TONE_BAR, TONE_TEXT } from "@/components/service-ui";

const FAINT = { color: "var(--color-svc-text-faint)" } as const;
const DIM = { color: "var(--color-svc-text-dim)" } as const;
const TEXT = { color: "var(--color-svc-text)" } as const;
const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-svc-accent)]";

/* ------------------------------------------------------------------ deltas */

/** Arrow + words: the direction is never carried by colour alone. */
export function DeltaLine({ delta, higherIsBetter = true }: { delta: Delta; higherIsBetter?: boolean }) {
  const Icon = delta.direction === "up" ? ArrowUpRight : delta.direction === "down" ? ArrowDownRight : Minus;
  const good = delta.direction === "flat" || delta.direction === "none" ? null : (delta.direction === "up") === higherIsBetter;
  const color = good === null ? "var(--color-svc-text-faint)" : good ? TONE_TEXT.success : TONE_TEXT.danger;
  return (
    <span className="inline-flex items-center gap-1" style={{ color }}>
      <Icon size={13} aria-hidden="true" /> {delta.text}
    </span>
  );
}

/**
 * Period change with a direction that always matches its icon and colour, and always has words.
 * up = green arrow, down = red arrow, flat = neutral dash, new = azure "New" chip.
 */
export function PeriodDeltaLine({ delta }: { delta: PeriodDelta }) {
  if (delta.direction === "new") return <Chip tone="azure">{delta.text}</Chip>;
  const Icon = delta.direction === "up" ? ArrowUpRight : delta.direction === "down" ? ArrowDownRight : Minus;
  const color = delta.direction === "up" ? TONE_TEXT.success : delta.direction === "down" ? TONE_TEXT.danger : "var(--color-svc-text-dim)";
  return (
    <span className="inline-flex items-start gap-1" style={{ color }}>
      <Icon size={13} aria-hidden="true" className="shrink-0 mt-[3px]" /> <span>{delta.text.replace(/–/g, "–\u2060")}</span>
    </span>
  );
}

/** Body of the "Invoiced this month" tile: Service and Piano sales on their own lines, then the total. */
export function InvoicedSplit({ split }: { split: InvoicedByKind }) {
  const rows = [
    { key: "service", label: "Service", data: split.service },
    { key: "sales", label: "Piano sales", data: split.sales },
  ];
  return (
    <span className="block text-left">
      <span className="sr-only">{split.rangeLabel}. </span>
      {rows.map((r) => (
        <span key={r.key} className="block mt-3 first:mt-0">
          <span className="block text-[12px] font-normal" style={DIM}>{r.label}</span>
          <span className="svc-num block text-[19px] font-semibold leading-tight" style={TEXT}>{peso(r.data.currentCents)}</span>
          <span className="block text-[12px] font-normal mt-0.5"><PeriodDeltaLine delta={r.data.delta} /></span>
        </span>
      ))}
      <span className="svc-num block mt-3 pt-2 text-[12px] font-normal" style={{ ...DIM, borderTop: "1px solid var(--color-svc-border)" }}>
        Total {peso(split.totalCents)}
      </span>
    </span>
  );
}

/* --------------------------------------------------------- needs attention */

const SEVERITY_LABEL = { danger: "Urgent", warn: "Due", info: "Review" } as const;
const SEVERITY_TONE = { danger: "danger", warn: "warn", info: "azure" } as const;

export function AttentionQueue({ items }: { items: AttentionItem[] }) {
  const total = items.reduce((n, i) => n + i.count, 0);
  return (
    <SectionCard
      title={<span className="inline-flex items-center gap-2"><ShieldAlert size={14} style={{ color: items.length ? TONE_TEXT.warn : TONE_TEXT.success }} aria-hidden="true" /> Needs attention{items.length ? ` (${total})` : ""}</span>}
    >
      {items.length === 0 ? (
        <p className="flex items-center gap-2 px-5 py-6 text-[14px]" style={DIM}>
          <CheckCircle2 size={18} style={{ color: TONE_TEXT.success }} aria-hidden="true" /> Nothing needs attention right now.
        </p>
      ) : (
        <ul className="svc-divide">
          {items.map((it) => (
            <li key={it.key}>
              <Link href={it.href} className={`flex items-center gap-3 px-5 min-h-12 py-2 hover:bg-white/[0.03] ${FOCUS}`}>
                <span className="svc-num w-8 shrink-0 text-[18px] font-semibold text-right" style={{ color: TONE_TEXT[SEVERITY_TONE[it.severity]] }}>{it.count}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[14px] truncate" style={TEXT}>{it.label}</span>
                  {it.amountCents !== undefined && <span className="svc-num block text-[12px]" style={FAINT}>{peso(it.amountCents)}</span>}
                </span>
                <Chip tone={SEVERITY_TONE[it.severity]}>{SEVERITY_LABEL[it.severity]}</Chip>
                <ArrowRight size={14} style={FAINT} aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

/* -------------------------------------------------------------------- crew */

export function CrewStrip({ crew }: { crew: CrewStatus[] }) {
  if (crew.length === 0) return null;
  return (
    <div className="px-5 py-4" style={{ borderBottom: "1px solid var(--color-svc-border)" }}>
      <p className="text-[12px] uppercase tracking-[0.1em] mb-2.5 inline-flex items-center gap-1.5" style={FAINT}><Users size={12} aria-hidden="true" /> Crew</p>
      <ul className="grid gap-2 sm:grid-cols-2">
        {crew.map((c) => (
          <li key={c.technicianId ?? "none"}>
            {c.jobId ? (
              <Link href={`/service/jobs/${c.jobId}`} className={`block rounded-xl px-3.5 py-2.5 min-h-11 hover:bg-white/[0.04] ${FOCUS}`} style={{ background: "var(--color-svc-surface-2)" }}>
                <CrewBody c={c} />
              </Link>
            ) : (
              <div className="rounded-xl px-3.5 py-2.5 min-h-11" style={{ background: "var(--color-svc-surface-2)" }}><CrewBody c={c} /></div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function CrewBody({ c }: { c: CrewStatus }) {
  const tone = c.state === "on_site" ? "warn" : c.state === "en_route" ? "azure" : c.state === "done" ? "success" : "slate";
  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-2 min-w-0 text-[14px]" style={TEXT}><Dot color={c.color ?? "#64748b"} /> <span className="truncate">{c.name}</span></span>
        <span className="svc-num text-[12px] shrink-0" style={DIM}>{c.done}/{c.total} done</span>
      </div>
      <p className="text-[12px] mt-1 truncate" style={{ color: TONE_TEXT[tone] }}>
        {c.stateLabel}{c.place ? ` · ${c.place}` : ""}
      </p>
    </>
  );
}

/* ------------------------------------------------------------------ charts */

/** Six-month Invoiced vs Spent. Rows of bars (not columns) so labels stay 12px+ on a phone. */
export function CashflowChart({ months }: { months: DashboardMonth[] }) {
  const max = Math.max(1, ...months.flatMap((m) => [m.invoicedCents, m.expenseCents]));
  const empty = months.every((m) => m.invoicedCents === 0 && m.expenseCents === 0);
  return (
    <SectionCard
      title="Invoiced vs spent · 6 months"
      action={<Link href="/service/finance" className={`inline-flex items-center min-h-11 text-[12px] hover:underline ${FOCUS}`} style={{ color: TONE_TEXT.azure }}>Open finance</Link>}
    >
      {empty ? (
        <EmptyState title="No invoices or expenses yet" hint="Bars appear here once money is billed or spent." />
      ) : (
        <div className="px-5 py-4">
          <div className="flex gap-4 text-[12px] mb-3" style={DIM} aria-hidden="true">
            <span className="inline-flex items-center gap-1.5"><span className="inline-block w-4 h-2 rounded-sm" style={{ background: TONE_BAR.azure }} /> Invoiced</span>
            <span className="inline-flex items-center gap-1.5"><span className="inline-block w-4 h-2 rounded-sm" style={{ background: HATCH, border: `1px solid ${SPENT}` }} /> Spent</span>
          </div>
          <ul className="space-y-2.5" role="list">
            {months.map((m, i) => (
              <li key={m.key} className="grid grid-cols-[3.25rem_1fr_4.5rem] items-center gap-x-3 gap-y-1">
                <span className="row-span-2 text-[12px]" style={i === months.length - 1 ? TEXT : DIM}>{m.label}</span>
                <div className="h-2 rounded-sm overflow-hidden" style={{ background: "var(--color-svc-surface-2)" }} title={`${m.label} invoiced ${peso(m.invoicedCents)}`}>
                  <div className="h-full rounded-sm" style={{ width: `${barPct(m.invoicedCents, max)}%`, background: TONE_BAR.azure }} />
                </div>
                <span className="svc-num text-[12px] text-right" style={TEXT}>{compactPeso(m.invoicedCents)}</span>
                <div className="h-2 rounded-sm overflow-hidden" style={{ background: "var(--color-svc-surface-2)" }} title={`${m.label} spent ${peso(m.expenseCents)}`}>
                  <div className="h-full rounded-sm" style={{ width: `${barPct(m.expenseCents, max)}%`, background: HATCH, border: m.expenseCents ? `1px solid ${SPENT}` : undefined }} />
                </div>
                <span className="svc-num text-[12px] text-right" style={DIM}>{compactPeso(m.expenseCents)}</span>
              </li>
            ))}
          </ul>
          <div className="sr-only"><table>
            <caption>Invoiced, collected and spent per month, last six months</caption>
            <thead><tr><th scope="col">Month</th><th scope="col">Invoiced</th><th scope="col">Collected</th><th scope="col">Spent</th></tr></thead>
            <tbody>
              {months.map((m) => (
                <tr key={m.key}><th scope="row">{m.label}</th><td>{peso(m.invoicedCents)}</td><td>{peso(m.collectedCents)}</td><td>{peso(m.expenseCents)}</td></tr>
              ))}
            </tbody>
          </table></div>
        </div>
      )}
    </SectionCard>
  );
}

const SPENT = "#94a3b8";
const HATCH = `repeating-linear-gradient(135deg, ${SPENT} 0 2px, transparent 2px 5px)`;

/** Money owed by age. The count and the amount are printed, the bar is only a visual aid. */
export function AgingChart({ aging }: { aging: DashboardFinance["aging"] }) {
  const max = Math.max(0, ...aging.buckets.map((b) => b.amountCents));
  return (
    <SectionCard
      title="Money owed by age"
      action={<Link href="/service/invoices?filter=open" className={`inline-flex items-center min-h-11 text-[12px] hover:underline ${FOCUS}`} style={{ color: TONE_TEXT.azure }}>All unpaid</Link>}
    >
      {aging.totalOutstandingCents <= 0 ? (
        <p className="flex items-center gap-2 px-5 py-6 text-[14px]" style={DIM}><CheckCircle2 size={18} style={{ color: TONE_TEXT.success }} aria-hidden="true" /> No unpaid invoices.</p>
      ) : (
        <ul className="px-5 py-4 space-y-3">
          {aging.buckets.map((b) => (
            <li key={b.key} title={`${b.label}: ${peso(b.amountCents)} across ${b.count} invoice${b.count === 1 ? "" : "s"}`}>
              <div className="flex items-baseline justify-between gap-3 text-[12px]">
                <span style={b.key === "current" ? DIM : { color: TONE_TEXT.danger }}>{b.label}</span>
                <span className="svc-num" style={TEXT}>{peso(b.amountCents)} <span style={FAINT}>· {b.count}</span></span>
              </div>
              <div className="h-2 rounded-sm overflow-hidden mt-1" style={{ background: "var(--color-svc-surface-2)" }}>
                <div className="h-full rounded-sm" style={{ width: `${barPct(b.amountCents, max)}%`, background: b.key === "current" ? TONE_BAR.azure : TONE_BAR.danger }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

export function PipelineChart({ rows }: { rows: { status: string; count: number }[] }) {
  const max = Math.max(0, ...rows.map((r) => r.count));
  const total = rows.reduce((n, r) => n + r.count, 0);
  return (
    <SectionCard
      title="Open jobs by stage"
      action={<Link href="/service/jobs" className={`inline-flex items-center min-h-11 text-[12px] hover:underline ${FOCUS}`} style={{ color: TONE_TEXT.azure }}>All jobs</Link>}
    >
      {total === 0 ? (
        <EmptyState title="No open jobs" hint="New leads and scheduled visits show up here." />
      ) : (
        <ul className="px-5 py-4 space-y-1">
          {rows.map((r) => (
            <li key={r.status}>
              <Link
                href={`/service/jobs?filter=${r.status}`}
                title={`${JOB_STATUS_LABEL[r.status] ?? r.status}: ${r.count}`}
                className={`grid grid-cols-[5.5rem_1fr_2rem] items-center gap-3 min-h-11 rounded-lg hover:bg-white/[0.03] ${FOCUS}`}
              >
                <span className="text-[13px]" style={DIM}>{JOB_STATUS_LABEL[r.status] ?? r.status}</span>
                <span className="h-2 rounded-sm overflow-hidden" style={{ background: "var(--color-svc-surface-2)" }}>
                  <span className="block h-full rounded-sm" style={{ width: `${barPct(r.count, max)}%`, background: TONE_BAR[JOB_STATUS_TONE[r.status] ?? "slate"] }} />
                </span>
                <span className="svc-num text-[14px] text-right" style={TEXT}>{r.count}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

/* ---------------------------------------------------------- recent payments */

export function RecentPayments({ rows }: { rows: DashboardFinance["recentPayments"] }) {
  if (rows.length === 0) return null;
  return (
    <SectionCard title="Recent payments">
      <ul className="svc-divide">
        {rows.map((p) => (
          <li key={p.id}>
            <Link href={`/service/invoices/${p.invoiceId}`} className={`flex items-center justify-between gap-3 px-5 min-h-12 py-2 hover:bg-white/[0.03] ${FOCUS}`}>
              <span className="min-w-0">
                <span className="block text-[14px] truncate" style={TEXT}>{p.customerName}</span>
                <span className="block text-[12px]" style={FAINT}>{fmtDate(new Date(p.receivedAt))}</span>
              </span>
              <span className="svc-num text-[14px] shrink-0" style={{ color: TONE_TEXT.success }}>+{peso(p.amountCents)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}
