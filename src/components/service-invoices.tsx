"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { Plus, Receipt, Search, ArrowUpRight, Wallet2, FileClock, X } from "lucide-react";
import { fmtDate, peso } from "@/lib/format";
import {
  AGING_BUCKETS, INVOICE_STATUS_LABEL, INVOICE_STATUS_TONE, invoiceCode,
} from "@/lib/service";
import { isCountable } from "@/lib/service-reports";
import { defaultDueDate, parsePesoInput } from "@/lib/service-flow";
import { CustomerPicker } from "@/components/service-forms";
import type { InvoiceRow } from "@/server/service-data";
import { createInvoice, recordPayment, setInvoiceStatus } from "@/server/service";
import {
  Bar, Chip, DateField, EmptyState, ErrorLine, Field, FilterPills, GhostButton, Money, PesoInput, PrimaryButton,
  SectionCard, Select, StatCard, SvcModal, TextInput, TONE_BAR, TONE_TEXT,
} from "@/components/service-ui";

const FILTERS = [
  { key: "open", label: "Unpaid" },
  { key: "all", label: "All" },
  { key: "overdue", label: "Overdue" },
  { key: "paid", label: "Paid" },
  { key: "draft", label: "Draft" },
  { key: "void", label: "Void" },
];

export default function InvoicesClient({
  invoices,
  customers,
  invoicePrefix,
  vatEnabled,
  catalog,
  jobOptions,
  termsDays,
  aging,
  drafts,
  totals,
  initialFilter = "open",
}: {
  totals: { invoiced: number; collected: number; outstanding: number };
  drafts: { count: number; totalCents: number };
  initialFilter?: string;
  invoices: InvoiceRow[];
  customers: { id: string; name: string }[];
  invoicePrefix: string;
  catalog: { id: string; name: string; unitPriceCents: number; taxable: boolean }[];
  jobOptions: { id: string; customerId: string; label: string }[];
  /** Payment-terms setting — new invoices default their due date to today + this. */
  termsDays: number;
  /** Owner setting: new invoices carry no VAT, so the per-line taxable choice is hidden. */
  vatEnabled: boolean;
  aging: {
    buckets: { key: string; label: string; amountCents: number; count: number }[];
    totalOutstandingCents: number;
    overdueCents: number;
  };
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState(() => (FILTERS.some((f) => f.key === initialFilter) ? initialFilter : "open"));
  const [query, setQuery] = useState("");
  const [newOpen, setNewOpen] = useState(false);
  const [payFor, setPayFor] = useState<InvoiceRow | null>(null);

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (res && !res.ok) setError(res.error ?? "Something went wrong.");
    });
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return invoices
      .filter((inv) => {
        if (filter === "all") return true;
        // "Unpaid" = a real receivable (sent / part-paid) with a balance. Drafts have their own filter.
        if (filter === "open") return isCountable(inv) && inv.balanceCents > 0;
        if (filter === "overdue") return inv.status === "overdue";
        return inv.status === filter;
      })
      .filter((inv) => !q || `${inv.customerName} ${invoiceCode(invoicePrefix, inv.invoiceNumber, inv.issueDate)} ${inv.jobTitle ?? ""}`.toLowerCase().includes(q));
  }, [invoices, filter, query, invoicePrefix]);

  const maxBucket = Math.max(1, ...aging.buckets.map((b) => b.amountCents));

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-6 lg:py-8 max-w-[1400px] mx-auto space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[12px] uppercase tracking-[0.2em]" style={{ color: "var(--color-svc-text-faint)" }}>
            Home Service
          </p>
          <h1 className="font-serif text-3xl mt-1" style={{ color: "var(--color-svc-text)" }}>
            Invoices
          </h1>
          <p className="text-[13px] mt-1" style={{ color: "var(--color-svc-text-dim)" }}>
            {filtered.length} shown · {aging.buckets.reduce((s, b) => s + b.count, 0)} unpaid
            {drafts.count > 0 ? (
              <>
                {" · "}
                <button type="button" onClick={() => setFilter("draft")} className="svc-num inline-flex items-center gap-1 underline underline-offset-4 min-h-11" style={{ color: "var(--color-svc-text-dim)" }}>
                  <FileClock size={12} /> {drafts.count} draft{drafts.count === 1 ? "" : "s"} · {peso(drafts.totalCents)} not yet sent
                </button>
              </>
            ) : null}
          </p>
        </div>
        <PrimaryButton onClick={() => setNewOpen(true)}>
          <Plus size={15} /> New invoice
        </PrimaryButton>
      </header>

      <ErrorLine>{error}</ErrorLine>

      <div className="svc-tiles">
        <StatCard label="Invoiced" value={<Money cents={totals.invoiced} />} icon={<Receipt size={15} />} sub="sent · all time" />
        <StatCard label="Collected" value={<Money cents={totals.collected} />} tone="success" icon={<Wallet2 size={15} />} sub="on sent invoices" />
        <button type="button" onClick={() => setFilter("open")} className="text-left rounded-[inherit] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-svc-accent)]">
          <StatCard label="Outstanding" value={<Money cents={totals.outstanding} />} tone="warn" sub="sent, unpaid balance" />
          <span className="sr-only">Show unpaid invoices</span>
        </button>
        <button type="button" onClick={() => setFilter("overdue")} className="text-left rounded-[inherit] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-svc-accent)]">
          <StatCard
            label="Overdue"
            value={<Money cents={aging.overdueCents} />}
            tone={aging.overdueCents > 0 ? "danger" : "slate"}
            sub="past due date"
          />
          <span className="sr-only">Show overdue invoices</span>
        </button>
      </div>

      <div className="grid grid-cols-1 2xl:grid-cols-[1fr_320px] gap-5">
        <SectionCard>
          <div className="flex flex-wrap items-center gap-3 px-5 py-3" style={{ borderBottom: "1px solid var(--color-svc-border)" }}>
            <FilterPills options={FILTERS} value={filter} onChange={setFilter} />
            <div className="hidden sm:block flex-1" />
            <div className="relative w-full sm:w-auto">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--color-svc-text-faint)" }} />
              <TextInput value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search…" aria-label="Search invoices" className="!pl-9 sm:w-56" />
            </div>
          </div>

          {filtered.length === 0 ? (
            <EmptyState
              icon={<Receipt size={19} strokeWidth={1.7} />}
              title="No invoices here"
              hint="Invoices are created from a job, or ad hoc from this screen."
            />
          ) : (
            <>
              {/* Desktop / tablet: compact table that fits without sideways scrolling */}
              <table className="svc-table hidden md:table w-full text-left table-fixed">
                <colgroup>
                  <col />
                  <col className="w-[132px]" />
                  <col className="w-[104px]" />
                  <col className="w-[104px]" />
                  <col className="w-[104px]" />
                  <col className="w-[176px]" />
                </colgroup>
                <thead>
                  <tr style={{ color: "var(--color-svc-text-faint)" }}>
                    {["Invoice / customer", "Issued · due", "Total", "Balance", "Status", ""].map((h) => (
                      <th key={h} className="px-4 py-2.5 text-[12px] uppercase tracking-[0.08em] font-normal">{h || <span className="sr-only">Actions</span>}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="svc-divide">
                  {filtered.map((inv) => (
                    <tr key={inv.id} className="group hover:bg-white/[0.02] transition">
                      <td className="px-4 py-3 min-w-0">
                        <Link
                          href={`/service/invoices/${inv.id}`}
                          className="text-[13px] font-mono hover:underline"
                          style={{ color: "var(--color-svc-text)" }}
                        >
                          {invoiceCode(invoicePrefix, inv.invoiceNumber, inv.issueDate)}
                        </Link>
                        <p className="text-[13px] truncate" style={{ color: "var(--color-svc-text-dim)" }} title={inv.customerName}>
                          {inv.customerName}
                        </p>
                        {inv.jobTitle ? (
                          <p className="text-[12px] truncate" style={{ color: "var(--color-svc-text-faint)" }} title={inv.jobTitle}>
                            {inv.jobTitle}
                          </p>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-[12px] whitespace-nowrap" style={{ color: "var(--color-svc-text-dim)" }}>
                        {fmtDate(new Date(inv.issueDate))}
                        <p style={{ color: inv.status === "overdue" ? TONE_TEXT.danger : "var(--color-svc-text-faint)" }}>
                          {inv.dueDate ? `due ${fmtDate(new Date(inv.dueDate))}` : "no due date"}
                        </p>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap"><Money cents={inv.totalCents} className="text-[14px]" /></td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {inv.status === "draft" || inv.voidedAt
                          ? <span className="text-[13px]" style={{ color: "var(--color-svc-text-faint)" }}>—</span>
                          : <Money cents={inv.balanceCents} className="text-[14px]" />}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <Chip tone={INVOICE_STATUS_TONE[inv.status] ?? "slate"}>
                          {INVOICE_STATUS_LABEL[inv.status] ?? inv.status}
                        </Chip>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex flex-wrap items-center justify-end gap-1.5">
                          <InvoiceActions inv={inv} pending={pending} onPay={() => setPayFor(inv)} onSend={() => run(() => setInvoiceStatus(inv.id, "sent"))} />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Phone: one card per invoice */}
              <ul className="md:hidden svc-divide">
                {filtered.map((inv) => (
                  <li key={inv.id} className="px-4 py-3.5 space-y-2">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <Link href={`/service/invoices/${inv.id}`} className="text-[14px] font-mono hover:underline" style={{ color: "var(--color-svc-text)" }}>
                          {invoiceCode(invoicePrefix, inv.invoiceNumber, inv.issueDate)}
                        </Link>
                        <p className="text-[14px] truncate" style={{ color: "var(--color-svc-text-dim)" }}>{inv.customerName}</p>
                      </div>
                      <Chip tone={INVOICE_STATUS_TONE[inv.status] ?? "slate"}>{INVOICE_STATUS_LABEL[inv.status] ?? inv.status}</Chip>
                    </div>
                    <div className="flex items-end justify-between gap-3 text-[12px]" style={{ color: "var(--color-svc-text-faint)" }}>
                      <span>
                        Issued {fmtDate(new Date(inv.issueDate))}
                        <br />
                        <span style={{ color: inv.status === "overdue" ? TONE_TEXT.danger : undefined }}>
                          {inv.dueDate ? `Due ${fmtDate(new Date(inv.dueDate))}` : "No due date"}
                        </span>
                      </span>
                      <span className="text-right">
                        <Money cents={inv.totalCents} className="text-[14px]" />
                        {inv.status !== "draft" && !inv.voidedAt && inv.balanceCents > 0 && (
                          <span className="block">Balance <Money cents={inv.balanceCents} className="text-[12px]" /></span>
                        )}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <InvoiceActions inv={inv} pending={pending} onPay={() => setPayFor(inv)} onSend={() => run(() => setInvoiceStatus(inv.id, "sent"))} />
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </SectionCard>

        <SectionCard title="Accounts receivable">
          <div className="px-5 py-4 space-y-4">
            {aging.buckets.map((b) => (
              <div key={b.key}>
                <div className="flex items-center justify-between text-[12px] mb-1.5">
                  <span style={{ color: "var(--color-svc-text-dim)" }}>{b.label}</span>
                  <span className="tnum" style={{ color: "var(--color-svc-text)" }}>
                    {peso(b.amountCents)}
                  </span>
                </div>
                <Bar
                  pct={(b.amountCents / maxBucket) * 100}
                  color={TONE_BAR[b.key === "current" ? "azure" : b.key === "90_plus" ? "danger" : "warn"]}
                />
                <p className="text-[12px] mt-1" style={{ color: "var(--color-svc-text-faint)" }}>
                  {b.count} invoice{b.count === 1 ? "" : "s"}
                </p>
              </div>
            ))}
            <div
              className="pt-3 flex items-center justify-between"
              style={{ borderTop: "1px solid var(--color-svc-border)" }}
            >
              <span className="text-[12px]" style={{ color: "var(--color-svc-text-dim)" }}>Total outstanding</span>
              <span className="text-[14px] tnum" style={{ color: "var(--color-svc-text)" }}>
                {peso(aging.totalOutstandingCents)}
              </span>
            </div>
          </div>
        </SectionCard>
      </div>

      <NewInvoiceModal
        open={newOpen}
        onClose={() => setNewOpen(false)}
        customers={customers}
        catalog={catalog}
        jobOptions={jobOptions}
        termsDays={termsDays}
        vatEnabled={vatEnabled}
        pending={pending}
        onCreate={(input) => run(() => createInvoice(input))}
      />

      <PaymentModal
        invoice={payFor}
        onClose={() => setPayFor(null)}
        pending={pending}
        onRecord={(input) => run(() => recordPayment(input))}
      />
    </div>
  );
}

function InvoiceActions({ inv, pending, onPay, onSend }: { inv: InvoiceRow; pending: boolean; onPay: () => void; onSend: () => void }) {
  return (
    <>
      {inv.balanceCents > 0 && !inv.voidedAt && (
        <GhostButton disabled={pending} onClick={onPay} className="!min-h-11 !text-[12px]">Record payment</GhostButton>
      )}
      {inv.status === "draft" && (
        <GhostButton disabled={pending} onClick={onSend} className="!min-h-11 !text-[12px]">Mark sent</GhostButton>
      )}
      <Link href={`/service/invoices/${inv.id}`} className="grid place-items-center h-11 w-11 rounded-lg hover:bg-white/[0.06]" style={{ color: TONE_TEXT.azure }} aria-label="Open invoice">
        <ArrowUpRight size={14} />
      </Link>
    </>
  );
}

type NewInvoiceProps = {
  open: boolean;
  onClose: () => void;
  customers: { id: string; name: string }[];
  catalog: { id: string; name: string; unitPriceCents: number; taxable: boolean }[];
  jobOptions: { id: string; customerId: string; label: string }[];
  termsDays: number;
  vatEnabled: boolean;
  pending: boolean;
  onCreate: (input: {
    customerId: string; jobId: string | null;
    items: { description: string; qty: number; unitPrice: number; taxable: boolean }[];
    dueDate: string | null; notes: string;
  }) => void;
};

function NewInvoiceModal(props: NewInvoiceProps) {
  return (
    <SvcModal open={props.open} onClose={props.onClose} title="New invoice" subtitle="Add as many lines as you need — a job link is optional." wide>
      {props.open && <NewInvoiceBody {...props} />}
    </SvcModal>
  );
}

type DraftLine = { key: number; description: string; qty: string; price: string; taxable: boolean };

function NewInvoiceBody({ onClose, customers, catalog, jobOptions, termsDays, vatEnabled, pending, onCreate }: NewInvoiceProps) {
  const [customerId, setCustomerId] = useState("");
  const [jobId, setJobId] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([{ key: 1, description: "", qty: "1", price: "", taxable: true }]);
  // Due date starts at today + the payment-terms setting, so the usual case needs no typing.
  const [dueDate, setDueDate] = useState(() => defaultDueDate(new Date(), termsDays));
  const [notes, setNotes] = useState("");
  const [nextKey, setNextKey] = useState(2);

  const customerJobs = jobOptions.filter((j) => j.customerId === customerId);
  const patch = (key: number, next: Partial<DraftLine>) => setLines((cur) => cur.map((l) => (l.key === key ? { ...l, ...next } : l)));
  const addLine = (init: Partial<DraftLine> = {}) => {
    setLines((cur) => [...cur, { key: nextKey, description: "", qty: "1", price: "", taxable: true, ...init }]);
    setNextKey((k) => k + 1);
  };
  const usable = lines.filter((l) => l.description.trim());
  const priceBad = usable.some((l) => l.price.trim() !== "" && parsePesoInput(l.price) === null);
  const totalCents = usable.reduce((sum, l) => sum + Math.round((Number(l.qty) || 1) * (parsePesoInput(l.price) ?? 0) * 100), 0);

  return (
    <div className="space-y-4">
      <Field label="Customer"><CustomerPicker customers={customers} value={customerId} onChange={(id) => { setCustomerId(id); setJobId(""); }} autoFocus /></Field>
      {customerId && customerJobs.length > 0 && (
        <Field label="Link to a job (optional)">
          <Select value={jobId} onChange={(e) => setJobId(e.target.value)}>
            <option value="">Not linked to a job</option>
            {customerJobs.map((j) => <option key={j.id} value={j.id}>{j.label}</option>)}
          </Select>
        </Field>
      )}

      <div>
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
          <p className="text-[12px] uppercase tracking-[0.1em]" style={{ color: "var(--color-svc-text-dim)" }}>Lines</p>
          {catalog.length > 0 && (
            <Select
              aria-label="Add a line from the price book" value="" className="!w-auto !min-h-11"
              onChange={(e) => {
                const item = catalog.find((c) => c.id === e.target.value);
                if (!item) return;
                const blank = lines.length === 1 && !lines[0]!.description.trim() && !lines[0]!.price.trim();
                const init = { description: item.name, price: String(item.unitPriceCents / 100), taxable: item.taxable };
                if (blank) patch(lines[0]!.key, init); else addLine(init);
              }}
            >
              <option value="" disabled>＋ From price book…</option>
              {catalog.map((c) => <option key={c.id} value={c.id}>{c.name} — {peso(c.unitPriceCents)}</option>)}
            </Select>
          )}
        </div>
        <div className="space-y-2">
          {lines.map((l, i) => (
            <div key={l.key} className={`grid gap-2 items-start ${vatEnabled ? "grid-cols-[1fr_64px_120px_96px_40px]" : "grid-cols-[1fr_64px_120px_40px]"}`}>
              <TextInput aria-label={`Line ${i + 1} description`} value={l.description} onChange={(e) => patch(l.key, { description: e.target.value })} placeholder="e.g. Concert tuning" />
              <TextInput aria-label={`Line ${i + 1} quantity`} type="number" min={1} inputMode="numeric" value={l.qty} onChange={(e) => patch(l.key, { qty: e.target.value })} />
              <PesoInput aria-label={`Line ${i + 1} unit price`} value={l.price} onChange={(v) => patch(l.key, { price: v })} />
              {vatEnabled && (
                <Select aria-label={`Line ${i + 1} VAT`} value={l.taxable ? "yes" : "no"} onChange={(e) => patch(l.key, { taxable: e.target.value === "yes" })}>
                  <option value="yes">Taxable</option><option value="no">Exempt</option>
                </Select>
              )}
              <button
                type="button" disabled={lines.length === 1} onClick={() => setLines((cur) => cur.filter((x) => x.key !== l.key))}
                aria-label={`Remove line ${i + 1}`} className="grid place-items-center h-11 w-11 rounded-lg hover:bg-white/[0.06] disabled:opacity-30 focus-visible:outline-2 focus-visible:outline-[var(--color-svc-accent)]"
                style={{ color: TONE_TEXT.danger }}
              >
                <X size={16} />
              </button>
            </div>
          ))}
        </div>
        <GhostButton onClick={() => addLine()} className="mt-2 inline-flex items-center gap-1.5 !min-h-11"><Plus size={13} /> Add line</GhostButton>
        {priceBad && <p role="alert" className="text-[12px] mt-2" style={{ color: TONE_TEXT.danger }}>Check the prices — use numbers like 2,500.</p>}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Due date" hint={`Defaults to today + ${termsDays} day${termsDays === 1 ? "" : "s"} (your payment terms)`}>
          <DateField kind="date" value={dueDate} onChange={setDueDate} />
        </Field>
        <Field label="Notes"><TextInput value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Thank you! GCash accepted" /></Field>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
        <p className="text-[14px] svc-num" style={{ color: "var(--color-svc-text-dim)" }}>Subtotal <b className="font-medium" style={{ color: "var(--color-svc-text)" }}>{peso(totalCents)}</b>{vatEnabled ? " + VAT" : ""}</p>
        <div className="flex gap-2">
          <GhostButton onClick={onClose} className="!min-h-11">Cancel</GhostButton>
          <PrimaryButton
            pending={pending} disabled={!customerId || usable.length === 0 || priceBad} className="!min-h-11"
            onClick={() => {
              onCreate({
                customerId, jobId: jobId || null,
                items: usable.map((l) => ({ description: l.description.trim(), qty: Math.max(1, Math.round(Number(l.qty)) || 1), unitPrice: parsePesoInput(l.price) ?? 0, taxable: l.taxable })),
                dueDate: dueDate || null, notes,
              });
              onClose();
            }}
          >
            Create invoice
          </PrimaryButton>
        </div>
      </div>
    </div>
  );
}

function PaymentModal({
  invoice,
  onClose,
  pending,
  onRecord,
}: {
  invoice: InvoiceRow | null;
  onClose: () => void;
  pending: boolean;
  onRecord: (input: { invoiceId: string; amount: number; method: string; reference: string; receivedAt: string | null; markSent: boolean }) => void;
}) {
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("cash");
  const [reference, setReference] = useState("");
  const [receivedAt, setReceivedAt] = useState("");

  if (!invoice) return null;

  return (
    <SvcModal
      open
      onClose={onClose}
      title="Record payment"
      subtitle={`Balance ${peso(invoice.balanceCents)} · ${invoice.customerName}`}
    >
      <div className="space-y-3.5">
        {invoice.status === "draft" && (
          <p className="text-[13px] rounded-lg px-3 py-2" style={{ background: "var(--color-svc-warn-soft)", color: "var(--color-svc-warn)" }}>
            This invoice is still a draft. Recording a payment will <b className="font-medium">mark it as sent</b> first.
          </p>
        )}
        <Field label="Amount">
          <PesoInput value={amount} onChange={setAmount} placeholder={`e.g. ${(invoice.balanceCents / 100).toLocaleString("en-PH")}`} autoFocus />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Method">
            <Select value={method} onChange={(e) => setMethod(e.target.value)}>
              <option value="cash">Cash</option>
              <option value="gcash">GCash</option>
              <option value="maya">Maya</option>
              <option value="bank_transfer">Bank transfer</option>
              <option value="card">Card</option>
              <option value="check">Check</option>
              <option value="other">Other</option>
            </Select>
          </Field>
          <Field label="Reference">
            <TextInput value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Ref / OR number" />
          </Field>
        </div>
        <Field label="Received on" hint="Defaults to today">
          <DateField kind="date" value={receivedAt} onChange={setReceivedAt} />
        </Field>
        <div className="flex flex-wrap gap-2 pt-2">
          <GhostButton onClick={() => setAmount(String(invoice.balanceCents / 100))} className="!min-h-11">Full balance</GhostButton>
          <div className="flex-1" />
          <GhostButton onClick={onClose}>Cancel</GhostButton>
          <PrimaryButton
            pending={pending}
            disabled={!parsePesoInput(amount)}
            onClick={() => {
              onRecord({
                invoiceId: invoice.id,
                amount: parsePesoInput(amount) ?? 0,
                method,
                reference,
                receivedAt: receivedAt ? `${receivedAt}T09:00` : null,
                markSent: invoice.status === "draft",
              });
              onClose();
              setAmount("");
            }}
          >
            {invoice.status === "draft" ? "Mark as sent & record" : "Record payment"}
          </PrimaryButton>
        </div>
      </div>
    </SvcModal>
  );
}
