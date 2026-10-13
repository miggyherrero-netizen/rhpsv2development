"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { SERVICE_TYPES } from "@/lib/service";
import { WAIT_SOURCES, WAIT_STATUSES, defaultNextFollowUp } from "@/lib/service-waitlist";
import { manilaDateTimeLocal } from "@/lib/service-flow";
import { loadCustomerPlaces } from "@/server/service";
import { CityPicker, type PlaceValue } from "@/components/service-place-picker";
import { CustomerCombobox, type ComboCustomer, type NewCustomerSubmitResult } from "@/components/service-customer-combobox";
import { choiceState, type CustomerChoice } from "@/lib/service-customer-match";
import { GENERIC_SAVE_ERROR, thrownSubmitMessage } from "@/lib/service-expense-form";
import { DateField, ErrorLine, Field, GhostButton, PesoInput, PrimaryButton, Select, SvcModal, TextArea } from "@/components/service-ui";
import { parsePesoInput } from "@/lib/service-flow";
import type { WaitlistItem } from "@/server/service-waitlist-data";

export type EntryFormValues = {
  customerId: string; pianoId: string | null; serviceType: string; source: string;
  cityCode: string | null; barangayCode: string | null; useCustomerAddress: boolean;
  /** Edit only. A new entry omits both: the server stamps "asked" as now and sets the next follow-up 3 days out. */
  requestedAt?: string; nextFollowUpAt?: string; estValue: number; notes: string; status?: string;
};

type Pianos = { id: string; label: string; type: string }[];

/** New entry (mode "new") or edit one (mode "edit"). A new entry has no date fields (asked = now, next follow-up = 3 days out, both set on the server); Edit keeps them. */
export function WaitlistEntryModal(props: {
  open: boolean; onClose: () => void; mode: "new" | "edit"; pending: boolean; error: string | null;
  customers: ComboCustomer[];
  entry?: WaitlistItem | null;
  /** A city to start with (e.g. when adding from a group header). */
  presetCity?: { code: string; label: string } | null;
  onSubmit: (values: EntryFormValues) => void;
  /**
   * New entries only: the Customer field takes a name that isn't saved yet, and the customer and the entry are saved together.
   * Resolves with the server result; the form stays open (keeping what was typed) until it reports ok.
   */
  onSubmitNewCustomer?: (customer: { name: string; phone?: string; allowDuplicate?: boolean }, values: EntryFormValues) => Promise<NewCustomerSubmitResult>;
  onDelete?: () => void;
}) {
  // While a save is in flight every close path is ignored, so the form can't unmount mid-request.
  const savingRef = useRef(false);
  const [saving, setSavingState] = useState(false);
  const setSaving = (v: boolean) => { savingRef.current = v; setSavingState(v); };
  const close = () => { if (!savingRef.current) props.onClose(); };
  return (
    <SvcModal open={props.open} onClose={close} title={props.mode === "new" ? "Add to waitlist" : "Edit entry"} wide>
      {props.open && <Body {...props} onClose={close} saving={saving} setSaving={setSaving} />}
    </SvcModal>
  );
}

const toLocal = (d: Date | string) => manilaDateTimeLocal(new Date(d));

function Body({ onClose, mode, pending, error, customers, entry, presetCity, onSubmit, onSubmitNewCustomer, onDelete, saving, setSaving }: Parameters<typeof WaitlistEntryModal>[0] & { saving: boolean; setSaving: (v: boolean) => void }) {
  const typing = mode === "new" && !!onSubmitNewCustomer;
  const [choice, setChoice] = useState<CustomerChoice>({ kind: "none" });
  const [learned, setLearned] = useState<ComboCustomer[]>([]);
  const comboCustomers = useMemo(() => [...customers, ...learned.filter((l) => !customers.some((c) => c.id === l.id))], [customers, learned]);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const errBoxRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (saveErr) errBoxRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, [saveErr]);
  const cState = typing ? choiceState(choice, comboCustomers) : null;
  const isNew = typing && choice.kind === "new";
  const [customerId, setCustomerId] = useState(entry?.customerId ?? "");
  const [pianoId, setPianoId] = useState(entry?.pianoId ?? "");
  const [serviceType, setServiceType] = useState(entry?.serviceType ?? "tuning");
  const [source, setSource] = useState(entry?.source ?? "phone");
  const [status, setStatus] = useState<string>(entry?.status ?? "waiting");
  const [place, setPlace] = useState<PlaceValue>({ cityCode: entry?.cityCode ?? presetCity?.code ?? null, barangayCode: null });
  const [placeTouched, setPlaceTouched] = useState(!!entry || !!presetCity);
  const [requested, setRequested] = useState(() => toLocal(entry?.requestedAt ?? new Date()));
  const [next, setNext] = useState(() => toLocal(entry?.nextFollowUpAt ?? defaultNextFollowUp(new Date())));
  const [value, setValue] = useState(entry?.estValueCents ? String(entry.estValueCents / 100) : "");
  const [notes, setNotes] = useState(entry?.notes ?? "");
  const [pianos, setPianos] = useState<Record<string, Pianos>>({});

  useEffect(() => {
    if (!customerId || pianos[customerId]) return;
    let cancelled = false;
    loadCustomerPlaces(customerId).then((r) => { if (!cancelled && r.ok && r.data) setPianos((cur) => ({ ...cur, [customerId]: r.data!.pianos })); });
    return () => { cancelled = true; };
  }, [customerId, pianos]);
  const list = (customerId && pianos[customerId]) || [];
  const valueBad = value.trim() !== "" && parsePesoInput(value) === null;
  const nextBad = mode === "edit" && !next;

  return (
    <div className="space-y-3.5">
      <ErrorLine>{error}</ErrorLine>
      {mode === "new" ? (
        <CustomerCombobox
          label="Customer" customers={comboCustomers} value={choice} autoFocus
          onChange={(next) => { setChoice(next); setSaveErr(null); setCustomerId(next.kind === "existing" ? next.id : ""); setPianoId(""); }}
        />
      ) : (
        <p className="text-[14px]" style={{ color: "var(--color-svc-text)" }}>{entry?.customerName}</p>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Piano" hint={isNew ? "Add the piano later on the customer page" : customerId && list.length === 0 ? "No piano saved yet — add one on the customer page" : undefined}>
          <Select aria-label="Piano" disabled={!customerId} value={pianoId} onChange={(e) => setPianoId(e.target.value)}>
            <option value="">{customerId || isNew ? "Not chosen yet" : "Pick a customer first"}</option>
            {entry?.pianoId && !list.some((p) => p.id === entry.pianoId) && <option value={entry.pianoId}>{entry.pianoLabel}</option>}
            {list.map((p) => <option key={p.id} value={p.id}>{p.label} ({p.type})</option>)}
          </Select>
        </Field>
        <Field label="Service">
          <Select value={serviceType} onChange={(e) => setServiceType(e.target.value)}>{SERVICE_TYPES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</Select>
        </Field>
      </div>
      <CityPicker
        label="Area" value={place} selectedLabel={entry?.cityName ? [entry.cityName, entry.provinceName].filter(Boolean).join(" · ") : presetCity?.label}
        onChange={(v) => { setPlace(v); setPlaceTouched(true); }}
      />
      {mode === "new" && !placeTouched && <p className="text-[12px] -mt-2" style={{ color: "var(--color-svc-text-faint)" }}>Left empty, the area comes from the customer&apos;s saved address (or “Unsorted”).</p>}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Field label="Where from"><Select value={source} onChange={(e) => setSource(e.target.value)}>{WAIT_SOURCES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</Select></Field>
        <Field label="Estimated value"><PesoInput value={value} onChange={setValue} placeholder="e.g. 2,500" /></Field>
        {mode === "edit" && (
          <Field label="Status"><Select value={status} onChange={(e) => setStatus(e.target.value)}>{WAIT_STATUSES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</Select></Field>
        )}
      </div>
      {mode === "edit" && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Asked on"><DateField kind="datetime-local" value={requested} onChange={setRequested} /></Field>
          <Field label="Next follow-up" hint="Required — every entry gets a next nudge"><DateField kind="datetime-local" value={next} onChange={setNext} /></Field>
        </div>
      )}
      <Field label="Notes"><TextArea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Prefers Saturdays; gate code 1234" /></Field>
      {valueBad && <p role="alert" className="text-[12px]" style={{ color: "var(--color-svc-danger)" }}>Use a number like 2,500.</p>}
      <div ref={errBoxRef}><ErrorLine>{saveErr}</ErrorLine></div>
      {cState === "needs-decision" && <p className="text-[12px] text-right" style={{ color: "var(--color-svc-text-dim)" }}>Choose “Use existing” or “Create as new anyway” first.</p>}
      <div className="flex flex-wrap justify-between gap-2 pt-2">
        <div>{onDelete && <GhostButton onClick={onDelete} className="!min-h-11 !text-[var(--color-svc-danger)]">Remove from waitlist</GhostButton>}</div>
        <div className="flex gap-2">
          <GhostButton onClick={onClose} disabled={saving} className="!min-h-11">Cancel</GhostButton>
          <PrimaryButton
            pending={pending || saving} disabled={(typing ? cState !== "ready" : !customerId) || valueBad || nextBad} className="!min-h-11"
            onClick={async () => {
              if (saving) return;
              const v: EntryFormValues = {
                customerId, pianoId: pianoId || null, serviceType, source, cityCode: place.cityCode, barangayCode: place.barangayCode,
                useCustomerAddress: mode === "new" && !placeTouched, ...(mode === "edit" ? { requestedAt: requested, nextFollowUpAt: next } : {}),
                estValue: parsePesoInput(value) ?? 0, notes, status: mode === "edit" ? status : undefined,
              };
              if (choice.kind === "new" && onSubmitNewCustomer) {
                setSaving(true); setSaveErr(null);
                try {
                  const res = await onSubmitNewCustomer({ name: choice.name, ...(choice.phone ? { phone: choice.phone } : {}), ...(choice.allowDuplicate ? { allowDuplicate: true } : {}) }, { ...v, pianoId: null });
                  if (res.ok) { setSaving(false); onClose(); return; }
                  if (res.duplicateOf) setLearned((cur) => [...cur, { id: res.duplicateOf!.id, name: res.duplicateOf!.name }]);
        setSaveErr(res.error ?? GENERIC_SAVE_ERROR);
                } catch (err) {
                  setSaveErr(thrownSubmitMessage(err, typeof navigator !== "undefined" && navigator.onLine === false));
                }
                setSaving(false);
                return;
              }
              onSubmit(v);
            }}
          >
            {mode === "new" ? "Add to waitlist" : "Save changes"}
          </PrimaryButton>
        </div>
      </div>
    </div>
  );
}
