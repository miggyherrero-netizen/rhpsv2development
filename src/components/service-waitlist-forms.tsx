"use client";

import { useEffect, useState } from "react";
import { SERVICE_TYPES } from "@/lib/service";
import { WAIT_SOURCES, WAIT_STATUSES, defaultNextFollowUp } from "@/lib/service-waitlist";
import { manilaDateTimeLocal } from "@/lib/service-flow";
import { loadCustomerPlaces } from "@/server/service";
import { CityPicker, type PlaceValue } from "@/components/service-place-picker";
import { CustomerPicker } from "@/components/service-forms";
import { DateField, ErrorLine, Field, GhostButton, PesoInput, PrimaryButton, Select, SvcModal, TextArea } from "@/components/service-ui";
import { parsePesoInput } from "@/lib/service-flow";
import type { WaitlistItem } from "@/server/service-waitlist-data";

export type EntryFormValues = {
  customerId: string; pianoId: string | null; serviceType: string; source: string;
  cityCode: string | null; barangayCode: string | null; useCustomerAddress: boolean;
  requestedAt: string; nextFollowUpAt: string; estValue: number; notes: string; status?: string;
};

type Pianos = { id: string; label: string; type: string }[];

/** New entry (mode "new") or edit one (mode "edit"). The next follow-up is required and starts 3 days out. */
export function WaitlistEntryModal(props: {
  open: boolean; onClose: () => void; mode: "new" | "edit"; pending: boolean; error: string | null;
  customers: { id: string; name: string }[];
  entry?: WaitlistItem | null;
  /** A city to start with (e.g. when adding from a group header). */
  presetCity?: { code: string; label: string } | null;
  onSubmit: (values: EntryFormValues) => void;
  onDelete?: () => void;
}) {
  return (
    <SvcModal open={props.open} onClose={props.onClose} title={props.mode === "new" ? "Add to waitlist" : "Edit entry"} wide>
      {props.open && <Body {...props} />}
    </SvcModal>
  );
}

const toLocal = (d: Date | string) => manilaDateTimeLocal(new Date(d));

function Body({ onClose, mode, pending, error, customers, entry, presetCity, onSubmit, onDelete }: Parameters<typeof WaitlistEntryModal>[0]) {
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
  const nextBad = !next;

  return (
    <div className="space-y-3.5">
      <ErrorLine>{error}</ErrorLine>
      {mode === "new" ? (
        <Field label="Customer"><CustomerPicker customers={customers} value={customerId} onChange={(id) => { setCustomerId(id); setPianoId(""); }} autoFocus /></Field>
      ) : (
        <p className="text-[14px]" style={{ color: "var(--color-svc-text)" }}>{entry?.customerName}</p>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Piano" hint={customerId && list.length === 0 ? "No piano saved yet — add one on the customer page" : undefined}>
          <Select aria-label="Piano" disabled={!customerId} value={pianoId} onChange={(e) => setPianoId(e.target.value)}>
            <option value="">{customerId ? "Not chosen yet" : "Pick a customer first"}</option>
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
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Asked on"><DateField kind="datetime-local" value={requested} onChange={setRequested} /></Field>
        <Field label="Next follow-up" hint="Required — every entry gets a next nudge"><DateField kind="datetime-local" value={next} onChange={setNext} /></Field>
      </div>
      <Field label="Notes"><TextArea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Prefers Saturdays; gate code 1234" /></Field>
      {valueBad && <p role="alert" className="text-[12px]" style={{ color: "var(--color-svc-danger)" }}>Use a number like 2,500.</p>}
      <div className="flex flex-wrap justify-between gap-2 pt-2">
        <div>{onDelete && <GhostButton onClick={onDelete} className="!min-h-11 !text-[var(--color-svc-danger)]">Remove from waitlist</GhostButton>}</div>
        <div className="flex gap-2">
          <GhostButton onClick={onClose} className="!min-h-11">Cancel</GhostButton>
          <PrimaryButton
            pending={pending} disabled={!customerId || valueBad || nextBad} className="!min-h-11"
            onClick={() => onSubmit({
              customerId, pianoId: pianoId || null, serviceType, source, cityCode: place.cityCode, barangayCode: place.barangayCode,
              useCustomerAddress: mode === "new" && !placeTouched, requestedAt: requested, nextFollowUpAt: next,
              estValue: parsePesoInput(value) ?? 0, notes, status: mode === "edit" ? status : undefined,
            })}
          >
            {mode === "new" ? "Add to waitlist" : "Save changes"}
          </PrimaryButton>
        </div>
      </div>
    </div>
  );
}
