"use client";

/**
 * Phase 3 finance-edit UI: the "Why are you changing this?" prompt and the Edit payment modal.
 * Both only collect input; the server re-checks everything (owner, reason, void, overpayment).
 */

import { useEffect, useId, useState } from "react";
import { toLocalInput } from "@/lib/format";
import { parsePesoInput } from "@/lib/service-flow";
import { overpayError, validateReason, REASON_MAX } from "@/lib/service-finance-edit";
import { PAYMENT_METHODS } from "@/lib/service";
import {
  ErrorLine, Field, GhostButton, PesoInput, PrimaryButton, Select, SvcModal, TextArea, TextInput, TONE_SOFT, TONE_TEXT, DateField,
} from "@/components/service-ui";

const SAVE_FAILED = "Could not save. Try again.";

/** Result of a save callback: null on success, otherwise the message to show inline. */
export type SaveResult = string | null;

/** Required-reason textarea with a live hint. Shared by the dialog and the Edit payment modal. */
export function ReasonField({ value, onChange, autoFocus }: { value: string; onChange: (v: string) => void; autoFocus?: boolean }) {
  const id = useId();
  const check = validateReason(value);
  const touched = value.length > 0;
  return (
    <div>
      <label htmlFor={id} className="block text-[13px] mb-1.5" style={{ color: "var(--color-svc-text)" }}>
        Why are you changing this?
        <span className="ml-1.5 text-[12px]" style={{ color: "var(--color-svc-text-dim)" }}>Required, saved in History</span>
      </label>
      <TextArea
        id={id} rows={3} maxLength={REASON_MAX} value={value} autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={touched && !check.ok ? true : undefined} aria-describedby={`${id}-h`}
        placeholder="e.g. Customer paid less by GCash fee"
      />
      <p id={`${id}-h`} className="text-[12px] mt-1" style={{ color: touched && !check.ok ? TONE_TEXT.warn : "var(--color-svc-text-faint)" }}>
        {touched && !check.ok ? check.error : "At least 3 characters."}
      </p>
    </div>
  );
}

/** Small dialog that asks for a reason, then runs `onConfirm(reason)`. Mounted only while open. */
export function ReasonDialog(props: {
  open: boolean; title: string; message?: string; confirmLabel?: string; danger?: boolean;
  onConfirm: (reason: string) => Promise<SaveResult> | SaveResult; onCancel: () => void;
}) {
  return props.open ? <ReasonDialogInner {...props} /> : null;
}

function ReasonDialogInner({ title, message, confirmLabel = "Save", danger, onConfirm, onCancel }: Parameters<typeof ReasonDialog>[0]) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const id = useId();
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [onCancel]);
  const ready = validateReason(reason).ok;
  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center sm:p-6">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm anim-fade-in" onClick={onCancel} />
      <form
        role="alertdialog" aria-modal="true" aria-labelledby={`${id}-t`}
        onSubmit={async (e) => {
          e.preventDefault();
          const r = validateReason(reason);
          if (!r.ok) { setError(r.error); return; }
          setBusy(true); setError(null);
          try {
            const msg = await onConfirm(r.reason);
            if (msg) setError(msg);
          } catch {
            setError(SAVE_FAILED);
          } finally {
            setBusy(false);
          }
        }}
        className="relative card-svc w-full sm:max-w-sm p-5 sm:p-6 anim-sheet rounded-b-none sm:rounded-b-[14px]"
      >
        <p id={`${id}-t`} className="font-serif text-lg" style={{ color: "var(--color-svc-text)" }}>{title}</p>
        {message ? <p className="text-[13px] mt-1.5 mb-3" style={{ color: "var(--color-svc-text-dim)" }}>{message}</p> : <div className="h-3" />}
        <ReasonField value={reason} onChange={setReason} autoFocus />
        <ErrorLine>{error}</ErrorLine>
        <div className="flex gap-2 mt-5">
          <button type="button" onClick={onCancel} className="btn-svc-ghost flex-1 text-[14px] rounded-xl min-h-11">Cancel</button>
          {danger ? (
            <button
              type="submit" disabled={!ready || busy}
              className="flex-1 text-[14px] rounded-xl min-h-11 font-medium disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ background: TONE_SOFT.danger, color: TONE_TEXT.danger }}
            >
              {busy ? "Saving…" : confirmLabel}
            </button>
          ) : (
            <PrimaryButton type="submit" pending={busy} disabled={!ready} className="flex-1 !min-h-11">{confirmLabel}</PrimaryButton>
          )}
        </div>
      </form>
    </div>
  );
}

export type EditablePayment = {
  id: string; amountCents: number; receivedAt: Date | string; method: string; reference: string | null; note: string | null;
};
export type PaymentPatch = { amount?: number; receivedAt?: string; method?: string; reference?: string | null; note?: string | null; reason: string };

/** Edit one payment in place. Only the fields that really changed are sent. */
type PaymentInvoiceState = { totalCents: number; paidCents: number };

export function EditPaymentModal({ payment, invoiceState, onClose, onSave }: {
  invoiceState: PaymentInvoiceState;
  payment: EditablePayment | null; onClose: () => void; onSave: (patch: PaymentPatch) => Promise<SaveResult>;
}) {
  return (
    <SvcModal open={!!payment} onClose={onClose} title="Edit payment" subtitle="The totals and status are recalculated for you.">
      {payment ? <EditPaymentForm key={payment.id} payment={payment} invoiceState={invoiceState} onClose={onClose} onSave={onSave} /> : null}
    </SvcModal>
  );
}

function EditPaymentForm({ payment, invoiceState, onClose, onSave }: { payment: EditablePayment; invoiceState: PaymentInvoiceState; onClose: () => void; onSave: (p: PaymentPatch) => Promise<SaveResult> }) {
  const amountErrorId = useId();
  const initial = {
    amount: String(payment.amountCents / 100),
    receivedAt: toLocalInput(new Date(payment.receivedAt)).slice(0, 16),
    method: payment.method,
    reference: payment.reference ?? "",
    note: payment.note ?? "",
  };
  const [amount, setAmount] = useState(initial.amount);
  const [receivedAt, setReceivedAt] = useState(initial.receivedAt);
  const [method, setMethod] = useState(initial.method);
  const [reference, setReference] = useState(initial.reference);
  const [note, setNote] = useState(initial.note);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const cents = parsePesoInput(amount);
  const patch: Omit<PaymentPatch, "reason"> = {};
  if (cents !== null && Math.round(cents * 100) !== payment.amountCents) patch.amount = cents;
  if (receivedAt && receivedAt !== initial.receivedAt) patch.receivedAt = receivedAt;
  if (method !== initial.method) patch.method = method;
  if (reference.trim() !== initial.reference.trim()) patch.reference = reference.trim() || null;
  if (note.trim() !== initial.note.trim()) patch.note = note.trim() || null;
  const changed = Object.keys(patch).length > 0;
  const reasonOk = validateReason(reason).ok;
  const amountOk = cents !== null && cents > 0;
  const amountError = amountOk ? overpayError(invoiceState, {
    totalCents: invoiceState.totalCents,
    paidCents: invoiceState.paidCents - payment.amountCents + Math.round(cents * 100),
  }) : null;

  return (
    <form
      className="space-y-3.5"
      onSubmit={async (e) => {
        e.preventDefault();
        const r = validateReason(reason);
        if (!r.ok) { setError(r.error); return; }
        if (!amountOk) { setError("Enter a payment amount above zero."); return; }
        if (amountError) { setError(amountError); return; }
        if (!changed) { setError("Nothing was changed."); return; }
        setBusy(true); setError(null);
        try {
          const msg = await onSave({ ...patch, reason: r.reason });
          if (msg) setError(msg); else onClose();
        } catch {
          setError(SAVE_FAILED);
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Amount">
          <PesoInput value={amount} onChange={setAmount} autoFocus aria-invalid={!!amountError || undefined} aria-describedby={amountError ? amountErrorId : undefined} />
          <div id={amountErrorId}><ErrorLine>{amountError}</ErrorLine></div>
        </Field>
        <Field label="Date received">
          <DateField kind="datetime-local" value={receivedAt} onChange={setReceivedAt} />
        </Field>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Method">
          <Select value={method} onChange={(e) => setMethod(e.target.value)}>
            {PAYMENT_METHODS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
          </Select>
        </Field>
        <Field label="Reference">
          <TextInput value={reference} onChange={(e) => setReference(e.target.value)} maxLength={120} />
        </Field>
      </div>
      <Field label="Note">
        <TextInput value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
      </Field>
      <ReasonField value={reason} onChange={setReason} />
      <ErrorLine>{error}</ErrorLine>
      <div className="flex justify-end gap-2 pt-1">
        <GhostButton type="button" onClick={onClose} className="!min-h-11">Cancel</GhostButton>
        <PrimaryButton type="submit" pending={busy} disabled={!reasonOk || !amountOk || !!amountError || !changed} className="!min-h-11">Save changes</PrimaryButton>
      </div>
    </form>
  );
}
