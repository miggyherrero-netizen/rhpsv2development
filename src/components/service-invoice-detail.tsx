"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Plus, Trash2, Printer, Send, Ban, FileX2, Pencil, Check, X, Undo2, FileText } from "lucide-react";
import { fmtDate, peso, toLocalInput } from "@/lib/format";
import {
  INVOICE_STATUS_LABEL, INVOICE_STATUS_TONE, PAYMENT_METHOD_LABEL,
  computeTotals, invoiceCode, taxLineLabel,
} from "@/lib/service";
import { parsePesoInput } from "@/lib/service-flow";
import type { InvoiceDetail } from "@/server/service-data";
import {
  updateInvoice, addInvoiceItem, updateInvoiceItem, deleteInvoiceItem, setInvoiceStatus,
  recordPayment, deletePayment, deleteInvoice,
} from "@/server/service";
import {
  Chip, ConfirmTypeDialog, DateField, EmptyState, ErrorLine, Field, GhostButton, MoreMenu, Money, PesoInput,
  PrimaryButton, SectionCard, Select, SuccessLine, SvcModal, TextArea, TextInput, TONE_TEXT, UnitInput, type MoreItem,
} from "@/components/service-ui";

/**
 * The invoice preview is white paper like the printed / PDF document. Re-pointing the svc colour tokens
 * inside this one subtree keeps every child (inputs, Money, chips) legible without touching the dark UI around it.
 */
const PAPER: React.CSSProperties = {
  background: "#ffffff", color: "#172a3e",
  ["--color-svc-text" as string]: "#172a3e", ["--color-svc-text-dim" as string]: "#4d6974", ["--color-svc-text-faint" as string]: "#5f7681",
  ["--color-svc-border" as string]: "rgba(23,42,62,0.14)", ["--color-svc-border-strong" as string]: "rgba(23,42,62,0.28)",
  ["--color-svc-surface" as string]: "#ffffff", ["--color-svc-surface-2" as string]: "#f1f6f5",
  ["--color-svc-accent" as string]: "#1f5fbf", ["--color-svc-warn" as string]: "#8a5a14", ["--color-svc-success" as string]: "#1f7a52", ["--color-svc-danger" as string]: "#b03a3a",
};

type LineDraft = { id: string; qty: string; price: string; removed: boolean };

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
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [lines, setLines] = useState<LineDraft[]>([]);
  const [lineError, setLineError] = useState<string | null>(null);
  const [savedNote, setSavedNote] = useState(false);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("cash");
  const [reference, setReference] = useState("");

  const { invoice, items, payments, customer, settings } = detail;
  // While editing, totals preview the unsaved lines so the owner sees the effect before saving.
  const shownItems = editing
    ? items.flatMap((i) => {
        const d = lines.find((l) => l.id === i.id);
        if (!d) return [i];
        if (d.removed) return [];
        const q = Number(d.qty);
        const pr = parsePesoInput(d.price);
        return [{ ...i, qty: Number.isInteger(q) && q > 0 ? q : i.qty, unitPriceCents: pr === null ? i.unitPriceCents : Math.round(pr * 100) }];
      })
    : items;
  const totals = computeTotals(shownItems, {
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
  const isDraft = invoice.status === "draft";

  const startEdit = () => {
    setLines(items.map((i) => ({ id: i.id, qty: String(i.qty), price: String(i.unitPriceCents / 100), removed: false })));
    setLineError(null);
    setEditing(true);
  };
  const cancelEdit = () => { setEditing(false); setLineError(null); };
  const saveEdit = () => {
    for (const l of lines) {
      if (l.removed) continue;
      const q = Number(l.qty);
      if (!Number.isInteger(q) || q < 1) return setLineError("Quantity must be a whole number, 1 or more.");
      if (parsePesoInput(l.price) === null) return setLineError("Check the unit prices — use numbers like 2,500.");
    }
    if (lines.length > 0 && lines.every((l) => l.removed)) return setLineError("An invoice needs at least one line. Void or delete the invoice instead.");
    setLineError(null);
    startTransition(async () => {
      for (const l of lines) {
        const orig = items.find((i) => i.id === l.id);
        if (!orig) continue;
        if (l.removed) {
          const r = await deleteInvoiceItem(l.id);
          if (!r.ok) return setLineError(r.error);
          continue;
        }
        const qty = Number(l.qty);
        const price = parsePesoInput(l.price)!;
        const qtyChanged = qty !== orig.qty;
        const priceChanged = Math.round(price * 100) !== orig.unitPriceCents;
        if (qtyChanged || priceChanged) {
          const r = await updateInvoiceItem(l.id, { ...(qtyChanged ? { qty } : {}), ...(priceChanged ? { unitPrice: price } : {}) });
          if (!r.ok) return setLineError(r.error);
        }
      }
      setEditing(false);
      setSavedNote(true);
      setTimeout(() => setSavedNote(false), 2800);
    });
  };

  const moreItems: MoreItem[] = [
    ...(isDraft ? [{ label: "Mark as sent", icon: <Send size={14} />, onSelect: () => run(() => setInvoiceStatus(invoice.id, "sent")) }] : []),
    { label: "Edit invoice details…", icon: <FileText size={14} />, onSelect: () => setEditOpen(true) },
    invoice.status !== "void"
      ? { label: "Void invoice", icon: <Ban size={14} />, onSelect: () => run(() => setInvoiceStatus(invoice.id, "void")) }
      : { label: "Reopen as draft", onSelect: () => run(() => setInvoiceStatus(invoice.id, "draft")) },
    { label: "Delete invoice…", danger: true, separated: true, icon: <FileX2 size={14} />, onSelect: () => { setDeleteError(null); setConfirmDelete(true); } },
  ];

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
          <Link href={`/service/invoices/${invoice.id}/document`} className="btn-svc-ghost rounded-xl px-3.5 min-h-10 text-[12.5px] inline-flex items-center gap-1.5">
            <Printer size={13} /> Print / PDF / Share
          </Link>
          {!editing && (
            <GhostButton onClick={startEdit} className="inline-flex items-center gap-1.5 !min-h-10" disabled={invoice.status === "void"}>
              <Pencil size={13} /> Edit
            </GhostButton>
          )}
          {isDraft && !editing && (
            <PrimaryButton pending={pending} onClick={() => run(() => setInvoiceStatus(invoice.id, "sent"))} className="!min-h-10">
              <Send size={13} /> Mark sent
            </PrimaryButton>
          )}
          <MoreMenu items={moreItems} />
        </div>
      </div>

      <ErrorLine>{error}</ErrorLine>

      {/* Document */}
      <div className="rounded-2xl p-6 sm:p-8 shadow-[0_18px_50px_rgba(0,0,0,0.45)]" style={PAPER} data-print-surface>
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

        {/* Items — read-only until Edit is pressed */}
        {editing && (
          <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-xl px-4 py-3" style={{ background: "var(--color-svc-surface-2)" }} data-print-hide>
            <p className="text-[12.5px]" style={{ color: "var(--color-svc-text-dim)" }}>
              Editing lines — nothing is saved until you press <b className="font-medium">Save</b>.
            </p>
            <div className="flex gap-2">
              <GhostButton onClick={cancelEdit} disabled={pending} className="inline-flex items-center gap-1.5 !min-h-10"><X size={13} /> Cancel</GhostButton>
              <PrimaryButton pending={pending} onClick={saveEdit} className="!min-h-10 !text-white"><Check size={14} /> Save changes</PrimaryButton>
            </div>
          </div>
        )}
        {lineError && <p role="alert" className="mt-2 text-[12.5px]" style={{ color: TONE_TEXT.danger }}>{lineError}</p>}
        <SuccessLine>{savedNote ? "Saved" : null}</SuccessLine>

        <div className="mt-5 overflow-x-auto thin-scroll">
          <table className="w-full text-left">
            <thead>
              <tr style={{ color: "var(--color-svc-text-faint)" }}>
                {["Description", "Qty", "Unit price", "Amount", ""].map((h, i) => (
                  <th key={i} className="py-2 text-[11px] uppercase tracking-[0.08em] font-normal">{h || (editing ? "Remove" : "")}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const d = lines.find((l) => l.id === item.id);
                const removed = editing && !!d?.removed;
                const patch = (next: Partial<LineDraft>) => setLines((cur) => cur.map((l) => (l.id === item.id ? { ...l, ...next } : l)));
                const qty = editing && d ? Number(d.qty) : item.qty;
                const price = editing && d ? parsePesoInput(d.price) : item.unitPriceCents / 100;
                const amountCents = Number.isInteger(qty) && qty > 0 && price !== null ? Math.round(qty * price * 100) : item.qty * item.unitPriceCents;
                return (
                  // A removed line is struck through and greyed with a colour (not opacity) so it stays readable.
                  <tr key={item.id} style={{ borderTop: "1px solid var(--color-svc-border)", color: removed ? "var(--color-svc-text-faint)" : undefined, textDecoration: removed ? "line-through" : undefined }}>
                    <td className="py-2.5 pr-4 text-[13px]" style={{ color: removed ? "var(--color-svc-text-faint)" : "var(--color-svc-text)" }}>
                      {item.description}
                      {hasVat && !item.taxable ? (
                        <span className="ml-2 text-[11px]" style={{ color: "var(--color-svc-text-faint)" }}>VAT exempt</span>
                      ) : null}
                    </td>
                    <td className="py-2.5 pr-4 text-[13px] svc-num">
                      {editing && d ? (
                        <input
                          type="number" min={1} inputMode="numeric" aria-label={`Quantity for ${item.description}`} value={d.qty} disabled={removed}
                          onChange={(e) => patch({ qty: e.target.value })} className="input-svc svc-num !w-20 !py-1 !px-2 text-[13px]"
                        />
                      ) : item.qty}
                    </td>
                    <td className="py-2.5 pr-4">
                      {editing && d ? (
                        <PesoInput aria-label={`Unit price for ${item.description}`} value={d.price} disabled={removed} onChange={(v) => patch({ price: v })} className="!w-36 !py-1 text-[13px]" />
                      ) : <Money cents={item.unitPriceCents} className="text-[13px]" />}
                    </td>
                    <td className="py-2.5 pr-4"><Money cents={amountCents} className="text-[13px]" /></td>
                    <td className="py-2.5 text-right" data-print-hide>
                      {editing && d ? (
                        <button
                          type="button" onClick={() => patch({ removed: !d.removed })}
                          className="inline-grid place-items-center h-10 w-10 rounded-lg hover:bg-black/[0.06] focus-visible:outline-2 focus-visible:outline-[var(--color-svc-accent)]"
                          style={{ color: d.removed ? "var(--color-svc-accent)" : "var(--color-svc-danger)" }}
                          aria-label={d.removed ? `Keep ${item.description}` : `Remove ${item.description}`}
                          title={d.removed ? "Keep this line" : "Remove this line"}
                        >
                          {d.removed ? <Undo2 size={15} /> : <X size={16} />}
                        </button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {editing && (
          <div className="flex justify-end mt-3" data-print-hide>
            <GhostButton onClick={() => setItemOpen(true)} className="inline-flex items-center gap-1.5 !min-h-10">
              <Plus size={13} /> Add line
            </GhostButton>
          </div>
        )}

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
              {isDraft && (
                <p className="sm:col-span-4 text-[12.5px] rounded-lg px-3 py-2" style={{ background: "var(--color-svc-warn-soft)", color: "var(--color-svc-warn)" }}>
                  This invoice is still a draft. Recording a payment will <b className="font-medium">mark it as sent</b> first.
                </p>
              )}
              <Field label="Amount">
                <PesoInput value={amount} onChange={setAmount} placeholder={`e.g. ${(invoice.balanceCents / 100).toLocaleString("en-PH")}`} />
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
                <GhostButton onClick={() => setAmount(String(invoice.balanceCents / 100))} className="!min-h-10">Full</GhostButton>
                <PrimaryButton
                  pending={pending}
                  disabled={!parsePesoInput(amount)}
                  className="!min-h-10"
                  onClick={() => {
                    run(() => recordPayment({
                      invoiceId: invoice.id,
                      amount: parsePesoInput(amount) ?? 0,
                      method,
                      reference,
                      receivedAt: null,
                      markSent: isDraft,
                    }));
                    setAmount(""); setReference("");
                  }}
                >
                  {isDraft ? "Mark as sent & record" : "Record"}
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

      <ConfirmTypeDialog
        open={confirmDelete}
        title="Delete this invoice?"
        message="Payments recorded against it are removed too. The linked job keeps its history."
        code={code}
        error={deleteError}
        pending={pending}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={(typed) =>
          startTransition(async () => {
            const res = await deleteInvoice(invoice.id, typed);
            if (res.ok) router.push("/service/invoices");
            else setDeleteError(res.error);
          })
        }
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
            <DateField kind="datetime-local" value={issueDate} onChange={setIssueDate} />
          </Field>
          <Field label="Due date">
            <DateField kind="datetime-local" value={dueDate} onChange={setDueDate} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Tax rate">
            <UnitInput type="number" inputMode="decimal" min={0} step="1" suffix="%" value={taxRate} onChange={(e) => setTaxRate(e.target.value)} />
          </Field>
          <Field label="Discount">
            <PesoInput value={discount === "0" ? "" : discount} onChange={setDiscount} placeholder="e.g. 500" />
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
                discount: parsePesoInput(discount) ?? 0,
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
            <TextInput type="number" min={1} inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} />
          </Field>
          <Field label="Price">
            <PesoInput value={price} onChange={setPrice} />
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
              onCreate({ description: description.trim(), qty: Number(qty) || 1, unitPrice: parsePesoInput(price) ?? 0, taxable });
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
