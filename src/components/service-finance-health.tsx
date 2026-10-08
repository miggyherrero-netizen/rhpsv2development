import Link from "next/link";
import { ArrowLeft, CheckCircle2, HeartPulse } from "lucide-react";
import { fmtDate } from "@/lib/format";
import type { Finding, Severity } from "@/lib/service-finance-audit";
import type { FinanceHealth } from "@/server/service-finance-audit-data";
import { Chip, EmptyState, Money, SectionCard, StatCard } from "@/components/service-ui";
import type { Tone } from "@/lib/service";

const FAINT = { color: "var(--color-svc-text-faint)" } as const;
const DIM = { color: "var(--color-svc-text-dim)" } as const;

/** Plain-English name for each check, shown as the group heading. */
const CHECK_TITLE: Record<string, string> = {
  invoice_subtotal: "Invoice subtotal does not match its lines",
  invoice_total: "Invoice total does not add up",
  invoice_tax: "Invoice tax is wrong for its lines",
  invoice_amount_paid: "Amount paid does not match the payments",
  invoice_no_items: "Invoice has a total but no lines",
  invoice_overpaid: "Invoice paid more than it is worth",
  status_paid_with_balance: "Marked paid, but money is still owing",
  status_paid_no_payment: "Marked paid, but nothing was paid",
  status_partial_mismatch: "Marked part paid, but the money says otherwise",
  status_unpaid_holds_payment: "Draft or sent invoice that holds payments",
  status_void_holds_payment: "Voided invoice that holds payments",
  invoice_overdue: "Sent invoices past their due date",
  payment_non_positive: "Payment of zero or less",
  payment_before_invoice: "Payment dated before its invoice",
  job_quoted_drift: "Job quote differs from its lines",
  job_parts_drift: "Job parts cost differs from its lines",
  job_labor_drift: "Job labor cost differs from its time logs",
  job_part_cost_maybe_doubled: "Parts and expenses may be counted twice",
  expense_job_kind_mismatch: "Job expense with a different kind",
  expense_amount: "Expense of zero or less",
  expense_no_kind: "Expense not yet sorted (job, stock or overhead)",
  expense_job_no_job: "Job expense not linked to a job",
  expense_stock_no_piano: "Stock expense not linked to a piano",
  expense_duplicate: "Possible duplicate expenses",
  expense_no_receipt: "Large expense without a receipt",
};

const SECTION: { key: Severity; title: string; hint: string; tone: Tone }[] = [
  { key: "error", title: "Errors", hint: "These numbers contradict each other. Fix these first.", tone: "danger" },
  { key: "warn", title: "Warnings", hint: "Probably wrong or incomplete; worth a look.", tone: "warn" },
  { key: "info", title: "For your information", hint: "Not mistakes, just things to know about.", tone: "slate" },
];

/** Where the owner can look at the record behind a finding. */
function linkFor(f: Finding): { href: string; label: string } {
  const { type, id, label } = f.entity;
  if (type === "invoice") return { href: `/service/invoices/${id}`, label: `Open ${label}` };
  if (type === "job") return { href: `/service/jobs/${id}`, label: "Open job" };
  if (type === "payment") {
    return f.invoiceId ? { href: `/service/invoices/${f.invoiceId}`, label: "Open invoice" } : { href: "/service/invoices", label: "Open invoices" };
  }
  return f.code === "expense_no_kind"
    ? { href: "/service/expenses/review", label: "Review expenses" }
    : { href: "/service/expenses", label: "Open expenses" };
}

export default function FinanceHealthView({ health }: { health: FinanceHealth }) {
  const { findings, summary } = health;

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-6 lg:py-8 max-w-[1100px] mx-auto space-y-5">
      <header className="space-y-3">
        <Link
          href="/service/finance"
          className="inline-flex items-center gap-1.5 min-h-11 text-[13px] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-svc-accent)]"
          style={DIM}
        >
          <ArrowLeft size={14} /> Back to Finance
        </Link>
        <div>
          <p className="text-[12px] uppercase tracking-[0.2em]" style={FAINT}>Home Service</p>
          <h1 className="font-serif text-3xl mt-1" style={{ color: "var(--color-svc-text)" }}>Finance health check</h1>
          <p className="text-[13px] mt-1 max-w-2xl" style={DIM}>
            Looks for places where the books do not add up. It only reads your records and never changes anything.
            Checked {fmtDate(new Date(health.checkedAt))}.
          </p>
        </div>
      </header>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Errors" value={summary.errors} tone={summary.errors ? "danger" : "success"} />
        <StatCard label="Warnings" value={summary.warnings} tone={summary.warnings ? "warn" : "success"} />
        <StatCard label="Info" value={summary.info} />
        <StatCard label="Total in dispute" value={<Money cents={summary.disputeCents} />} sub="total of the differences found" tone={summary.disputeCents ? "danger" : "success"} />
      </div>

      {findings.length === 0 ? (
        <SectionCard>
          <EmptyState icon={<CheckCircle2 size={19} strokeWidth={1.7} />} title="Everything balances." hint="No mismatches were found in invoices, payments, jobs or expenses." />
        </SectionCard>
      ) : (
        SECTION.map((sec) => <Section key={sec.key} sec={sec} findings={findings.filter((f) => f.severity === sec.key)} />)
      )}
    </div>
  );
}

function Section({ sec, findings }: { sec: (typeof SECTION)[number]; findings: Finding[] }) {
  if (findings.length === 0) return null;
  const groups = new Map<string, Finding[]>();
  for (const f of findings) groups.set(f.code, [...(groups.get(f.code) ?? []), f]);
  return (
    <section className="space-y-3" aria-labelledby={`sev-${sec.key}`}>
      <div>
        <h2 id={`sev-${sec.key}`} className="text-[16px] font-medium flex items-center gap-2" style={{ color: "var(--color-svc-text)" }}>
          <HeartPulse size={16} /> {sec.title} <Chip tone={sec.tone}>{findings.length}</Chip>
        </h2>
        <p className="text-[13px] mt-0.5" style={DIM}>{sec.hint}</p>
      </div>
      {[...groups.entries()].map(([code, rows]) => (
        <SectionCard key={code} title={<>{CHECK_TITLE[code] ?? code} <span className="svc-num" style={FAINT}>· {rows.length}</span></>}>
          <ul className="svc-divide">
            {rows.map((f) => <Row key={`${code}-${f.entity.id}`} f={f} />)}
          </ul>
        </SectionCard>
      ))}
    </section>
  );
}

function Row({ f }: { f: Finding }) {
  const link = linkFor(f);
  const hasNumbers = f.expectedCents !== undefined || f.actualCents !== undefined;
  return (
    <li className="px-5 py-3 flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
      <div className="min-w-0 flex-1 basis-64">
        <p className="text-[14px] break-words" style={{ color: "var(--color-svc-text)" }}>{f.entity.label}</p>
        <p className="text-[13px]" style={DIM}>{f.message}</p>
      </div>
      {hasNumbers && (
        <dl className="grid grid-cols-3 gap-x-5 text-[13px]">
          <Fig label="Should be" cents={f.expectedCents} />
          <Fig label="Recorded" cents={f.actualCents} />
          <Fig label="Difference" cents={f.diffCents} signed />
        </dl>
      )}
      <Link
        href={link.href}
        className="inline-flex items-center min-h-11 px-3 rounded-xl text-[13px] card-svc card-svc-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-svc-accent)]"
        style={{ color: "var(--color-svc-text)" }}
      >
        {link.label}
      </Link>
    </li>
  );
}

function Fig({ label, cents, signed }: { label: string; cents?: number; signed?: boolean }) {
  return (
    <div>
      <dt className="text-[12px]" style={FAINT}>{label}</dt>
      <dd>{cents === undefined ? <span style={FAINT}>—</span> : <Money cents={cents} signed={signed} />}</dd>
    </div>
  );
}
