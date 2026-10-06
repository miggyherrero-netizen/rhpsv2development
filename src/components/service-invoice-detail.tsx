"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Printer, Send, Ban, FileX2, Pencil, Check, FileText, Trash2 } from "lucide-react";
import { fmtDate, peso, toLocalInput } from "@/lib/format";
import {
  INVOICE_STATUS_LABEL, INVOICE_STATUS_TONE, PAYMENT_METHOD_LABEL,
  computeTotals, invoiceCode, taxLineLabel,
} from "@/lib/service";
import { parsePesoInput } from "@/lib/service-flow";
import LineEditor, { toServerLine, type LineAdapter } from "@/components/service-line-editor";
import type { CatalogEntry, EditorLine } from "@/lib/service-lines";
import type { InvoiceDetail } from "@/server/service-data";
import {
  updateInvoice, addInvoiceItems, updateInvoiceItem, deleteInvoiceItem, setInvoiceStatus, createCatalogItem,
  recordPayment, deletePayment, deleteInvoice,
} from "@/server/service";
import {
  Chip, ConfirmTypeDialog, DateField, EmptyState, ErrorLine, Field, GhostButton, MoreMenu, Money, PesoInput,
  PrimaryButton, SectionCard, Select, SvcModal, TextArea, TextInput, TONE_TEXT, UnitInput, type MoreItem,
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
  ["--color-svc-accent" as string]: "#1f5fbf", ["--color-svc-accent-text" as string]: "#1f5fbf", ["--color-svc-warn" as string]: "#8a5a14", ["--color-svc-success" as string]: "#1f7a52", ["--color-svc-danger" as string]: "#b03a3a",
};

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
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [unlocked, setUnlocked] = useState(false);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("cash");
  const [reference, setReference] = useState("");

  const { invoice, items, payments, customer, settings } = detail;
  // The editor owns the lines while it is open; totals follow what it shows, saved or still saving.
  const editorLines = useMemo<EditorLine[]>(() => items.map((i) => ({
    id: i.id, kind: "service", description: i.description, qty: i.qty, unitPriceCents: i.unitPriceCents, taxable: i.taxable,
    costCents: 0, catalogItemId: null, minutes: null, details: i.details, position: i.position,
  })), []); // eslint-disable-line react-hooks/exhaustive-deps -- seeded once; the editor keeps its own state afterwards
  const [liveLines, setLiveLines] = useState<EditorLine[] | null>(null);
  const lineAdapter = useMemo<LineAdapter>(() => ({
    addMany: async (lines, position) => {
      const res = await addInvoiceItems(invoice.id, lines.map((l) => ({ ...toServerLine(l), position })));
      return res.ok ? { ok: true, ids: res.data!.ids, positions: res.data!.positions } : res;
    },
    update: (id, patch) => updateInvoiceItem(id, patch),
    remove: (id) => deleteInvoiceItem(id),
    saveToPriceBook: async (l) => {
      const res = await createCatalogItem({ name: l.description, description: l.details ?? null, kind: "service", unitPrice: l.unitPriceCents / 100, taxable: l.taxable, estimatedMinutes: 60 });
      if (!res.ok) return res;
      const now = new Date();
      return { ok: true, entry: { id: res.data!.id, name: l.description, kind: "service", unitPriceCents: l.unitPriceCents, taxable: l.taxable, estimatedMinutes: 60, description: l.details ?? null, active: true, isQuickAdd: false, packageId: null, createdAt: now, updatedAt: now } as CatalogEntry };
    },
  }), [invoice.id]);
  const shownItems = liveLines ?? items;
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

  // Draft invoices are always live; a sent/paid one stays read-only until "Edit lines" (a void one never edits).
  const live = invoice.status !== "void" && (isDraft || unlocked);

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
          {!isDraft && invoice.status !== "void" && (
            unlocked ? (
              <PrimaryButton onClick={() => setUnlocked(false)} className="!min-h-10 !text-white"><Check size={14} /> Done editing</PrimaryButton>
            ) : (
              <GhostButton onClick={() => setUnlocked(true)} className="inline-flex items-center gap-1.5 !min-h-10"><Pencil size={13} /> Edit lines</GhostButton>
            )
          )}
          {isDraft && (
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

        {/* Items — live (autosave) on drafts and while unlocked; read-only otherwise */}
        {live ? (
          <div className="mt-5 -mx-5" data-print-hide>
            <LineEditor
              initialLines={editorLines}
              catalog={detail.catalog}
              adapter={lineAdapter}
              onChange={setLiveLines}
              showType={false}
              vatEnabled={hasVat}
              noun="line"
            />
            {!isDraft ? (
              <p className="px-5 pt-2 text-[12px]" style={{ color: "var(--color-svc-text-faint)" }}>
                This invoice was already sent — changes save as you type and update the balance.
              </p>
            ) : null}
          </div>
        ) : (
          <div className="mt-5 overflow-x-auto thin-scroll">
            <table className="w-full text-left">
              <thead>
                <tr style={{ color: "var(--color-svc-text-faint)" }}>
                  {["Description", "Qty", "Unit price", "Amount"].map((h) => (
                    <th key={h} className="py-2 text-[11px] uppercase tracking-[0.08em] font-normal">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id} style={{ borderTop: "1px solid var(--color-svc-border)" }}>
                    <td className="py-2.5 pr-4 text-[13px]" style={{ color: "var(--color-svc-text)" }}>
                      {item.description}
                      {hasVat && !item.taxable ? (
                        <span className="ml-2 text-[11px]" style={{ color: "var(--color-svc-text-faint)" }}>VAT exempt</span>
                      ) : null}
                    </td>
                    <td className="py-2.5 pr-4 text-[13px] svc-num">{item.qty}</td>
                    <td className="py-2.5 pr-4"><Money cents={item.unitPriceCents} className="text-[13px]" /></td>
                    <td className="py-2.5 pr-4"><Money cents={item.qty * item.unitPriceCents} className="text-[13px]" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
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
                    className="inline-flex items-center justify-center min-w-11 min-h-11 rounded-lg opacity-0 group-hover:opacity-100 focus-visible:opacity-100 [@media(pointer:coarse)]:opacity-100 hover:bg-white/[0.06]"
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
              className="grid grid-cols-1 min-[900px]:grid-cols-[1fr_130px_1fr_auto] gap-2 items-end pt-3"
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

