"use client";

/**
 * Shared Home Service form pieces: a customer picker with inline "New customer", and ONE job form used by
 * both "New job" and "Edit visit" so the two can never drift apart.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Camera, Plus, X } from "lucide-react";
import { EXPENSE_CATEGORIES, PAYMENT_METHODS, SERVICE_TYPES, serviceTypeMinutes } from "@/lib/service";
import { downsizeImage } from "@/lib/image-client";
import { manilaDateTimeLocal } from "@/lib/service-flow";
import { parsePesoInput } from "@/lib/service-flow";
import { createCustomer, createLocation, createPiano, loadCustomerPlaces } from "@/server/service";
import {
  DateField, ErrorLine, Field, GhostButton, PesoInput, PrimaryButton, Select, SvcModal, TextArea, TextInput, UnitInput,
} from "@/components/service-ui";

const NEW = "__new__";
const ADD_PLACE = "__add_place__";
const ADD_PIANO = "__add_piano__";

/* ----------------------------------------------------------- customer picker */

export function CustomerPicker({
  customers, value, onChange, autoFocus,
}: {
  customers: { id: string; name: string }[];
  value: string;
  onChange: (id: string) => void;
  autoFocus?: boolean;
}) {
  const [extra, setExtra] = useState<{ id: string; name: string }[]>([]);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const all = useMemo(() => [...customers, ...extra.filter((e) => !customers.some((c) => c.id === e.id))], [customers, extra]);

  const create = async () => {
    setBusy(true); setErr(null);
    const res = await createCustomer({ name, phone, source: "referral" });
    setBusy(false);
    if (!res.ok || !res.data) return setErr(res.ok ? "Couldn't create the customer." : res.error);
    setExtra((cur) => [...cur, { id: res.data!.id, name: name.trim() }]);
    onChange(res.data.id);
    setAdding(false); setName(""); setPhone("");
  };

  return (
    <div className="space-y-2">
      <Select
        aria-label="Customer" autoFocus={autoFocus} value={adding ? NEW : value}
        onChange={(e) => (e.target.value === NEW ? setAdding(true) : (setAdding(false), onChange(e.target.value)))}
      >
        <option value="">Select a customer…</option>
        {all.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        <option value={NEW}>＋ New customer…</option>
      </Select>
      {adding && (
        <div className="rounded-xl p-3 space-y-2.5" style={{ background: "var(--color-svc-surface-2)" }}>
          <div className="grid grid-cols-2 gap-2.5">
            <Field label="Name"><TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Maria Santos" autoFocus /></Field>
            <Field label="Phone"><TextInput type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="e.g. 0917 123 4567" /></Field>
          </div>
          <ErrorLine>{err}</ErrorLine>
          <div className="flex gap-2">
            <GhostButton onClick={() => { setAdding(false); setErr(null); }} className="!min-h-10">Cancel</GhostButton>
            <PrimaryButton pending={busy} disabled={!name.trim()} onClick={create} className="!min-h-10">Create customer</PrimaryButton>
          </div>
        </div>
      )}
    </div>
  );
}

/* --------------------------------------------------------------- job form */

export type JobFormValues = {
  customerId: string; locationId: string | null; pianoId: string | null; technicianId: string | null;
  title: string; serviceType: string; priority: string; scheduledStart: string | null;
  estimatedMinutes: number; travelFee: number; notes: string; privateNotes: string;
};

type Places = {
  locations: { id: string; label: string; addressLine: string; city: string | null; area: string | null; travelFeeCents: number }[];
  pianos: { id: string; label: string; type: string }[];
};
const NO_PLACES: Places = { locations: [], pianos: [] };

export function JobFormModal(props: {
  open: boolean; onClose: () => void; mode: "new" | "edit"; pending: boolean;
  customers: { id: string; name: string }[];
  technicians: { id: string; name: string }[];
  initial?: Partial<JobFormValues>;
  onSubmit: (values: JobFormValues) => void;
}) {
  const { open, onClose, mode } = props;
  return (
    <SvcModal open={open} onClose={onClose} title={mode === "new" ? "New job" : "Edit visit"} subtitle={mode === "new" ? "Leave the time blank to park it in Unscheduled." : undefined} wide>
      {open && <JobFormBody {...props} />}
    </SvcModal>
  );
}

function JobFormBody({ onClose, mode, pending, customers, technicians, initial, onSubmit }: Parameters<typeof JobFormModal>[0]) {
  const [customerId, setCustomerId] = useState(initial?.customerId ?? "");
  const [locationId, setLocationId] = useState(initial?.locationId ?? "");
  const [pianoId, setPianoId] = useState(initial?.pianoId ?? "");
  // The one active technician is preselected so a solo operator never has to pick themselves.
  const [technicianId, setTechnicianId] = useState(initial?.technicianId ?? (technicians.length === 1 ? technicians[0]!.id : ""));
  const [title, setTitle] = useState(initial?.title ?? "");
  const [serviceType, setServiceType] = useState(initial?.serviceType ?? "tuning");
  const [priority, setPriority] = useState(initial?.priority ?? "normal");
  const [start, setStart] = useState(initial?.scheduledStart ?? "");
  const [minutes, setMinutes] = useState(String(initial?.estimatedMinutes ?? serviceTypeMinutes(initial?.serviceType ?? "tuning")));
  const [minutesTouched, setMinutesTouched] = useState(mode === "edit");
  const [travelFee, setTravelFee] = useState(initial?.travelFee ? String(initial.travelFee) : "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [privateNotes, setPrivateNotes] = useState(initial?.privateNotes ?? "");

  // Places are loaded per customer and cached by id, so switching back and forth is instant.
  const [placesBy, setPlacesBy] = useState<Record<string, Places>>({});
  useEffect(() => {
    if (!customerId || placesBy[customerId]) return;
    let cancelled = false;
    loadCustomerPlaces(customerId).then((r) => { if (!cancelled && r.ok && r.data) setPlacesBy((cur) => ({ ...cur, [customerId]: r.data! })); });
    return () => { cancelled = true; };
  }, [customerId, placesBy]);
  const places = (customerId && placesBy[customerId]) || NO_PLACES;
  const loadingPlaces = !!customerId && !placesBy[customerId];

  const [addPlace, setAddPlace] = useState(false);
  const [place, setPlace] = useState({ label: "Home", addressLine: "", area: "" });
  const [addPiano, setAddPiano] = useState(false);
  const [piano, setPiano] = useState({ brand: "", model: "", type: "Upright" });
  const [inlineBusy, setInlineBusy] = useState(false);
  const [inlineErr, setInlineErr] = useState<string | null>(null);

  const pickCustomer = (id: string) => { setCustomerId(id); setLocationId(""); setPianoId(""); setAddPlace(false); setAddPiano(false); };

  const savePlace = async () => {
    setInlineBusy(true); setInlineErr(null);
    const res = await createLocation({ customerId, label: place.label, addressLine: place.addressLine, area: place.area, city: "Davao City" });
    setInlineBusy(false);
    if (!res.ok || !res.data) return setInlineErr(res.ok ? "Couldn't save the address." : res.error);
    const created = { id: res.data.id, label: place.label || "Address", addressLine: place.addressLine, city: "Davao City", area: place.area || null, travelFeeCents: 0 };
    setPlacesBy((cur) => ({ ...cur, [customerId]: { ...(cur[customerId] ?? NO_PLACES), locations: [...(cur[customerId]?.locations ?? []), created] } }));
    setLocationId(res.data.id); setAddPlace(false); setPlace({ label: "Home", addressLine: "", area: "" });
  };
  const savePiano = async () => {
    setInlineBusy(true); setInlineErr(null);
    const res = await createPiano({ customerId, brand: piano.brand, model: piano.model, type: piano.type, locationId: locationId || null });
    setInlineBusy(false);
    if (!res.ok || !res.data) return setInlineErr(res.ok ? "Couldn't save the piano." : res.error);
    const created = { id: res.data.id, label: [piano.brand, piano.model].filter(Boolean).join(" "), type: piano.type };
    setPlacesBy((cur) => ({ ...cur, [customerId]: { ...(cur[customerId] ?? NO_PLACES), pianos: [...(cur[customerId]?.pianos ?? []), created] } }));
    setPianoId(res.data.id); setAddPiano(false); setPiano({ brand: "", model: "", type: "Upright" });
  };

  const submit = () => {
    if (!customerId) return;
    onSubmit({
      customerId, locationId: locationId || null, pianoId: pianoId || null, technicianId: technicianId || null,
      title: title.trim() || "Home service visit", serviceType, priority, scheduledStart: start || null,
      estimatedMinutes: Math.max(15, Number(minutes) || serviceTypeMinutes(serviceType)),
      travelFee: parsePesoInput(travelFee) ?? 0, notes, privateNotes,
    });
    onClose();
  };

  return (
    <div className="space-y-3.5">
      <Field label="Customer"><CustomerPicker customers={customers} value={customerId} onChange={pickCustomer} autoFocus={mode === "new"} /></Field>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Location" hint={loadingPlaces ? "Loading addresses…" : undefined}>
          <Select
            aria-label="Location" disabled={!customerId} value={addPlace ? ADD_PLACE : locationId}
            onChange={(e) => (e.target.value === ADD_PLACE ? setAddPlace(true) : (setAddPlace(false), setLocationId(e.target.value)))}
          >
            <option value="">{customerId ? "No location yet" : "Pick a customer first"}</option>
            {places.locations.map((l) => <option key={l.id} value={l.id}>{l.label} — {l.addressLine}</option>)}
            {customerId && <option value={ADD_PLACE}>＋ Add an address…</option>}
          </Select>
        </Field>
        <Field label="Piano">
          <Select
            aria-label="Piano" disabled={!customerId} value={addPiano ? ADD_PIANO : pianoId}
            onChange={(e) => (e.target.value === ADD_PIANO ? setAddPiano(true) : (setAddPiano(false), setPianoId(e.target.value)))}
          >
            <option value="">{customerId ? "No piano linked" : "Pick a customer first"}</option>
            {places.pianos.map((p) => <option key={p.id} value={p.id}>{p.label} ({p.type})</option>)}
            {customerId && <option value={ADD_PIANO}>＋ Add a piano…</option>}
          </Select>
        </Field>
      </div>

      {addPlace && (
        <InlineBox onCancel={() => { setAddPlace(false); setInlineErr(null); }} onSave={savePlace} busy={inlineBusy} err={inlineErr} saveLabel="Save address" canSave={!!place.addressLine.trim()}>
          <Field label="Label"><TextInput value={place.label} onChange={(e) => setPlace({ ...place, label: e.target.value })} placeholder="e.g. Home" /></Field>
          <Field label="Address"><TextInput value={place.addressLine} onChange={(e) => setPlace({ ...place, addressLine: e.target.value })} placeholder="e.g. 12 Acacia St, Matina" autoFocus /></Field>
          <Field label="Area"><TextInput value={place.area} onChange={(e) => setPlace({ ...place, area: e.target.value })} placeholder="e.g. Matina" /></Field>
        </InlineBox>
      )}
      {addPiano && (
        <InlineBox onCancel={() => { setAddPiano(false); setInlineErr(null); }} onSave={savePiano} busy={inlineBusy} err={inlineErr} saveLabel="Save piano" canSave={!!piano.brand.trim()}>
          <Field label="Brand"><TextInput value={piano.brand} onChange={(e) => setPiano({ ...piano, brand: e.target.value })} placeholder="e.g. Yamaha" autoFocus /></Field>
          <Field label="Model"><TextInput value={piano.model} onChange={(e) => setPiano({ ...piano, model: e.target.value })} placeholder="e.g. U1" /></Field>
          <Field label="Type">
            <Select value={piano.type} onChange={(e) => setPiano({ ...piano, type: e.target.value })}>
              {["Upright", "Grand", "Digital", "Organ"].map((t) => <option key={t}>{t}</option>)}
            </Select>
          </Field>
        </InlineBox>
      )}

      <Field label="Job title"><TextInput value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Standard tuning — Yamaha U1" /></Field>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Field label="Service type">
          <Select value={serviceType} onChange={(e) => { setServiceType(e.target.value); if (!minutesTouched) setMinutes(String(serviceTypeMinutes(e.target.value))); }}>
            {SERVICE_TYPES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </Select>
        </Field>
        <Field label="Technician">
          <Select value={technicianId} onChange={(e) => setTechnicianId(e.target.value)}>
            <option value="">Unassigned</option>
            {technicians.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </Select>
        </Field>
        <Field label="Priority">
          <Select value={priority} onChange={(e) => setPriority(e.target.value)}>
            <option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option>
          </Select>
        </Field>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Field label="Scheduled start" hint="Manila time">
          <DateField kind="datetime-local" value={start} onChange={setStart} />
        </Field>
        <Field label="Duration">
          <UnitInput type="number" inputMode="numeric" min={15} step={15} suffix="min" value={minutes} onChange={(e) => { setMinutes(e.target.value); setMinutesTouched(true); }} />
        </Field>
        <Field label="Travel fee">
          <PesoInput value={travelFee} onChange={setTravelFee} placeholder="e.g. 300" />
        </Field>
      </div>

      <Field label="Notes (visible to client)"><TextArea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Please bring the stool; gate code 1234" /></Field>
      <Field label="Private notes (only you)"><TextArea rows={2} value={privateNotes} onChange={(e) => setPrivateNotes(e.target.value)} placeholder="e.g. Pedal squeak, check dampers" /></Field>

      <div className="flex justify-end gap-2 pt-2">
        <GhostButton onClick={onClose} className="!min-h-11">Cancel</GhostButton>
        <PrimaryButton pending={pending} disabled={!customerId} onClick={submit} className="!min-h-11">
          {mode === "new" ? "Create job" : "Save changes"}
        </PrimaryButton>
      </div>
    </div>
  );
}

function InlineBox({
  children, onCancel, onSave, busy, err, saveLabel, canSave,
}: { children: React.ReactNode; onCancel: () => void; onSave: () => void; busy: boolean; err: string | null; saveLabel: string; canSave: boolean }) {
  return (
    <div className="rounded-xl p-3 space-y-2.5" style={{ background: "var(--color-svc-surface-2)" }}>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">{children}</div>
      <ErrorLine>{err}</ErrorLine>
      <div className="flex gap-2">
        <GhostButton onClick={onCancel} className="inline-flex items-center gap-1 !min-h-10"><X size={13} /> Cancel</GhostButton>
        <PrimaryButton pending={busy} disabled={!canSave} onClick={onSave} className="!min-h-10"><Plus size={13} /> {saveLabel}</PrimaryButton>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- expense form */

export type ExpenseFormValues = {
  category: string; description: string; amount: number; spentAt: string | null; vendor: string;
  method: string; reimbursable: boolean; jobId: string | null; receiptUrl: string | null;
};

export function ExpenseFormModal(props: {
  open: boolean; onClose: () => void; pending: boolean;
  /** Set when opened from a job page: the link is fixed and the picker is hidden. */
  fixedJobId?: string;
  jobOptions?: { id: string; label: string }[];
  onSubmit: (values: ExpenseFormValues) => void;
}) {
  return (
    <SvcModal open={props.open} onClose={props.onClose} title="Add expense">
      {props.open && <ExpenseFormBody {...props} />}
    </SvcModal>
  );
}

function ExpenseFormBody({ onClose, pending, fixedJobId, jobOptions = [], onSubmit }: Parameters<typeof ExpenseFormModal>[0]) {
  const [category, setCategory] = useState("fuel");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [spentAt, setSpentAt] = useState(() => manilaDateTimeLocal(new Date()));
  const [vendor, setVendor] = useState("");
  const [method, setMethod] = useState("cash");
  const [reimbursable, setReimbursable] = useState(false);
  const [jobId, setJobId] = useState(fixedJobId ?? "");
  const [receipt, setReceipt] = useState<string | null>(null);
  const [receiptErr, setReceiptErr] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const pickReceipt = async (file?: File) => {
    setReceiptErr(null);
    if (!file) return;
    if (!file.type.startsWith("image/")) return setReceiptErr("Please choose a photo.");
    setReading(true);
    try { setReceipt(await downsizeImage(file)); }
    catch { setReceiptErr("Couldn't use that photo — try a smaller one."); }
    setReading(false);
    if (fileRef.current) fileRef.current.value = "";
  };
  const amountBad = amount.trim() !== "" && parsePesoInput(amount) === null;

  return (
    <div className="space-y-3.5">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Category">
          <Select value={category} onChange={(e) => setCategory(e.target.value)}>
            {EXPENSE_CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
          </Select>
        </Field>
        <Field label="Amount"><PesoInput value={amount} onChange={setAmount} autoFocus /></Field>
      </div>
      {amountBad && <p role="alert" className="text-[12px]" style={{ color: "var(--color-svc-danger)" }}>Use a number like 1,250.</p>}
      <Field label="Description"><TextInput value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Diesel — Buhangin run" /></Field>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Vendor"><TextInput value={vendor} onChange={(e) => setVendor(e.target.value)} placeholder="e.g. Shell Matina" /></Field>
        <Field label="Date" hint="Defaults to now"><DateField kind="datetime-local" value={spentAt} onChange={setSpentAt} /></Field>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Paid with">
          <Select value={method} onChange={(e) => setMethod(e.target.value)}>
            {PAYMENT_METHODS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
          </Select>
        </Field>
        <Field label="Reimbursable">
          <Select value={reimbursable ? "yes" : "no"} onChange={(e) => setReimbursable(e.target.value === "yes")}>
            <option value="no">Business expense</option><option value="yes">Owed to crew</option>
          </Select>
        </Field>
      </div>
      {!fixedJobId && (
        <Field label="Link to a job (optional)">
          <Select value={jobId} onChange={(e) => setJobId(e.target.value)}>
            <option value="">Not linked to a job</option>
            {jobOptions.map((j) => <option key={j.id} value={j.id}>{j.label}</option>)}
          </Select>
        </Field>
      )}

      <div>
        <p className="text-[11px] uppercase tracking-[0.1em] mb-1.5" style={{ color: "var(--color-svc-text-dim)" }}>Receipt photo (optional)</p>
        {/* capture="environment" opens the rear camera on phones; desktops fall back to a file picker */}
        <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => pickReceipt(e.target.files?.[0])} />
        {receipt ? (
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={receipt} alt="Receipt preview" className="h-20 w-20 rounded-lg object-cover border" style={{ borderColor: "var(--color-svc-border)" }} />
            <GhostButton onClick={() => setReceipt(null)} className="inline-flex items-center gap-1.5 !min-h-10"><X size={13} /> Remove</GhostButton>
          </div>
        ) : (
          <GhostButton onClick={() => fileRef.current?.click()} disabled={reading} className="inline-flex items-center gap-2 !min-h-11">
            <Camera size={15} /> {reading ? "Preparing photo…" : "Take or choose a photo"}
          </GhostButton>
        )}
        {receiptErr && <p role="alert" className="text-[12px] mt-1.5" style={{ color: "var(--color-svc-danger)" }}>{receiptErr}</p>}
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <GhostButton onClick={onClose} className="!min-h-11">Cancel</GhostButton>
        <PrimaryButton
          pending={pending} disabled={!description.trim() || amountBad || reading} className="!min-h-11"
          onClick={() => {
            onSubmit({
              category, description: description.trim(), amount: parsePesoInput(amount) ?? 0, spentAt: spentAt || null,
              vendor, method, reimbursable, jobId: fixedJobId ?? (jobId || null), receiptUrl: receipt,
            });
            onClose();
          }}
        >
          Add expense
        </PrimaryButton>
      </div>
    </div>
  );
}
