"use client";

/**
 * Type-to-search customer field for the create flows (New job, New invoice, Add to waitlist).
 * Type a name: saved customers that match are listed; a name that isn't saved can be used as is, and is added as a new
 * contact only when the owner saves the form. Pattern: WAI-ARIA 1.2 combobox with a listbox popup.
 * Value is a `CustomerChoice` (existing id | new name + optional phone | none); see src/lib/service-customer-match.ts.
 */

import { Fragment, useEffect, useId, useMemo, useRef, useState } from "react";
import { Plus, X } from "lucide-react";
import {
  CUSTOMER_NAME_MAX, canCreateNew, choiceState, filterCustomers, findDuplicate, matchRanges, normalizeName,
  type CustomerChoice,
} from "@/lib/service-customer-match";
import { titleCaseName } from "@/lib/service-reports";
import { Chip, GhostButton, PrimaryButton, SuccessLine, TextInput } from "@/components/service-ui";

export type { CustomerChoice } from "@/lib/service-customer-match";
export type ComboCustomer = { id: string; name: string; isBatch?: boolean };

/** What a create flow's submit reports back; the form stays open (keeping what was typed) until `ok`. */
export type NewCustomerSubmitResult = { ok: boolean; error?: string; duplicateOf?: { id: string; name: string } };

export const NOT_SAVED_NOTE = "Not saved yet. It will be added as a new contact when you save.";
export const addedNotice = (name: string) => `Added ${name} as a new contact.`;

/** "Added Maria Santos as a new contact." shown on the page after a save that created a customer. */
export function NewContactNotice({ text }: { text: string | null }) {
  return <div role="status" aria-live="polite">{text ? <SuccessLine>{text}</SuccessLine> : null}</div>;
}

const MAX_RESULTS = 30;
const ROW = "flex items-center gap-2 w-full min-h-11 px-3 text-left text-[14px] cursor-pointer";

function Highlighted({ text, query }: { text: string; query: string }) {
  const ranges = useMemo(() => matchRanges(text, query), [text, query]);
  if (!ranges.length) return <>{text}</>;
  const parts: React.ReactNode[] = [];
  let at = 0;
  ranges.forEach(([a, b], i) => {
    if (a > at) parts.push(<Fragment key={`t${i}`}>{text.slice(at, a)}</Fragment>);
    parts.push(<mark key={`m${i}`} className="bg-transparent font-semibold underline underline-offset-2 decoration-[var(--color-svc-accent)]" style={{ color: "var(--color-svc-text)" }}>{text.slice(a, b)}</mark>);
    at = b;
  });
  if (at < text.length) parts.push(<Fragment key="rest">{text.slice(at)}</Fragment>);
  return <>{parts}</>;
}

export function CustomerCombobox({
  label, customers, value, onChange, autoFocus, placeholder = "Type a name…", newAllowed = true,
}: {
  label: string;
  customers: ComboCustomer[];
  value: CustomerChoice;
  onChange: (next: CustomerChoice) => void;
  autoFocus?: boolean;
  placeholder?: string;
  /** False: only saved customers can be chosen (no "create" row). */
  newAllowed?: boolean;
}) {
  const uid = useId();
  const ids = { input: `${uid}-in`, list: `${uid}-list`, label: `${uid}-label`, helper: `${uid}-helper`, opt: (i: number) => `${uid}-opt-${i}` };
  const inputRef = useRef<HTMLInputElement>(null);
  const changeRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const focusAfter = useRef<"input" | "chip" | null>(null);

  const [text, setText] = useState(value.kind === "new" ? value.name : "");
  const [phone, setPhone] = useState(value.kind === "new" ? value.phone ?? "" : "");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);

  const selected = value.kind === "existing" ? customers.find((c) => c.id === value.id) ?? null : null;
  const typed = text.trim().replace(/\s+/g, " ");
  const matches = useMemo(() => (typed ? filterCustomers(customers, typed, MAX_RESULTS) : customers.slice(0, MAX_RESULTS)), [customers, typed]);
  const dup = useMemo(() => (typed ? findDuplicate(typed, customers) : ({ kind: "none" } as const)), [customers, typed]);
  const showCreate = newAllowed && canCreateNew(typed) && dup.kind !== "exact";
  const optionCount = matches.length + (showCreate ? 1 : 0);
  const createIndex = showCreate ? matches.length : -1;
  const state = useMemo(() => choiceState(value, customers), [value, customers]);

  // After the field swaps between the typing box and the chosen-customer chip, keep keyboard focus in the field.
  useEffect(() => {
    if (focusAfter.current === "input") inputRef.current?.focus();
    if (focusAfter.current === "chip") changeRef.current?.focus();
    focusAfter.current = null;
  });
  const activeId = open && active >= 0 ? ids.opt(active) : undefined;
  useEffect(() => {
    if (activeId) document.getElementById(activeId)?.scrollIntoView({ block: "nearest" });
  }, [activeId]);

  const emit = (nextText: string, nextPhone: string, allowDuplicate = false) => {
    const name = nextText.trim().replace(/\s+/g, " ");
    if (!name) return onChange({ kind: "none" });
    onChange({ kind: "new", name, ...(nextPhone.trim() ? { phone: nextPhone.trim() } : {}), ...(allowDuplicate ? { allowDuplicate: true } : {}) });
  };
  const pickExisting = (c: ComboCustomer) => {
    setText(""); setPhone(""); setOpen(false); setActive(-1);
    focusAfter.current = "chip";
    onChange({ kind: "existing", id: c.id });
  };
  const chooseOption = (i: number) => {
    if (i === createIndex) { setOpen(false); setActive(-1); return; }
    const c = matches[i];
    if (c) pickExisting(c);
  };
  const change = () => {
    setText(""); setPhone(""); setActive(-1); setOpen(true);
    focusAfter.current = "input";
    onChange({ kind: "none" });
  };
  const clear = () => {
    setText(""); setPhone(""); setOpen(false); setActive(-1);
    focusAfter.current = "input";
    onChange({ kind: "none" });
  };

  const onType = (v: string) => {
    setText(v);
    setOpen(true);
    const q = v.trim().replace(/\s+/g, " ");
    // An exact saved name is pre-highlighted so Enter picks it; otherwise Enter just keeps what was typed.
    const nq = normalizeName(q);
    const exact = q ? filterCustomers(customers, q, MAX_RESULTS).findIndex((c) => normalizeName(c.name) === nq) : -1;
    setActive(exact);
    emit(v, phone);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // Enter / arrows while an input method (Japanese, Chinese, …) is composing text belong to the IME.
    if (e.nativeEvent.isComposing) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) { setOpen(true); setActive(e.key === "ArrowDown" ? 0 : optionCount - 1); return; }
      if (!optionCount) return;
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive((a) => (a < 0 ? (step === 1 ? 0 : optionCount - 1) : (a + step + optionCount) % optionCount));
    } else if (e.key === "Enter") {
      if (!open) return;
      e.preventDefault();
      if (active >= 0) chooseOption(active); else setOpen(false);
    } else if (e.key === "Escape") {
      if (open) { e.preventDefault(); e.stopPropagation(); setOpen(false); setActive(-1); }
    } else if (e.key === "Tab") {
      setOpen(false);
    }
  };

  const labelEl = (
    <span id={ids.label} className="block text-[12px] uppercase tracking-[0.1em] mb-1.5" style={{ color: "var(--color-svc-text-dim)" }}>{label}</span>
  );

  if (value.kind === "existing") {
    return (
      <div>
        {labelEl}
        <div
          role="group" aria-labelledby={ids.label}
          className="flex items-center justify-between gap-2 min-h-11 rounded-[10px] pl-3 pr-1"
          style={{ background: "var(--color-svc-surface-2)", border: "1px solid var(--color-svc-border-strong)" }}
        >
          <span className="flex items-center gap-2 min-w-0">
            <span className="text-[15px] truncate" style={{ color: "var(--color-svc-text)" }}>{selected?.name ?? "Selected customer"}</span>
            {selected?.isBatch && <Chip>Trip / batch</Chip>}
          </span>
          <button
            ref={changeRef} type="button" onClick={change}
            className="inline-flex items-center gap-1.5 min-h-11 px-3 rounded-lg text-[13px] hover:bg-white/[0.06] !outline-offset-[-2px]"
            style={{ color: "var(--color-svc-accent)" }}
          >
            <X size={14} aria-hidden="true" /> Change<span className="sr-only"> customer</span>
          </button>
        </div>
      </div>
    );
  }

  const isNew = value.kind === "new";
  // Always mounted while a new name is typed (only the listbox hides), so clicking Save never moves under the pointer.
  const showDetails = isNew;
  const showPrompt = showDetails && state === "needs-decision" && dup.kind !== "none";
  const invalid = showDetails && state === "invalid";
  const dupName = dup.kind !== "none" ? dup.customer.name : "";
  const describedBy = [showDetails ? ids.helper : null].filter(Boolean).join(" ") || undefined;

  return (
    <div>
      <label id={ids.label} htmlFor={ids.input} className="block text-[12px] uppercase tracking-[0.1em] mb-1.5" style={{ color: "var(--color-svc-text-dim)" }}>{label}</label>
      <div className="relative">
        <input
          ref={inputRef} id={ids.input} type="text" role="combobox" aria-autocomplete="list" aria-expanded={open}
          aria-controls={ids.list} aria-activedescendant={activeId}
          aria-describedby={describedBy} aria-invalid={invalid || undefined}
          autoComplete="off" autoCapitalize="words" spellCheck={false} maxLength={CUSTOMER_NAME_MAX + 40} autoFocus={autoFocus}
          value={text} placeholder={placeholder}
          onChange={(e) => onType(e.target.value)} onKeyDown={onKeyDown}
          onClick={() => { if (!open) setOpen(true); }}
          onBlur={() => { setOpen(false); setActive(-1); }}
          className="input-svc"
          style={{ paddingRight: text ? "2.9rem" : undefined }}
        />
        {text && (
          <button
            type="button" tabIndex={-1} aria-label="Clear customer" onClick={clear}
            onMouseDown={(e) => e.preventDefault()}
            className="absolute right-0 top-0 grid place-items-center w-11 h-11 rounded-lg hover:bg-white/[0.06]"
            style={{ color: "var(--color-svc-text-dim)" }}
          >
            <X size={16} aria-hidden="true" />
          </button>
        )}

        <div
          hidden={!open}
          className="absolute left-0 right-0 top-full mt-1.5 z-30 overflow-hidden rounded-xl border"
          style={{ background: "var(--color-svc-surface-2)", borderColor: "var(--color-svc-border-strong)", boxShadow: "0 16px 40px rgba(0,0,0,0.45)" }}
          onMouseDown={(e) => e.preventDefault()}
        >
          {!matches.length && typed && (
            <p className="px-3 min-h-11 flex items-center text-[13px]" style={{ color: "var(--color-svc-text-dim)" }}>
              No saved customer with that name
            </p>
          )}
          {!matches.length && !typed && (
            <p className="px-3 min-h-11 flex items-center text-[13px]" style={{ color: "var(--color-svc-text-dim)" }}>No saved customers yet. Type a name to add one.</p>
          )}
          <ul
            ref={listRef} id={ids.list} role="listbox" aria-label={`${label} suggestions`}
            className="max-h-[min(22rem,45dvh)] overflow-y-auto overscroll-contain thin-scroll"
          >
            {matches.map((c, i) => (
              <li
                key={c.id} id={ids.opt(i)} role="option" aria-selected={active === i}
                onClick={() => chooseOption(i)} onMouseMove={() => { if (active !== i) setActive(i); }}
                className={ROW}
                style={{ color: "var(--color-svc-text)", background: active === i ? "var(--color-svc-accent-soft)" : undefined, boxShadow: active === i ? "inset 3px 0 0 var(--color-svc-accent)" : undefined }}
              >
                <span className="min-w-0 truncate"><Highlighted text={c.name} query={typed} /></span>
                {c.isBatch && <Chip className="shrink-0">Trip / batch</Chip>}
              </li>
            ))}
            {showCreate && (
              <li
                id={ids.opt(createIndex)} role="option" aria-selected={active === createIndex}
                onClick={() => chooseOption(createIndex)} onMouseMove={() => { if (active !== createIndex) setActive(createIndex); }}
                className={ROW}
                style={{
                  color: "var(--color-svc-accent-text, var(--color-svc-accent))", borderTop: "1px solid var(--color-svc-border)",
                  background: active === createIndex ? "var(--color-svc-accent-soft)" : undefined, boxShadow: active === createIndex ? "inset 3px 0 0 var(--color-svc-accent)" : undefined,
                }}
              >
                <Plus size={16} aria-hidden="true" className="shrink-0" />
                <span className="min-w-0">Create “{titleCaseName(typed)}” as new customer</span>
              </li>
            )}
          </ul>
        </div>
      </div>
      <p role="status" aria-live="polite" className="sr-only">
        {open && typed ? (matches.length ? `${matches.length} saved customer${matches.length === 1 ? "" : "s"} found` : "No saved customer with that name") : ""}
      </p>

      {showDetails && (
        <div className="mt-2 space-y-2.5">
          {showPrompt ? (
            <div role="alert" className="rounded-xl p-3 space-y-2.5" style={{ background: "var(--color-svc-warn-soft)", border: "1px solid var(--color-svc-border-strong)" }}>
              <p id={ids.helper} className="text-[13px]" style={{ color: "var(--color-svc-text)" }}>
                {dup.kind === "exact"
                  ? <><b className="font-medium">{dupName}</b> already exists. Use that customer?</>
                  : <><b className="font-medium">{typed}</b> looks like <b className="font-medium">{dupName}</b>, who is already saved. Use that customer?</>}
              </p>
              <div className="flex flex-wrap gap-2">
                <PrimaryButton type="button" className="!min-h-11" onClick={() => pickExisting(dup.customer)}>Use existing</PrimaryButton>
                <GhostButton onClick={() => emit(text, phone, true)} className="!min-h-11">Create as new anyway</GhostButton>
              </div>
            </div>
          ) : invalid ? (
            <p id={ids.helper} className="text-[12px]" style={{ color: "var(--color-svc-danger)" }}>
              {typed.length > CUSTOMER_NAME_MAX ? `Keep the name under ${CUSTOMER_NAME_MAX} characters.` : "Use a name with at least one letter."}
            </p>
          ) : (
            <p id={ids.helper} className="text-[12px]" style={{ color: "var(--color-svc-text-dim)" }}>{NOT_SAVED_NOTE}</p>
          )}
          {state === "ready" && (
            <div className="sm:max-w-xs">
              <label htmlFor={`${uid}-phone`} className="block text-[12px] uppercase tracking-[0.1em] mb-1.5" style={{ color: "var(--color-svc-text-dim)" }}>Phone (optional)</label>
              <TextInput
                id={`${uid}-phone`} type="tel" inputMode="tel" autoComplete="off" maxLength={60} value={phone} placeholder="e.g. 0917 123 4567"
                onChange={(e) => { setPhone(e.target.value); emit(text, e.target.value, value.kind === "new" && value.allowDuplicate === true); }}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
