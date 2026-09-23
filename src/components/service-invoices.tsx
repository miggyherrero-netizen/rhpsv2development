"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { Plus, Receipt, Search, ArrowUpRight, Wallet2 } from "lucide-react";
import { fmtDate, peso } from "@/lib/format";
import {
  AGING_BUCKETS, INVOICE_STATUS_LABEL, INVOICE_STATUS_TONE, invoiceCode,
} from "@/lib/service";
import type { InvoiceRow } from "@/server/service-data";
import { createInvoice, recordPayment, setInvoiceStatus } from "@/server/service";
import {
  Bar, Chip, EmptyState, ErrorLine, Field, FilterPills, GhostButton, Money, PrimaryButton,
  SectionCard, Select, StatCard, SvcModal, TextInput, TONE_BAR, TONE_TEXT,
} from "@/components/service-ui";

const FILTERS = [
  { key: "open", label: "Open" },
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
  aging,
}: {
  invoices: InvoiceRow[];
  customers: { id: string; name: string }[];
  invoicePrefix: string;
  aging: {
    buckets: { key: string; label: string; amountCents: number; count: number }[];
    totalOutstandingCents: number;
    overdueCents: number;
  };
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("open");
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
        if (filter === "open") return !inv.voidedAt && inv.balanceCents > 0;
        if (filter === "overdue") return inv.status === "overdue";
        return inv.status === filter;
      })
      .filter((inv) => !q || `${inv.customerName} ${invoiceCode(invoicePrefix, inv.invoiceNumber, inv.issueDate)} ${inv.jobTitle ?? ""}`.toLowerCase().includes(q));
  }, [invoices, filter, query, invoicePrefix]);

  const totals = useMemo(() => {
    const invoiced = invoices.filter((i) => !i.voidedAt).reduce((s, i) => s + i.totalCents, 0);
    const collected = invoices.reduce((s, i) => s + i.amountPaidCents, 0);
    return { invoiced, collected, outstanding: aging.totalOutstandingCents };
  }, [invoices, aging.totalOutstandingCents]);

  const maxBucket = Math.max(1, ...aging.buckets.map((b) => b.amountCents));

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-6 lg:py-8 max-w-[1400px] mx-auto space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[10px] uppercase tracking-[0.3em]" style={{ color: "var(--color-svc-text-faint)" }}>
            Home Service
          </p>
          <h1 className="font-serif text-3xl mt-1" style={{ color: "var(--color-svc-text)" }}>
            Invoices
          </h1>
          <p className="text-[12.5px] mt-1" style={{ color: "var(--color-svc-text-dim)" }}>
            {filtered.length} shown · {aging.buckets.reduce((s, b) => s + b.count, 0)} unpaid
          </p>
        </div>
        <PrimaryButton onClick={() => setNewOpen(true)}>
          <Plus size={15} /> New invoice
        </PrimaryButton>
      </header>

      <ErrorLine>{error}</ErrorLine>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Invoiced" value={<Money cents={totals.invoiced} />} icon={<Receipt size={15} />} />
        <StatCard label="Collected" value={<Money cents={totals.collected} />} tone="success" icon={<Wallet2 size={15} />} />
        <StatCard label="Outstanding" value={<Money cents={totals.outstanding} />} tone="warn" sub="unpaid balance" />
        <StatCard
          label="Overdue"
          value={<Money cents={aging.overdueCents} />}
          tone={aging.overdueCents > 0 ? "danger" : "slate"}
          sub="past due date"
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-5">
        <SectionCard>
          <div className="flex flex-wrap items-center gap-3 px-5 py-3" style={{ borderBottom: "1px solid var(--color-svc-border)" }}>
            <FilterPills options={FILTERS} value={filter} onChange={setFilter} />
            <div className="flex-1" />
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--color-svc-text-faint)" }} />
              <TextInput value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search…" className="!pl-9 w-56" />
            </div>
          </div>

          {filtered.length === 0 ? (
            <EmptyState
              icon={<Receipt size={19} strokeWidth={1.7} />}
              title="No invoices here"
              hint="Invoices are created from a job, or ad hoc from this screen."
            />
          ) : (
            <div className="overflow-x-auto thin-scroll">
              <table className="w-full text-left">
                <thead>
                  <tr style={{ color: "var(--color-svc-text-faint)" }}>
                    {["Invoice", "Customer", "Issued", "Due", "Total", "Balance", "Status", ""].map((h) => (
                      <th key={h} className="px-5 py-2.5 text-[10px] uppercase tracking-[0.16em] font-normal whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="svc-divide">
                  {filtered.map((inv) => (
                    <tr key={inv.id} className="group hover:bg-white/[0.02] transition">
                      <td className="px-5 py-3 whitespace-nowrap">
                        <Link
                          href={`/service/invoices/${inv.id}`}
                          className="text-[12.5px] font-mono hover:underline"
                          style={{ color: "var(--color-svc-text)" }}
                        >
                          {invoiceCode(invoicePrefix, inv.invoiceNumber, inv.issueDate)}
                        </Link>
                        {inv.jobTitle ? (
                          <p className="text-[11px] truncate max-w-[180px]" style={{ color: "var(--color-svc-text-faint)" }}>
                            {inv.jobTitle}
                          </p>
                        ) : null}
                      </td>
                      <td className="px-5 py-3 text-[12.5px] whitespace-nowrap" style={{ color: "var(--color-svc-text-dim)" }}>
                        {inv.customerName}
                      </td>
                      <td className="px-5 py-3 text-[12px] whitespace-nowrap" style={{ color: "var(--color-svc-text-dim)" }}>
                        {fmtDate(new Date(inv.issueDate))}
                      </td>
                      <td className="px-5 py-3 text-[12px] whitespace-nowrap" style={{ color: inv.status === "overdue" ? TONE_TEXT.danger : "var(--color-svc-text-dim)" }}>
                        {inv.dueDate ? fmtDate(new Date(inv.dueDate)) : "—"}
                      </td>
                      <td className="px-5 py-3 whitespace-nowrap"><Money cents={inv.totalCents} className="text-[13px]" /></td>
                      <td className="px-5 py-3 whitespace-nowrap">
                        <Money cents={inv.balanceCents} className="text-[13px]" />
                      </td>
                      <td className="px-5 py-3 whitespace-nowrap">
                        <Chip tone={INVOICE_STATUS_TONE[inv.status] ?? "slate"}>
                          {INVOICE_STATUS_LABEL[inv.status] ?? inv.status}
                        </Chip>
                      </td>
                      <td className="px-5 py-3 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5">
                          {inv.balanceCents > 0 && !inv.voidedAt && (
                            <GhostButton
                              disabled={pending}
                              onClick={() => setPayFor(inv)}
                              className="!py-1.5 !text-[11.5px]"
                            >
                              Record payment
                            </GhostButton>
                          )}
                          {inv.status === "draft" && (
                            <GhostButton
                              disabled={pending}
                              onClick={() => run(() => setInvoiceStatus(inv.id, "sent"))}
                              className="!py-1.5 !text-[11.5px]"
                            >
                              Mark sent
                            </GhostButton>
                          )}
                          <Link
                            href={`/service/invoices/${inv.id}`}
                            className="p-1.5 rounded-lg hover:bg-white/[0.06]"
                            style={{ color: TONE_TEXT.azure }}
                            aria-label="Open invoice"
                          >
                            <ArrowUpRight size={14} />
                          </Link>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>

        <SectionCard title="Accounts receivable">
          <div className="px-5 py-4 space-y-4">
            {aging.buckets.map((b) => (
              <div key={b.key}>
                <div className="flex items-center justify-between text-[12px] mb-1.5">
                  <span style={{ color: "var(--color-svc-text-dim)" }}>{b.label}</span>
                  <span className="tnum" style={{ color: "var(--color-svc-text)" }}>
                    {peso(b.amountCents / 100)}
                  </span>
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
            <div
              className="pt-3 flex items-center justify-between"
              style={{ borderTop: "1px solid var(--color-svc-border)" }}
            >
              <span className="text-[12px]" style={{ color: "var(--color-svc-text-dim)" }}>Total outstanding</span>
              <span className="text-[14px] tnum" style={{ color: "var(--color-svc-text)" }}>
                {peso(aging.totalOutstandingCents / 100)}
              </span>
            </div>
          </div>
        </SectionCard>
      </div>

      <NewInvoiceModal
        open={newOpen}
        onClose={() => setNewOpen(false)}
        customers={customers}
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

function NewInvoiceModal({
  open,
  onClose,
  customers,
  pending,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  customers: { id: string; name: string }[];
  pending: boolean;
  onCreate: (input: {
    customerId: string;
    items: { description: string; qty: number; unitPrice: number; taxable: boolean }[];
    dueDate: string | null;
    notes: string;
  }) => void;
}) {
  const [customerId, setCustomerId] = useState("");
  const [description, setDescription] = useState("");
  const [qty, setQty] = useState("1");
  const [price, setPrice] = useState("");
  const [taxable, setTaxable] = useState(true);
  const [dueDate, setDueDate] = useState("");
  const [notes, setNotes] = useState("");

  return (
    <SvcModal open={open} onClose={onClose} title="New invoice" subtitle="Ad hoc invoice — no job required">
      <div className="space-y-3.5">
        <Field label="Customer">
          <Select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
            <option value="">Select a customer…</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-[1fr_80px_120px_90px] gap-2 items-end">
          <Field label="Description">
            <TextInput value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Concert tuning" />
          </Field>
          <Field label="Qty">
            <TextInput type="number" min={1} value={qty} onChange={(e) => setQty(e.target.value)} />
          </Field>
          <Field label="Price">
            <TextInput type="number" step="50" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="2500" />
          </Field>
          <Field label="VAT">
            <Select value={taxable ? "yes" : "no"} onChange={(e) => setTaxable(e.target.value === "yes")}>
              <option value="yes">Taxable</option>
              <option value="no">Exempt</option>
            </Select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Due date">
            <TextInput type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </Field>
          <Field label="Notes">
            <TextInput value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <GhostButton onClick={onClose}>Cancel</GhostButton>
          <PrimaryButton
            pending={pending}
            disabled={!customerId || !description.trim()}
            onClick={() => {
              onCreate({
                customerId,
                items: [{ description: description.trim(), qty: Number(qty) || 1, unitPrice: Number(price) || 0, taxable }],
                dueDate: dueDate || null,
                notes,
              });
              onClose();
              setDescription(""); setPrice(""); setQty("1");
            }}
          >
            Create invoice
          </PrimaryButton>
        </div>
      </div>
    </SvcModal>
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
  onRecord: (input: { invoiceId: string; amount: number; method: string; reference: string; receivedAt: string | null }) => void;
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
      subtitle={`Balance ${peso(invoice.balanceCents / 100)} · ${invoice.customerName}`}
    >
      <div className="space-y-3.5">
        <Field label="Amount" hint="Pesos">
          <TextInput
            type="number"
            step="50"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder={String(invoice.balanceCents / 100)}
            autoFocus
          />
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
        <Field label="Received on" hint="Defaults to now">
          <TextInput type="date" value={receivedAt} onChange={(e) => setReceivedAt(e.target.value)} />
        </Field>
        <div className="flex flex-wrap gap-2 pt-2">
          <GhostButton onClick={() => setAmount(String(invoice.balanceCents / 100))}>Full balance</GhostButton>
          <div className="flex-1" />
          <GhostButton onClick={onClose}>Cancel</GhostButton>
          <PrimaryButton
            pending={pending}
            disabled={!Number(amount)}
            onClick={() => {
              onRecord({
                invoiceId: invoice.id,
                amount: Number(amount),
                method,
                reference,
                receivedAt: receivedAt ? `${receivedAt}T09:00` : null,
              });
              onClose();
              setAmount("");
            }}
          >
            Record payment
          </PrimaryButton>
        </div>
      </div>
    </SvcModal>
  );
}
