"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Plus, Trash2, Printer, Send, Ban, FileX2, Pencil } from "lucide-react";
import { fmtDate, peso, toLocalInput } from "@/lib/format";
import {
  INVOICE_STATUS_LABEL, INVOICE_STATUS_TONE, PAYMENT_METHOD_LABEL,
  computeTotals, invoiceCode, taxLineLabel,
} from "@/lib/service";
import type { InvoiceDetail } from "@/server/service-data";
import {
  updateInvoice, addInvoiceItem, updateInvoiceItem, deleteInvoiceItem, setInvoiceStatus,
  recordPayment, deletePayment, deleteInvoice,
} from "@/server/service";
import {
  Chip, ConfirmDialog, EmptyState, ErrorLine, Field, GhostButton, Money, PrimaryButton,
  SectionCard, Select, SvcModal, TextArea, TextInput, TONE_TEXT,
} from "@/components/service-ui";

export default function InvoiceDetailClient({
  detail,
  invoicePrefix,
}: {
  detail: InvoiceDetail;
  invoicePrefix: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [itemOpen, setItemOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("cash");
  const [reference, setReference] = useState("");

  const { invoice, items, payments, customer, settings } = detail;
  const totals = computeTotals(items, {
    discountCents: invoice.discountCents,
    taxRateBps: invoice.taxRateBps,
  });
  // Driven by the invoice's own saved rate, not today's settings: an invoice issued with
  // VAT keeps its tax line; one issued with VAT off (0%) shows no VAT wording at all.
  const hasVat = invoice.taxRateBps > 0 || totals.taxCents > 0;

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (res && !res.ok) setError(res.error ?? "Something went wrong.");
    });
  };

  const code = invoiceCode(invoicePrefix, invoice.invoiceNumber, invoice.issueDate);
  const tone = INVOICE_STATUS_TONE[invoice.status] ?? "slate";

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-6 lg:py-8 max-w-[1100px] mx-auto space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4" data-print-hide>
        <div>
          <Link href="/service/invoices" className="inline-flex items-center gap-1.5 text-[12px] hover:underline" style={{ color: "var(--color-svc-text-faint)" }}>
            <ArrowLeft size={13} /> Invoices
          </Link>
          <div className="flex items-center gap-3 mt-2">
            <h1 className="font-serif text-2xl" style={{ color: "var(--color-svc-text)" }}>{code}</h1>
            <Chip tone={tone}>{INVOICE_STATUS_LABEL[invoice.status] ?? invoice.status}</Chip>
          </div>
          <p className="text-[12.5px] mt-1" style={{ color: "var(--color-svc-text-dim)" }}>
            {customer.name}
            {invoice.jobTitle ? ` · ${invoice.jobTitle}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href={`/service/invoices/${invoice.id}/document`} className="btn-svc-ghost rounded-xl px-3 py-2.5 text-[12px] inline-flex items-center gap-1.5">
            <Printer size={13} /> Print / PDF / Share
          </Link>
          <GhostButton onClick={() => setEditOpen(true)} className="inline-flex items-center gap-1.5">
            <Pencil size={13} /> Edit
          </GhostButton>
          {invoice.status === "draft" && (
            <GhostButton onClick={() => run(() => setInvoiceStatus(invoice.id, "sent"))} className="inline-flex items-center gap-1.5">
              <Send size={13} /> Mark sent
            </GhostButton>
          )}
          {invoice.status !== "void" ? (
            <GhostButton onClick={() => run(() => setInvoiceStatus(invoice.id, "void"))} className="inline-flex items-center gap-1.5">
              <Ban size={13} /> Void
            </GhostButton>
          ) : (
            <GhostButton onClick={() => run(() => setInvoiceStatus(invoice.id, "draft"))}>Reopen</GhostButton>
          )}
          <GhostButton onClick={() => setConfirmDelete(true)} className="inline-flex items-center gap-1.5" style={{ color: TONE_TEXT.danger }}>
            <FileX2 size={13} /> Delete
          </GhostButton>
        </div>
      </div>

      <ErrorLine>{error}</ErrorLine>

      {/* Document */}
      <div className="card-svc p-6 sm:p-8" data-print-surface>
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div>
            <p className="font-serif text-xl" style={{ color: "var(--color-svc-text)" }}>
              {settings.businessName}
            </p>
            <p className="text-[12px] mt-1" style={{ color: "var(--color-svc-text-faint)" }}>
              Home piano service · Davao City
            </p>
          </div>
          <div className="text-right">
            <p className="text-[10px] uppercase tracking-[0.2em]" style={{ color: "var(--color-svc-text-faint)" }}>
              Invoice
            </p>
            <p className="font-mono text-[15px] mt-1" style={{ color: "var(--color-svc-text)" }}>{code}</p>
            <p className="text-[12px] mt-1" style={{ color: "var(--color-svc-text-dim)" }}>
              Issued {fmtDate(new Date(invoice.issueDate))}
            </p>
            {invoice.dueDate ? (
              <p className="text-[12px]" style={{ color: invoice.status === "overdue" ? TONE_TEXT.danger : "var(--color-svc-text-dim)" }}>
                Due {fmtDate(new Date(invoice.dueDate))}
              </p>
            ) : null}
          </div>
        </div>

        <div className="mt-7 pt-5" style={{ borderTop: "1px solid var(--color-svc-border)" }}>
          <p className="text-[10px] uppercase tracking-[0.16em]" style={{ color: "var(--color-svc-text-faint)" }}>
            Billed to
          </p>
          <p className="text-[14px] mt-1" style={{ color: "var(--color-svc-text)" }}>{customer.name}</p>
          {customer.company ? (
            <p className="text-[12.5px]" style={{ color: "var(--color-svc-text-dim)" }}>{customer.company}</p>
          ) : null}
          {customer.phone ? (
            <p className="text-[12.5px]" style={{ color: "var(--color-svc-text-dim)" }}>{customer.phone}</p>
          ) : null}
          {detail.job ? (
            <p className="text-[11.5px] mt-1" style={{ color: "var(--color-svc-text-faint)" }}>
              Job: {detail.job.title}
            </p>
          ) : null}
        </div>

        {/* Items */}
        <div className="mt-7 overflow-x-auto thin-scroll">
          <table className="w-full text-left">
            <thead>
              <tr style={{ color: "var(--color-svc-text-faint)" }}>
                {["Description", "Qty", "Unit price", "Amount", ""].map((h) => (
                  <th key={h} className="py-2 text-[11px] uppercase tracking-[0.08em] font-normal">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="group" style={{ borderTop: "1px solid var(--color-svc-border)" }}>
                  <td className="py-2.5 pr-4 text-[13px]" style={{ color: "var(--color-svc-text)" }}>
                    {item.description}
                    {hasVat && !item.taxable ? (
                      <span className="ml-2 text-[10.5px]" style={{ color: "var(--color-svc-text-faint)" }}>VAT exempt</span>
                    ) : null}
                  </td>
                  <td className="py-2.5 pr-4">
                    <input
                      type="number"
                      min={1}
                      defaultValue={item.qty}
                      onBlur={(e) => {
                        const qty = Number(e.target.value);
                        if (qty > 0 && qty !== item.qty) run(() => updateInvoiceItem(item.id, { qty }));
                      }}
                      className="input-svc !w-16 !py-1 !px-2 text-[12px]"
                    />
                  </td>
                  <td className="py-2.5 pr-4">
                    <input
                      type="number"
                      step="50"
                      defaultValue={item.unitPriceCents / 100}
                      onBlur={(e) => {
                        const value = Number(e.target.value);
                        if (!Number.isNaN(value)) run(() => updateInvoiceItem(item.id, { unitPrice: value }));
                      }}
                      className="input-svc !w-28 !py-1 !px-2 text-[12px]"
                    />
                  </td>
                  <td className="py-2.5 pr-4"><Money cents={item.qty * item.unitPriceCents} className="text-[13px]" /></td>
                  <td className="py-2.5 text-right">
                    <button
                      onClick={() => run(() => deleteInvoiceItem(item.id))}
                      className="p-1.5 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-white/[0.06]"
                      style={{ color: "var(--color-svc-text-faint)" }}
                      aria-label="Remove line"
                    >
                      <Trash2 size={13} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex justify-end mt-3" data-print-hide>
          <GhostButton onClick={() => setItemOpen(true)} className="inline-flex items-center gap-1.5">
            <Plus size={13} /> Add line
          </GhostButton>
        </div>

        {/* Totals */}
        <div className="mt-4 flex justify-end">
          <div className="w-full sm:w-72 space-y-1.5 text-[13px]">
            <Line label="Subtotal"><Money cents={totals.subtotalCents} /></Line>
            {invoice.discountCents > 0 && (
              <Line label="Discount"><Money cents={-invoice.discountCents} /></Line>
            )}
            {hasVat ? (
              <Line label={taxLineLabel(settings.taxLabel, invoice.taxRateBps)}>
                <Money cents={totals.taxCents} />
              </Line>
            ) : null}
            <div className="flex justify-between pt-2" style={{ borderTop: "1px solid var(--color-svc-border)" }}>
              <span style={{ color: "var(--color-svc-text)" }}>Total</span>
              <span className="font-medium tnum"><Money cents={totals.totalCents} /></span>
            </div>
            <Line label="Paid"><Money cents={invoice.amountPaidCents} /></Line>
            <div className="flex justify-between pt-2 text-[15px]" style={{ borderTop: "1px solid var(--color-svc-border)" }}>
              <span style={{ color: "var(--color-svc-text)" }}>Balance due</span>
              <span className="font-medium tnum" style={{ color: invoice.balanceCents > 0 ? TONE_TEXT.warn : TONE_TEXT.success }}>
                <Money cents={invoice.balanceCents} />
              </span>
            </div>
          </div>
        </div>

        {invoice.notes ? (
          <p className="mt-6 text-[12px]" style={{ color: "var(--color-svc-text-dim)" }}>{invoice.notes}</p>
        ) : null}
        {invoice.terms ? (
          <p className="mt-1 text-[11.5px]" style={{ color: "var(--color-svc-text-faint)" }}>{invoice.terms}</p>
        ) : null}
      </div>

      {/* Payments */}
      <SectionCard
        title="Payments"
        action={
          <span className="text-[11.5px]" style={{ color: "var(--color-svc-text-faint)" }}>
            {payments.length} recorded
          </span>
        }
      >
        <div className="px-5 py-4 space-y-3">
          {payments.length === 0 ? (
            <EmptyState title="No payments yet" hint="Record cash, GCash, or bank payments as they come in." />
          ) : (
            <div className="svc-divide">
              {payments.map((p) => (
                <div key={p.id} className="flex items-center gap-3 py-2.5 group">
                  <Chip tone="success">{PAYMENT_METHOD_LABEL[p.method] ?? p.method}</Chip>
                  <span className="text-[12.5px]" style={{ color: "var(--color-svc-text-dim)" }}>
                    {fmtDate(new Date(p.receivedAt))}
                  </span>
                  {p.reference ? (
                    <span className="text-[11.5px]" style={{ color: "var(--color-svc-text-faint)" }}>{p.reference}</span>
                  ) : null}
                  <div className="flex-1" />
                  <Money cents={p.amountCents} className="text-[13px]" />
                  <Link href={`/service/invoices/${invoice.id}/receipts/${p.id}`} className="text-[11.5px] hover:underline" style={{ color: "var(--color-svc-accent)" }}>
                    Receipt / PDF / Share
                  </Link>
                  <button
                    onClick={() => run(() => deletePayment(p.id))}
                    className="p-1.5 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-white/[0.06]"
                    style={{ color: "var(--color-svc-text-faint)" }}
                    aria-label="Delete payment"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {invoice.balanceCents > 0 && invoice.status !== "void" && (
            <div
              className="grid grid-cols-1 sm:grid-cols-[1fr_130px_1fr_auto] gap-2 items-end pt-3"
              style={{ borderTop: "1px solid var(--color-svc-border)" }}
            >
              <Field label="Amount">
                <TextInput
                  type="number"
                  step="50"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder={String(invoice.balanceCents / 100)}
                />
              </Field>
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
                <TextInput value={reference} onChange={(e) => setReference(e.target.value)} />
              </Field>
              <div className="flex gap-2">
                <GhostButton onClick={() => setAmount(String(invoice.balanceCents / 100))}>Full</GhostButton>
                <PrimaryButton
                  pending={pending}
                  disabled={!Number(amount)}
                  onClick={() => {
                    run(() => recordPayment({
                      invoiceId: invoice.id,
                      amount: Number(amount),
                      method,
                      reference,
                      receivedAt: null,
                    }));
                    setAmount(""); setReference("");
                  }}
                >
                  Record
                </PrimaryButton>
              </div>
            </div>
          )}
        </div>
      </SectionCard>

      <EditInvoiceModal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        invoice={invoice}
        pending={pending}
        onSave={(patch) => run(() => updateInvoice(invoice.id, patch))}
      />

      <AddInvoiceItemModal
        open={itemOpen}
        onClose={() => setItemOpen(false)}
        showVat={hasVat}
        pending={pending}
        onCreate={(input) => run(() => addInvoiceItem(invoice.id, input))}
      />

      <ConfirmDialog
        open={confirmDelete}
        title="Delete this invoice?"
        message="Payments recorded against it are removed too. The linked job keeps its history."
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => {
          setConfirmDelete(false);
          startTransition(async () => {
            await deleteInvoice(invoice.id);
            router.push("/service/invoices");
          });
        }}
      />
    </div>
  );
}

function Line({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between">
      <span style={{ color: "var(--color-svc-text-dim)" }}>{label}</span>
      <span>{children}</span>
    </div>
  );
}

function EditInvoiceModal({
  open,
  onClose,
  invoice,
  pending,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  invoice: InvoiceDetail["invoice"];
  pending: boolean;
  onSave: (patch: {
    issueDate: string; dueDate: string | null; taxRateBps: number; discount: number;
    terms: string; notes: string;
  }) => void;
}) {
  const [issueDate, setIssueDate] = useState(invoice.issueDate ? toLocalInput(new Date(invoice.issueDate)).slice(0, 16) : "");
  const [dueDate, setDueDate] = useState(invoice.dueDate ? toLocalInput(new Date(invoice.dueDate)).slice(0, 16) : "");
  const [taxRate, setTaxRate] = useState(String(invoice.taxRateBps / 100));
  const [discount, setDiscount] = useState(String(invoice.discountCents / 100));
  const [terms, setTerms] = useState(invoice.terms ?? "");
  const [notes, setNotes] = useState(invoice.notes ?? "");

  return (
    <SvcModal open={open} onClose={onClose} title="Invoice details">
      <div className="space-y-3.5">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Issue date">
            <TextInput type="datetime-local" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
          </Field>
          <Field label="Due date">
            <TextInput type="datetime-local" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Tax rate" hint="Percent">
            <TextInput type="number" min={0} step="1" value={taxRate} onChange={(e) => setTaxRate(e.target.value)} />
          </Field>
          <Field label="Discount" hint="Pesos">
            <TextInput type="number" min={0} step="50" value={discount} onChange={(e) => setDiscount(e.target.value)} />
          </Field>
        </div>
        <Field label="Terms">
          <TextInput value={terms} onChange={(e) => setTerms(e.target.value)} placeholder="Payment due within 15 days" />
        </Field>
        <Field label="Notes">
          <TextArea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <GhostButton onClick={onClose}>Cancel</GhostButton>
          <PrimaryButton
            pending={pending}
            onClick={() => {
              onSave({
                issueDate,
                dueDate: dueDate || null,
                taxRateBps: Math.round(Number(taxRate) * 100),
                discount: Number(discount) || 0,
                terms,
                notes,
              });
              onClose();
            }}
          >
            Save changes
          </PrimaryButton>
        </div>
      </div>
    </SvcModal>
  );
}

function AddInvoiceItemModal({
  open,
  onClose,
  showVat,
  pending,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  /** Hide the taxable select on invoices that carry no VAT. */
  showVat: boolean;
  pending: boolean;
  onCreate: (input: { description: string; qty: number; unitPrice: number; taxable: boolean }) => void;
}) {
  const [description, setDescription] = useState("");
  const [qty, setQty] = useState("1");
  const [price, setPrice] = useState("");
  const [taxable, setTaxable] = useState(true);

  return (
    <SvcModal open={open} onClose={onClose} title="Add line item">
      <div className="space-y-3.5">
        <Field label="Description">
          <TextInput value={description} onChange={(e) => setDescription(e.target.value)} autoFocus />
        </Field>
        <div className={`grid gap-3 ${showVat ? "grid-cols-3" : "grid-cols-2"}`}>
          <Field label="Qty">
            <TextInput type="number" min={1} value={qty} onChange={(e) => setQty(e.target.value)} />
          </Field>
          <Field label="Price">
            <TextInput type="number" step="50" value={price} onChange={(e) => setPrice(e.target.value)} />
          </Field>
          {showVat ? (
            <Field label="VAT">
              <Select value={taxable ? "yes" : "no"} onChange={(e) => setTaxable(e.target.value === "yes")}>
                <option value="yes">Taxable</option>
                <option value="no">Exempt</option>
              </Select>
            </Field>
          ) : null}
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <GhostButton onClick={onClose}>Cancel</GhostButton>
          <PrimaryButton
            pending={pending}
            disabled={!description.trim()}
            onClick={() => {
              onCreate({ description: description.trim(), qty: Number(qty) || 1, unitPrice: Number(price) || 0, taxable });
              onClose();
              setDescription(""); setPrice(""); setQty("1");
            }}
          >
            Add line
          </PrimaryButton>
        </div>
      </div>
    </SvcModal>
  );
}
