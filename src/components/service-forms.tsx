"use client";

/**
 * Shared Home Service form pieces: a customer picker with inline "New customer", and ONE job form used by
 * both "New job" and "Edit visit" so the two can never drift apart.
 */

import { pianoLabel } from "@/lib/service-piano-info";
import { useEffect, useMemo, useRef, useState } from "react";
import { Camera, ChevronDown, Image as ImageIcon, Plus, X } from "lucide-react";
import { kindAfterJobLink } from "@/lib/service-expense-edit";
import {
  GENERIC_SAVE_ERROR, amountHint, buildExpensePayload, canSaveExpense, categoryLabel, effectiveExpenseKind, saveBlockReason, shouldOpenMore,
  stockNeedsPiano, thrownSubmitMessage,
} from "@/lib/service-expense-form";
import { EXPENSE_CATEGORIES, PAYMENT_METHODS, SERVICE_TYPES, TIME_KINDS, serviceTypeMinutes } from "@/lib/service";
import { downsizeImage } from "@/lib/image-client";
import { CityPicker, type PlaceValue } from "@/components/service-place-picker";
import { peso } from "@/lib/format";
import { EXPENSE_KINDS } from "@/lib/service-finance-split";
import { manilaDateTimeLocal } from "@/lib/service-flow";
import { parsePesoInput } from "@/lib/service-flow";
import { createCustomer, createLocation, createPiano, loadCustomerPlaces } from "@/server/service";
import { isBatchCustomer, titleCaseName } from "@/lib/service-reports";
import { choiceState, type CustomerChoice } from "@/lib/service-customer-match";
import { CustomerCombobox, type ComboCustomer, type NewCustomerSubmitResult } from "@/components/service-customer-combobox";
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
            <GhostButton onClick={() => { setAdding(false); setErr(null); }} className="!min-h-11">Cancel</GhostButton>
            <PrimaryButton pending={busy} disabled={!name.trim()} onClick={create} className="!min-h-11">Create customer</PrimaryButton>
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
  /** "service" | "sale". Sale fields are in pesos. */
  jobType: string; salePianoId: string | null; buyCost: number; prepCost: number; salePrice: number; deposit: number;
};

export type ShowroomPiano = { id: string; label: string; status: string; listPriceCents: number | null; stockCents: number };

type Places = {
  locations: { id: string; label: string; addressLine: string; city: string | null; area: string | null; travelFeeCents: number }[];
  pianos: { id: string; label: string; type: string }[];
};
const NO_PLACES: Places = { locations: [], pianos: [] };

export function JobFormModal(props: {
  open: boolean; onClose: () => void; mode: "new" | "edit"; pending: boolean;
  /** `isBatch` = a trip / batch placeholder customer, which doesn't need a piano. */
  customers: { id: string; name: string; isBatch?: boolean }[];
  technicians: { id: string; name: string }[];
  /** Showroom pianos (from Piano Management). Without them the "Piano sale" type isn't offered. */
  showroomPianos?: ShowroomPiano[];
  initial?: Partial<JobFormValues>;
  onSubmit: (values: JobFormValues) => void;
  /**
   * New jobs only. When given, the Customer field is a type-to-search box and a name that isn't saved yet becomes a new
   * contact together with the job. Resolves with the server result; the form stays open (keeping what was typed) until it
   * reports ok. Customers picked from the list still go through `onSubmit`, exactly as before.
   */
  onSubmitNewCustomer?: (
    customer: { name: string; phone?: string; allowDuplicate?: boolean },
    piano: { brand: string; model: string; type: string } | null,
    values: JobFormValues,
  ) => Promise<NewCustomerSubmitResult>;
  /**
   * "Convert to job" from the waitlist: the customer is fixed, only the essentials show (service type, time, notes) and
   * the rest sits under "More options". The modal stays open on submit, so an error can be shown without losing the form.
   */
  convert?: { title: string; subtitle?: string; submitLabel: string; customerName: string; error?: string | null };
}) {
  const { open, onClose, mode, convert } = props;
  const sale = props.initial?.jobType === "sale";
  // While a save is in flight every close path (X, Esc, backdrop, Cancel) is ignored, so the form can't unmount mid-request.
  const savingRef = useRef(false);
  const [saving, setSavingState] = useState(false);
  const setSaving = (v: boolean) => { savingRef.current = v; setSavingState(v); };
  const guardedClose = () => { if (!savingRef.current) onClose(); };
  return (
    <SvcModal
      open={open} onClose={guardedClose} wide
      title={convert?.title ?? (mode === "new" ? "New job" : sale ? "Edit piano sale" : "Edit visit")}
      subtitle={convert ? convert.subtitle : mode === "new" ? "Leave the time blank to park it in Unscheduled." : undefined}
    >
      {open && <JobFormBody {...props} onClose={guardedClose} saving={saving} setSaving={setSaving} />}
    </SvcModal>
  );
}

function JobFormBody({ onClose, mode, pending, customers, technicians, showroomPianos, initial, onSubmit, onSubmitNewCustomer, convert, saving, setSaving }: Parameters<typeof JobFormModal>[0] & { saving: boolean; setSaving: (v: boolean) => void }) {
  // Type-to-search customer (new jobs only). Edit and convert keep the old picker / fixed customer.
  const typing = mode === "new" && !convert && !!onSubmitNewCustomer;
  const [moreOpen, setMoreOpen] = useState(false);
  const [jobType, setJobType] = useState<string>(initial?.jobType ?? "service");
  const isSale = jobType === "sale";
  const [salePianoId, setSalePianoId] = useState(initial?.salePianoId ?? "");
  const [buyCost, setBuyCost] = useState(initial?.buyCost ? String(initial.buyCost) : "");
  const [buyCostTouched, setBuyCostTouched] = useState(!!initial?.buyCost);
  const [prepCost, setPrepCost] = useState(initial?.prepCost ? String(initial.prepCost) : "");
  const [salePrice, setSalePrice] = useState(initial?.salePrice ? String(initial.salePrice) : "");
  const [priceTouched, setPriceTouched] = useState(!!initial?.salePrice);
  const [deposit, setDeposit] = useState(initial?.deposit ? String(initial.deposit) : "");
  const showroomPick = showroomPianos?.find((p) => p.id === salePianoId) ?? null;
  const [customerId, setCustomerId] = useState(initial?.customerId ?? "");
  const [choice, setChoice] = useState<CustomerChoice>(initial?.customerId ? { kind: "existing", id: initial.customerId } : { kind: "none" });
  // Customers the server told us about (a duplicate it found that this list didn't have yet).
  const [learned, setLearned] = useState<ComboCustomer[]>([]);
  const comboCustomers = useMemo(() => [...customers, ...learned.filter((l) => !customers.some((c) => c.id === l.id))], [customers, learned]);
  const [newPiano, setNewPiano] = useState({ brand: "", model: "", type: "Upright" });
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const errBoxRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (saveErr) errBoxRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, [saveErr]);
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
  const [placeCity, setPlaceCity] = useState<PlaceValue>({ cityCode: null, barangayCode: null });
  const [placeCityName, setPlaceCityName] = useState("Davao City");
  const [addPiano, setAddPiano] = useState(false);
  const [piano, setPiano] = useState({ brand: "", model: "", type: "Upright", lastTuned: "" });
  const [inlineBusy, setInlineBusy] = useState(false);
  const [inlineErr, setInlineErr] = useState<string | null>(null);

  const pickCustomer = (id: string) => { setCustomerId(id); setLocationId(""); setPianoId(""); setAddPlace(false); setAddPiano(false); };
  const pickChoice = (next: CustomerChoice) => {
    setChoice(next); setSaveErr(null);
    const id = next.kind === "existing" ? next.id : "";
    if (id !== customerId) pickCustomer(id);
  };
  const newName = typing && choice.kind === "new" ? choice.name : "";
  const isNew = typing && choice.kind === "new";
  const cState = typing ? choiceState(choice, comboCustomers) : null;

  const savePlace = async () => {
    setInlineBusy(true); setInlineErr(null);
    const res = await createLocation({ customerId, label: place.label, addressLine: place.addressLine, area: place.area, city: placeCityName, cityCode: placeCity.cityCode, barangayCode: placeCity.barangayCode });
    setInlineBusy(false);
    if (!res.ok || !res.data) return setInlineErr(res.ok ? "Couldn't save the address." : res.error);
    const created = { id: res.data.id, label: place.label || "Address", addressLine: place.addressLine, city: placeCityName, area: place.area || null, travelFeeCents: 0 };
    setPlacesBy((cur) => ({ ...cur, [customerId]: { ...(cur[customerId] ?? NO_PLACES), locations: [...(cur[customerId]?.locations ?? []), created] } }));
    setLocationId(res.data.id); setAddPlace(false); setPlace({ label: "Home", addressLine: "", area: "" }); setPlaceCity({ cityCode: null, barangayCode: null });
  };
  const savePiano = async () => {
    setInlineBusy(true); setInlineErr(null);
    const res = await createPiano({ customerId, brand: piano.brand, model: piano.model, type: piano.type, locationId: locationId || null, lastServiceAt: piano.lastTuned || null });
    setInlineBusy(false);
    if (!res.ok || !res.data) return setInlineErr(res.ok ? "Couldn't save the piano." : res.error);
    const created = { id: res.data.id, label: pianoLabel(piano), type: piano.type };
    setPlacesBy((cur) => ({ ...cur, [customerId]: { ...(cur[customerId] ?? NO_PLACES), pianos: [...(cur[customerId]?.pianos ?? []), created] } }));
    setPianoId(res.data.id); setAddPiano(false); setPiano({ brand: "", model: "", type: "Upright", lastTuned: "" });
  };

  const isBatch = isNew ? isBatchCustomer([], titleCaseName(newName)) : !!comboCustomers.find((c) => c.id === customerId)?.isBatch;
  // A home-service job must name the customer's piano (or add one on the spot) so history and recalls stay right.
  // A customer who isn't saved yet has no piano to pick, so the brand is typed here and saved with them.
  const needsPiano = !isSale && !isBatch && (isNew ? false : !pianoId);
  const needsSalePiano = isSale && !salePianoId;
  const moneyBad = [buyCost, prepCost, salePrice, deposit].some((v) => v.trim() !== "" && parsePesoInput(v) === null);

  const pickShowroomPiano = (id: string) => {
    setSalePianoId(id);
    const p = showroomPianos?.find((x) => x.id === id);
    if (!p) return;
    // Prefill, never overwrite what the owner already typed.
    if (!buyCostTouched && p.stockCents > 0) setBuyCost(String(p.stockCents / 100));
    if (!priceTouched && p.listPriceCents) setSalePrice(String(p.listPriceCents / 100));
  };

  const values = (): JobFormValues => ({
    customerId, locationId: locationId || null, pianoId: isSale ? null : pianoId || null, technicianId: technicianId || null,
    title: title.trim() || (isSale ? "" : "Home service visit"), serviceType: isSale ? "delivery" : serviceType, priority, scheduledStart: start || null,
    estimatedMinutes: Math.max(15, Number(minutes) || serviceTypeMinutes(isSale ? "delivery" : serviceType)),
    travelFee: isSale ? 0 : parsePesoInput(travelFee) ?? 0, notes, privateNotes,
    jobType, salePianoId: isSale ? salePianoId || null : null,
    buyCost: parsePesoInput(buyCost) ?? 0, prepCost: parsePesoInput(prepCost) ?? 0,
    salePrice: parsePesoInput(salePrice) ?? 0, deposit: parsePesoInput(deposit) ?? 0,
  });
  const customerReady = typing ? cState === "ready" : !!customerId;
  const canSubmit = customerReady && !needsPiano && !needsSalePiano && !moneyBad && !saving;

  const submit = async () => {
    if (!canSubmit) return;
    if (isNew && choice.kind === "new" && onSubmitNewCustomer) {
      setSaving(true); setSaveErr(null);
      try {
        const res = await onSubmitNewCustomer(
          { name: choice.name, ...(choice.phone ? { phone: choice.phone } : {}), ...(choice.allowDuplicate ? { allowDuplicate: true } : {}) },
          isSale || isBatch ? null : { brand: newPiano.brand.trim(), model: newPiano.model.trim(), type: newPiano.type },
          values(),
        );
        if (res.ok) { setSaving(false); onClose(); return; }
        if (res.duplicateOf) setLearned((cur) => [...cur, { id: res.duplicateOf!.id, name: res.duplicateOf!.name }]);
        setSaveErr(res.error ?? GENERIC_SAVE_ERROR);
      } catch (err) {
        setSaveErr(thrownSubmitMessage(err, typeof navigator !== "undefined" && navigator.onLine === false));
      }
      setSaving(false);
      return;
    }
    onSubmit(values());
    if (!convert) onClose();
  };

  return (
    <div className="space-y-3.5">
      {mode === "new" && showroomPianos && (
        <div role="radiogroup" aria-label="Job type" className="inline-flex rounded-xl p-1" style={{ background: "var(--color-svc-surface-2)" }}>
          {[{ key: "service", label: "Home service" }, { key: "sale", label: "Piano sale" }].map((o) => (
            <button
              key={o.key} type="button" role="radio" aria-checked={jobType === o.key} onClick={() => setJobType(o.key)}
              className="px-4 min-h-11 rounded-lg text-[14px]"
              style={jobType === o.key ? { background: "var(--color-svc-primary)", color: "#fff", fontWeight: 600 } : { color: "var(--color-svc-text-dim)" }}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
      {convert ? (
        <div>
          <p className="text-[12px] uppercase tracking-[0.1em] mb-1.5" style={{ color: "var(--color-svc-text-dim)" }}>Customer</p>
          <p className="text-[16px] font-medium" style={{ color: "var(--color-svc-text)" }}>{convert.customerName}</p>
        </div>
      ) : (
        typing ? (
          <CustomerCombobox label={isSale ? "Buyer" : "Customer"} customers={comboCustomers} value={choice} onChange={pickChoice} autoFocus />
        ) : (
          <Field label={isSale ? "Buyer" : "Customer"}><CustomerPicker customers={customers} value={customerId} onChange={pickCustomer} autoFocus={mode === "new"} /></Field>
        )
      )}

      {isSale && (
        <Field label="Piano being sold" hint={showroomPick ? `${showroomPick.status === "sold" ? "Marked sold in the showroom · " : ""}${showroomPick.listPriceCents ? `Listed at ${peso(showroomPick.listPriceCents)}` : "No list price"}` : "From your showroom list (Piano Management)"}>
          <Select aria-label="Piano being sold" value={salePianoId} onChange={(e) => pickShowroomPiano(e.target.value)}>
            <option value="">Choose a showroom piano…</option>
            {(showroomPianos ?? []).map((p) => <option key={p.id} value={p.id}>{p.label}{p.status === "sold" ? " · sold" : ""}</option>)}
          </Select>
        </Field>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label={isSale ? "Delivery address" : "Location"} hint={loadingPlaces ? "Loading addresses…" : isNew ? "Add an address later on the customer page" : undefined}>
          <Select
            aria-label="Location" disabled={!customerId} value={addPlace ? ADD_PLACE : locationId}
            onChange={(e) => (e.target.value === ADD_PLACE ? setAddPlace(true) : (setAddPlace(false), setLocationId(e.target.value)))}
          >
            <option value="">{customerId || isNew ? "No location yet" : "Pick a customer first"}</option>
            {places.locations.map((l) => <option key={l.id} value={l.id}>{l.label} — {l.addressLine}</option>)}
            {customerId && <option value={ADD_PLACE}>＋ Add an address…</option>}
          </Select>
        </Field>
        {!isSale && !isNew && (
          <Field label="Piano" hint={needsPiano && customerId ? "Required — pick one or add a new piano" : undefined}>
            <Select
              aria-label="Piano" aria-required={!isBatch} disabled={!customerId} value={addPiano ? ADD_PIANO : pianoId}
              onChange={(e) => (e.target.value === ADD_PIANO ? setAddPiano(true) : (setAddPiano(false), setPianoId(e.target.value)))}
            >
              <option value="">{customerId ? (isBatch ? "No piano (trip / batch)" : "Choose a piano…") : "Pick a customer first"}</option>
              {places.pianos.map((p) => <option key={p.id} value={p.id}>{p.label} ({p.type})</option>)}
              {customerId && <option value={ADD_PIANO}>＋ Add a piano…</option>}
            </Select>
          </Field>
        )}
      </div>

      {isNew && cState === "ready" && !isSale && !isBatch && (
        <fieldset className="rounded-xl p-3.5 space-y-3" style={{ background: "var(--color-svc-surface-2)", border: "1px solid var(--color-svc-border)" }}>
          <legend className="px-1.5 text-[12px] uppercase tracking-[0.1em]" style={{ color: "var(--color-svc-text-dim)" }}>Piano for this visit</legend>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Field label="Brand"><TextInput value={newPiano.brand} onChange={(e) => setNewPiano({ ...newPiano, brand: e.target.value })} placeholder="Optional — add later" maxLength={120} /></Field>
            <Field label="Model (optional)"><TextInput value={newPiano.model} onChange={(e) => setNewPiano({ ...newPiano, model: e.target.value })} placeholder="e.g. U1" maxLength={120} /></Field>
            <Field label="Type">
              <Select value={newPiano.type} onChange={(e) => setNewPiano({ ...newPiano, type: e.target.value })}>
                {["Upright", "Grand", "Digital", "Organ"].map((t) => <option key={t}>{t}</option>)}
              </Select>
            </Field>
          </div>
          <p className="text-[12px]" style={{ color: "var(--color-svc-text-dim)" }}>Saved with the new customer. Leave the brand empty to add it later; the piano is then marked “Needs piano info”.</p>
        </fieldset>
      )}

      {addPlace && (
        <InlineBox onCancel={() => { setAddPlace(false); setInlineErr(null); }} onSave={savePlace} busy={inlineBusy} err={inlineErr} saveLabel="Save address" canSave={!!place.addressLine.trim()}>
          <Field label="Label"><TextInput value={place.label} onChange={(e) => setPlace({ ...place, label: e.target.value })} placeholder="e.g. Home" /></Field>
          <Field label="Address"><TextInput value={place.addressLine} onChange={(e) => setPlace({ ...place, addressLine: e.target.value })} placeholder="e.g. 12 Acacia St, Matina" autoFocus /></Field>
          <CityPicker value={placeCity} onChange={(v, hit) => { setPlaceCity(v); if (hit) setPlaceCityName(hit.name); }} />
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
          <Field label="Last tuned (optional)" hint="Starts the recall clock">
            <DateField kind="date" value={piano.lastTuned} onChange={(v) => setPiano({ ...piano, lastTuned: v })} />
          </Field>
        </InlineBox>
      )}

      <Field label="Job title" hint={isSale ? "Leave blank to use “Piano sale — brand model”" : undefined}>
        <TextInput value={title} onChange={(e) => setTitle(e.target.value)} placeholder={isSale ? "e.g. Yamaha C3 — Santos family" : "e.g. Standard tuning — Yamaha U1"} />
      </Field>

      {isSale && (
        <fieldset className="rounded-xl p-3.5 space-y-3" style={{ background: "var(--color-svc-surface-2)", border: "1px solid var(--color-svc-border)" }}>
          <legend className="px-1.5 text-[12px] uppercase tracking-[0.1em]" style={{ color: "var(--color-svc-text-dim)" }}>The sale</legend>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Sale price"><PesoInput value={salePrice} onChange={(v) => { setSalePrice(v); setPriceTouched(true); }} placeholder="e.g. 180,000" /></Field>
            <Field label="Deposit received" hint="Balance = price − deposit, collected at delivery"><PesoInput value={deposit} onChange={setDeposit} placeholder="e.g. 20,000" /></Field>
            <Field label="Buy cost" hint={showroomPick && showroomPick.stockCents > 0 ? `From stock expenses: ${peso(showroomPick.stockCents)}` : "What the piano cost you"}>
              <PesoInput value={buyCost} onChange={(v) => { setBuyCost(v); setBuyCostTouched(true); }} placeholder="e.g. 70,000" />
            </Field>
            <Field label="Prep costs" hint="Restoration, tuning, delivery"><PesoInput value={prepCost} onChange={setPrepCost} placeholder="e.g. 8,000" /></Field>
          </div>
          {moneyBad && <p role="alert" className="text-[12px]" style={{ color: "var(--color-svc-danger)" }}>Use numbers like 12,500.</p>}
        </fieldset>
      )}

      {(() => {
        const serviceTypeField = !isSale && (
          <Field label="Service type">
            <Select value={serviceType} onChange={(e) => { setServiceType(e.target.value); if (!minutesTouched) setMinutes(String(serviceTypeMinutes(e.target.value))); }}>
              {SERVICE_TYPES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </Select>
          </Field>
        );
        const technicianField = (
          <Field label={isSale ? "Delivery crew" : "Technician"}>
            <Select value={technicianId} onChange={(e) => setTechnicianId(e.target.value)}>
              <option value="">Unassigned</option>
              {technicians.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </Select>
          </Field>
        );
        const priorityField = (
          <Field label="Priority">
            <Select value={priority} onChange={(e) => setPriority(e.target.value)}>
              <option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option>
            </Select>
          </Field>
        );
        const startField = (
          <Field label={isSale ? "Delivery date & time" : "Scheduled start"} hint={convert ? "Manila time. Leave blank to book the time later." : "Manila time"}>
            <DateField kind="datetime-local" value={start} onChange={setStart} />
          </Field>
        );
        const durationField = (
          <Field label="Duration">
            <UnitInput type="number" inputMode="numeric" min={15} step={15} suffix="min" value={minutes} onChange={(e) => { setMinutes(e.target.value); setMinutesTouched(true); }} />
          </Field>
        );
        const travelField = !isSale && (
          <Field label="Travel fee">
            <PesoInput value={travelFee} onChange={setTravelFee} placeholder="e.g. 300" />
          </Field>
        );
        const notesField = <Field label="Notes (visible to client)"><TextArea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Please bring the stool; gate code 1234" /></Field>;
        const privateField = <Field label="Private notes (only you)"><TextArea rows={convert ? 3 : 2} value={privateNotes} onChange={(e) => setPrivateNotes(e.target.value)} placeholder="e.g. Pedal squeak, check dampers" /></Field>;

        if (convert) {
          return (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{serviceTypeField}{startField}</div>
              {notesField}
              {privateField}
              <div>
                <button
                  type="button" aria-expanded={moreOpen} aria-controls="convert-more" onClick={() => setMoreOpen((v) => !v)}
                  className="inline-flex items-center gap-1.5 min-h-11 -ml-1 px-1 text-[13px] rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-svc-accent)]"
                  style={{ color: "var(--color-svc-accent)" }}
                >
                  <ChevronDown size={15} aria-hidden="true" className={moreOpen ? "rotate-180 transition-transform" : "transition-transform"} /> More options
                  <span className="text-[12px]" style={{ color: "var(--color-svc-text-faint)" }}>technician, duration, travel fee</span>
                </button>
                {moreOpen && (
                  <div id="convert-more" className="mt-2 space-y-3.5">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{technicianField}{priorityField}</div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{durationField}{travelField}</div>
                  </div>
                )}
              </div>
            </>
          );
        }
        return (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">{serviceTypeField}{technicianField}{priorityField}</div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">{startField}{durationField}{travelField}</div>
            {notesField}
            {privateField}
          </>
        );
      })()}

      {convert && <ErrorLine>{convert.error}</ErrorLine>}
      <div ref={errBoxRef}><ErrorLine>{saveErr}</ErrorLine></div>
      {typing && cState === "needs-decision" && <p className="text-[12px] text-right" style={{ color: "var(--color-svc-text-dim)" }}>Choose “Use existing” or “Create as new anyway” first.</p>}
      <div className="flex justify-end gap-2 pt-2">
        <GhostButton onClick={onClose} disabled={saving} className="!min-h-11">Cancel</GhostButton>
        <PrimaryButton pending={pending || saving} disabled={!customerReady || needsPiano || needsSalePiano || moneyBad} onClick={submit} className="!min-h-11">
          {convert ? convert.submitLabel : mode === "new" ? (isSale ? "Create sale" : "Create job") : "Save changes"}
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
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">{children}</div>
      <ErrorLine>{err}</ErrorLine>
      <div className="flex gap-2">
        <GhostButton onClick={onCancel} className="inline-flex items-center gap-1 !min-h-11"><X size={13} /> Cancel</GhostButton>
        <PrimaryButton pending={busy} disabled={!canSave} onClick={onSave} className="!min-h-11"><Plus size={13} /> {saveLabel}</PrimaryButton>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- expense form */

export type ExpenseFormValues = {
  category: string; description: string; amount: number; spentAt: string | null; vendor: string;
  method: string; reimbursable: boolean; jobId: string | null; receiptUrl: string | null;
  kind: string; pianoId: string | null;
};

export type ExpenseSubmitResult = { ok: boolean; error?: string };

export function ExpenseFormModal(props: {
  open: boolean; onClose: () => void;
  /** Set when opened from a job page: the link is fixed and the picker is hidden. */
  fixedJobId?: string;
  /** Read-only context shown instead of the picker when fixedJobId is set, e.g. "WO-0012 · Maria Santos". */
  fixedJobLabel?: string;
  jobOptions?: { id: string; label: string }[];
  /** Showroom pianos for "Piano stock" expenses. Without it the stock kind isn't offered. */
  pianoOptions?: { id: string; label: string; status: string }[];
  /** Resolves with the server result. The modal stays open (keeping what was typed) until it reports ok. */
  onSubmit: (values: ExpenseFormValues) => Promise<ExpenseSubmitResult>;
  /** Edit mode only: values to pre-fill (and the expense id). */
  initial?: Partial<ExpenseFormValues> & { id?: string };
  /** Edit mode only: the expense already has a stored receipt (kept unless a new photo is chosen). */
  hasReceipt?: boolean;
  mode?: "create" | "edit";
}) {
  // While a save is in flight every close path (X, Esc, backdrop, Cancel) is ignored, so the form can't unmount
  // mid-request and a late result can't close a modal the owner has since reopened.
  const savingRef = useRef(false);
  const [saving, setSavingState] = useState(false);
  const setSaving = (v: boolean) => { savingRef.current = v; setSavingState(v); };
  const guardedClose = () => { if (!savingRef.current) props.onClose(); };
  return (
    <SvcModal open={props.open} onClose={guardedClose} title={props.mode === "edit" ? "Edit expense" : "Add expense"}>
      {props.open && <ExpenseFormBody {...props} saving={saving} setSaving={setSaving} />}
    </SvcModal>
  );
}

function ExpenseFormBody({ saving, setSaving, onClose, fixedJobId, fixedJobLabel, jobOptions = [], pianoOptions, onSubmit, initial, hasReceipt, mode }: Parameters<typeof ExpenseFormModal>[0] & { saving: boolean; setSaving: (v: boolean) => void }) {
  const editing = mode === "edit";
  const [category, setCategory] = useState(initial?.category ?? "fuel");
  // The kind follows the category (Fuel → Job cost, Rent → Overhead) until the owner picks one themselves.
  const [kindPicked, setKindPicked] = useState<string | null>(initial?.kind ?? null);
  const [pianoId, setPianoId] = useState(initial?.pianoId ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [amount, setAmount] = useState(initial?.amount !== undefined ? String(initial.amount) : "");
  const [initialSpentAt] = useState(() => manilaDateTimeLocal(initial?.spentAt ? new Date(initial.spentAt) : new Date()));
  const [spentAt, setSpentAt] = useState(initialSpentAt);
  const [vendor, setVendor] = useState(initial?.vendor ?? "");
  const [method, setMethod] = useState(initial?.method ?? "cash");
  const [reimbursable, setReimbursable] = useState(initial?.reimbursable ?? false);
  const [jobId, setJobId] = useState(fixedJobId ?? initial?.jobId ?? "");
  const effectiveKind = effectiveExpenseKind({ kindPicked, fixedJobId, jobId, category });
  // Linking an expense to a job makes it Job cost (so an old "Overhead" row counts in the margin); stock is kept.
  const pickJob = (next: string) => {
    setKindPicked(kindAfterJobLink(jobId, next, kindPicked));
    setJobId(next);
  };
  const [receipt, setReceipt] = useState<string | null>(null);
  const [receiptErr, setReceiptErr] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const errBoxRef = useRef<HTMLDivElement>(null);
  // On a phone the sheet scrolls: bring a failed save's message into view.
  useEffect(() => { if (saveErr) errBoxRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, [saveErr]);

  const pickReceipt = async (file: File | undefined, input: HTMLInputElement) => {
    setReceiptErr(null);
    if (!file) return;
    if (!file.type.startsWith("image/")) return setReceiptErr("Please choose a photo.");
    setReading(true);
    try { setReceipt(await downsizeImage(file)); }
    catch { setReceiptErr("Couldn't use that photo — try a smaller one."); }
    setReading(false);
    input.value = "";
  };

  const aHint = amountHint(amount, editing ? "edit" : "create");
  const dateChanged = spentAt !== initialSpentAt;
  // Create mode starts collapsed; edit shows everything. Anything already typed in the hidden part keeps it open.
  const forcedOpen = !editing && shouldOpenMore({ vendor, receipt, method, reimbursable, dateChanged });
  const showMore = editing || moreOpen || forcedOpen;
  const needsPiano = stockNeedsPiano({ kind: effectiveKind, fixedJobId, pianosOffered: !!pianoOptions, pianoId });
  const canSave = canSaveExpense({ amount, description, category, mode: editing ? "edit" : "create", blocked: reading || needsPiano });
  const catLabel = categoryLabel(category);
  const blockReason = saveBlockReason({ mode: editing ? "edit" : "create", description, needsPiano, reading });

  const submit = async () => {
    if (!canSave || saving) return;
    setSaving(true); setSaveErr(null);
    try {
      const res = await onSubmit(buildExpensePayload({
        mode: editing ? "edit" : "create", category, description, amount, spentAt, vendor, method, reimbursable,
        jobId, fixedJobId, receipt, kindPicked, pianoId,
      }));
      if (res.ok) { setSaving(false); onClose(); return; }
      setSaveErr(res.error ?? GENERIC_SAVE_ERROR);
    } catch (err) {
      setSaveErr(thrownSubmitMessage(err, typeof navigator !== "undefined" && navigator.onLine === false));
    }
    setSaving(false);
  };

  return (
    <div className="space-y-3.5">
      {fixedJobId && fixedJobLabel && (
        <p className="text-[13px]" style={{ color: "var(--color-svc-text-dim)" }}>For <span style={{ color: "var(--color-svc-text)" }}>{fixedJobLabel}</span></p>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Category">
          <Select value={category} onChange={(e) => setCategory(e.target.value)}>
            {EXPENSE_CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
          </Select>
        </Field>
        <Field label="Amount"><PesoInput value={amount} onChange={setAmount} autoFocus aria-describedby="exp-amount-hint" /></Field>
      </div>
      <p
        id="exp-amount-hint" role={aHint.tone === "danger" ? "alert" : undefined} className="text-[12px] -mt-1.5 min-h-4"
        style={{ color: aHint.tone === "danger" ? "var(--color-svc-danger)" : "var(--color-svc-text-dim)" }}
      >
        {aHint.text}
      </p>
      <Field label={editing ? "Description" : "What was it for?"} hint={editing ? undefined : `Leave blank to save it as “${catLabel}”`}>
        <TextInput value={description} onChange={(e) => setDescription(e.target.value)} placeholder={editing ? "e.g. Diesel — Buhangin run" : "e.g. Diesel, Buhangin run"} />
      </Field>
      {!fixedJobId && (
        <Field label="What is this for?" hint={EXPENSE_KINDS.find((k) => k.key === effectiveKind)?.hint}>
          <Select value={effectiveKind} onChange={(e) => setKindPicked(e.target.value)}>
            {EXPENSE_KINDS.filter((k) => k.key !== "stock" || pianoOptions).map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
          </Select>
        </Field>
      )}
      {effectiveKind === "stock" && !fixedJobId && pianoOptions && (
        <Field label="Which piano?" hint="Counts as a cost only once this piano is sold">
          <Select value={pianoId} onChange={(e) => setPianoId(e.target.value)}>
            <option value="">Choose a piano…</option>
            {pianoOptions.map((p) => <option key={p.id} value={p.id}>{p.label}{p.status === "sold" ? " · sold" : ""}</option>)}
          </Select>
        </Field>
      )}
      {!fixedJobId && (
        <Field label="Link to a job (optional)">
          <Select value={jobId} onChange={(e) => pickJob(e.target.value)}>
            <option value="">Not linked to a job</option>
            {jobOptions.map((j) => <option key={j.id} value={j.id}>{j.label}</option>)}
          </Select>
        </Field>
      )}

      {!editing && (
        <button
          type="button" aria-expanded={showMore} aria-controls="expense-more" onClick={() => { if (!forcedOpen) setMoreOpen((v) => !v); }}
          className="inline-flex flex-wrap items-center gap-x-1.5 min-h-11 -ml-1 px-1 text-[13px] text-left rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-svc-accent)] cursor-pointer"
          style={{ color: "var(--color-svc-accent)" }}
        >
          <ChevronDown size={15} aria-hidden="true" className={showMore ? "rotate-180 transition-transform" : "transition-transform"} /> More details
          <span className="text-[12px]" style={{ color: "var(--color-svc-text-dim)" }}>vendor, date, paid with, reimbursable, receipt</span>
        </button>
      )}

      {/* Always rendered so aria-controls resolves; hidden while collapsed. */}
      <div id="expense-more" hidden={!showMore} className="space-y-3.5">
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
        <div>
          <p className="text-[12px] uppercase tracking-[0.1em] mb-1.5" style={{ color: "var(--color-svc-text-dim)" }}>Receipt photo (optional)</p>
          {/* Two inputs: one opens the rear camera on phones, the other the gallery / file picker (capture can hide the gallery). */}
          <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" tabIndex={-1} aria-hidden="true" onChange={(e) => pickReceipt(e.target.files?.[0], e.target)} />
          <input ref={galleryRef} type="file" accept="image/*" className="hidden" tabIndex={-1} aria-hidden="true" onChange={(e) => pickReceipt(e.target.files?.[0], e.target)} />
          {receipt ? (
            <div className="flex items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={receipt} alt="Receipt preview" width={80} height={80} className="h-20 w-20 rounded-lg object-cover border" style={{ borderColor: "var(--color-svc-border)" }} />
              <GhostButton onClick={() => setReceipt(null)} className="inline-flex items-center gap-1.5 !min-h-11"><X size={13} /> Remove</GhostButton>
            </div>
          ) : reading ? (
            <p className="text-[13px] min-h-11 flex items-center" style={{ color: "var(--color-svc-text-dim)" }}>Preparing photo…</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              <GhostButton onClick={() => cameraRef.current?.click()} className="inline-flex items-center gap-2 !min-h-11">
                <Camera size={15} /> Take photo
              </GhostButton>
              <GhostButton onClick={() => galleryRef.current?.click()} className="inline-flex items-center gap-2 !min-h-11">
                <ImageIcon size={15} /> Choose photo
              </GhostButton>
            </div>
          )}
          {editing && hasReceipt && !receipt && (
            <p className="text-[12px] mt-1.5" style={{ color: "var(--color-svc-text-dim)" }}>A receipt is already saved. Choosing a new photo replaces it.</p>
          )}
          {receiptErr && <p role="alert" className="text-[12px] mt-1.5" style={{ color: "var(--color-svc-danger)" }}>{receiptErr}</p>}
        </div>
      </div>

      <div ref={errBoxRef}><ErrorLine>{saveErr}</ErrorLine></div>
      {blockReason && <p className="text-[12px] text-right" style={{ color: "var(--color-svc-text-dim)" }}>{blockReason}</p>}
      <div className="flex justify-end gap-2 pt-2">
        <GhostButton onClick={onClose} disabled={saving} className="!min-h-11">Cancel</GhostButton>
        <PrimaryButton pending={saving} disabled={!canSave} className="!min-h-11" onClick={submit}>
          {editing ? "Save changes" : "Add expense"}
        </PrimaryButton>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ time entry edit */

export type TimeEditValues = { kind: string; startedAt: string; endedAt: string | null; note: string };

/** Fix a time entry by hand (forgot to tap Arrived, left a timer running). An edited status-derived entry stops following the status events. */
export function TimeEditModal(props: {
  open: boolean; onClose: () => void; pending: boolean;
  log: { id: string; kind: string; startedAt: Date | string; endedAt: Date | string | null; note: string | null; fromStatus: boolean } | null;
  onSubmit: (id: string, values: TimeEditValues) => void;
}) {
  return (
    <SvcModal open={props.open} onClose={props.onClose} title="Edit time entry">
      {props.open && props.log && <TimeEditBody {...props} log={props.log} />}
    </SvcModal>
  );
}

function TimeEditBody({ onClose, pending, log, onSubmit }: { onClose: () => void; pending: boolean; log: NonNullable<Parameters<typeof TimeEditModal>[0]["log"]>; onSubmit: (id: string, v: TimeEditValues) => void }) {
  const [kind, setKind] = useState(log.kind);
  const [start, setStart] = useState(() => manilaDateTimeLocal(new Date(log.startedAt)));
  const [end, setEnd] = useState(() => (log.endedAt ? manilaDateTimeLocal(new Date(log.endedAt)) : ""));
  const [note, setNote] = useState(log.note ?? "");
  const bad = !!start && !!end && new Date(`${end}:00+08:00`) <= new Date(`${start}:00+08:00`);
  return (
    <div className="space-y-3.5">
      {log.fromStatus && (
        <p className="text-[13px]" style={{ color: "var(--color-svc-text-dim)" }}>
          This entry came from the status buttons. Once you change it, it is yours — later status taps won&apos;t move it.
        </p>
      )}
      <Field label="Type">
        <Select value={kind} onChange={(e) => setKind(e.target.value)}>
          {TIME_KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
        </Select>
      </Field>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Start"><DateField kind="datetime-local" value={start} onChange={setStart} /></Field>
        <Field label="End" hint={log.endedAt ? undefined : "Leave empty to keep it running"}><DateField kind="datetime-local" value={end} onChange={setEnd} /></Field>
      </div>
      {bad && <p role="alert" className="text-[12px]" style={{ color: "var(--color-svc-danger)" }}>End time must be after the start time.</p>}
      <Field label="Note"><TextInput value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      <div className="flex justify-end gap-2 pt-2">
        <GhostButton onClick={onClose} className="!min-h-11">Cancel</GhostButton>
        <PrimaryButton
          pending={pending} disabled={!start || bad} className="!min-h-11"
          onClick={() => { onSubmit(log.id, { kind, startedAt: start, endedAt: end || null, note }); onClose(); }}
        >
          Save changes
        </PrimaryButton>
      </div>
    </div>
  );
}
