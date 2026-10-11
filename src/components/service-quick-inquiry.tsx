"use client";

/**
 * Quick inquiry: name, phone, area and what they asked for. Saving makes (or finds) the customer and puts the request on
 * the waitlist with a follow-up already set. Piano model, value, source and extra notes sit under "More details".
 */

import { useRef, useState, useTransition } from "react";
import { CalendarPlus, CheckCircle2, ChevronDown } from "lucide-react";
import { fmtDate } from "@/lib/format";
import { INQUIRY_LIMITS, validateQuickInquiry, type InquiryField } from "@/lib/service-inquiry";
import { WAIT_SOURCES } from "@/lib/service-waitlist";
import { CityPicker, type PlaceValue } from "@/components/service-place-picker";
import { createQuickInquiry, type QuickInquiryResult } from "@/server/service-waitlist";
import { ErrorLine, Field, GhostButton, PesoInput, PrimaryButton, Select, SvcModal, TextArea, TextInput } from "@/components/service-ui";

const FAINT = { color: "var(--color-svc-text-faint)" } as const;
const DIM = { color: "var(--color-svc-text-dim)" } as const;
const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-svc-accent)]";

export function QuickInquiryModal({ open, onClose, onConvert }: { open: boolean; onClose: () => void; onConvert: (entryId: string) => void }) {
  return (
    <SvcModal open={open} onClose={onClose} title="Quick inquiry" subtitle="It goes on the waitlist with a follow-up set for you.">
      {open && <Body onClose={onClose} onConvert={onConvert} />}
    </SvcModal>
  );
}

function FieldError({ id, children }: { id: string; children?: string }) {
  if (!children) return null;
  return <p id={id} role="alert" className="text-[12px] mt-1" style={{ color: "var(--color-svc-danger)" }}>{children}</p>;
}

function Body({ onClose, onConvert }: { onClose: () => void; onConvert: (entryId: string) => void }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [place, setPlace] = useState<PlaceValue>({ cityCode: null, barangayCode: null });
  const [request, setRequest] = useState("");
  const [more, setMore] = useState(false);
  const [pianoModel, setPianoModel] = useState("");
  const [value, setValue] = useState("");
  const [source, setSource] = useState("phone");
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<Partial<Record<InquiryField, string>>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [saved, setSaved] = useState<QuickInquiryResult | null>(null);
  const [pending, start] = useTransition();

  const clear = (f: InquiryField) => setErrors((e) => (e[f] ? { ...e, [f]: undefined } : e));
  const focusFirstInvalid = () => setTimeout(() => {
    const f = formRef.current;
    if (!f) return;
    // Document order; the area picker has no aria-invalid of its own, so it is found by its wrapper.
    const target = f.querySelector<HTMLElement>("[aria-invalid='true'], #qi-area[data-invalid='true'] input");
    target?.focus();
  }, 0);

  const reset = () => {
    setName(""); setPhone(""); setPlace({ cityCode: null, barangayCode: null }); setRequest(""); setMore(false);
    setPianoModel(""); setValue(""); setSource("phone"); setNotes(""); setErrors({}); setServerError(null); setSaved(null);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (pending) return;
    setServerError(null);
    const input = { name, phone, cityCode: place.cityCode, barangayCode: place.barangayCode, request, pianoModel, estValue: value, notes, source };
    const check = validateQuickInquiry(input);
    if (!check.ok) {
      setErrors(check.errors);
      // The optional fields are tucked away: open them if the problem is in there.
      if (check.errors.estValue || check.errors.source) setMore(true);
      focusFirstInvalid();
      return;
    }
    setErrors({});
    start(async () => {
      try {
        const r = await createQuickInquiry(input);
        if (!r.ok || !r.data) {
          setErrors(r.ok ? {} : r.fields ?? {});
          setServerError(r.ok ? "Couldn't save the inquiry." : r.error);
          if (!r.ok && r.fields) focusFirstInvalid();
          return;
        }
        setSaved(r.data);
      } catch {
        setServerError("Couldn't reach the server. Nothing was saved; try again.");
      }
    });
  };

  if (saved) {
    const when = fmtDate(new Date(saved.nextFollowUpAt));
    return (
      <div className="space-y-4">
        <div role="status" className="flex items-start gap-3">
          <CheckCircle2 size={22} aria-hidden="true" className="shrink-0 mt-0.5" style={{ color: "var(--color-svc-success)" }} />
          <div>
            <p className="text-[16px] font-medium" style={{ color: "var(--color-svc-text)" }}>
              {saved.duplicate ? "Already saved." : "Saved."} Follow up on {when}.
            </p>
            <p className="text-[14px] mt-1" style={DIM}>
              {saved.duplicate
                ? `This is the same inquiry you just sent for ${saved.customerName}, so nothing was added twice.`
                : saved.customerWasNew ? `New customer: ${saved.customerName}.` : `Added to ${saved.customerName}, who is already a customer (same phone number).`}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap justify-end gap-2 pt-1">
          <GhostButton onClick={reset} className="!min-h-11">Add another</GhostButton>
          <GhostButton onClick={() => { onConvert(saved.entryId); onClose(); }} className="!min-h-11 !text-[var(--color-svc-accent)]">
            <CalendarPlus size={14} aria-hidden="true" /> Convert to job
          </GhostButton>
          <PrimaryButton onClick={onClose} className="!min-h-11">Done</PrimaryButton>
        </div>
      </div>
    );
  }

  return (
    <form ref={formRef} onSubmit={submit} noValidate className="space-y-3.5">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <Field label="Name">
            <TextInput
              value={name} onChange={(e) => { setName(e.target.value); clear("name"); }} placeholder="e.g. Maria Santos" autoFocus maxLength={INQUIRY_LIMITS.name}
              autoComplete="off" aria-invalid={errors.name ? true : undefined} aria-describedby={errors.name ? "qi-name-err" : undefined}
            />
          </Field>
          <FieldError id="qi-name-err">{errors.name}</FieldError>
        </div>
        <div>
          <Field label="Phone">
            <TextInput
              type="tel" inputMode="tel" value={phone} onChange={(e) => { setPhone(e.target.value); clear("phone"); }} placeholder="e.g. 0917 123 4567" maxLength={INQUIRY_LIMITS.phone}
              autoComplete="off" aria-invalid={errors.phone ? true : undefined} aria-describedby={errors.phone ? "qi-phone-err" : undefined}
            />
          </Field>
          <FieldError id="qi-phone-err">{errors.phone}</FieldError>
        </div>
      </div>

      <div id="qi-area" data-invalid={errors.cityCode ? "true" : undefined}>
        <CityPicker label="Area" value={place} onChange={(v) => { setPlace(v); clear("cityCode"); }} />
        <FieldError id="qi-area-err">{errors.cityCode}</FieldError>
      </div>

      <div>
        <Field label="What did they ask for?">
          <TextInput
            value={request} onChange={(e) => { setRequest(e.target.value); clear("request"); }} placeholder="e.g. Tuning for an upright, free on Saturdays" maxLength={INQUIRY_LIMITS.request}
            autoComplete="off" aria-invalid={errors.request ? true : undefined} aria-describedby={errors.request ? "qi-request-err" : undefined}
          />
        </Field>
        <FieldError id="qi-request-err">{errors.request}</FieldError>
      </div>

      <div>
        <button
          type="button" aria-expanded={more} aria-controls="qi-more" onClick={() => setMore((v) => !v)}
          className={`inline-flex items-center gap-1.5 min-h-11 -ml-1 px-1 text-[13px] rounded-lg ${FOCUS}`} style={{ color: "var(--color-svc-accent)" }}
        >
          <ChevronDown size={15} aria-hidden="true" className={more ? "rotate-180 transition-transform" : "transition-transform"} /> More details
          <span className="text-[12px]" style={FAINT}>piano model, value, source, notes</span>
        </button>
        {more && (
          <div id="qi-more" className="mt-2 space-y-3.5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Piano model" hint="Kept in the notes. No piano record is made.">
                <TextInput value={pianoModel} onChange={(e) => setPianoModel(e.target.value)} placeholder="e.g. Yamaha U1" maxLength={INQUIRY_LIMITS.pianoModel} autoComplete="off" />
              </Field>
              <div>
                <Field label="Estimated value">
                  <PesoInput value={value} onChange={(v) => { setValue(v); clear("estValue"); }} aria-describedby={errors.estValue ? "qi-value-err" : undefined} />
                </Field>
                <FieldError id="qi-value-err">{errors.estValue}</FieldError>
              </div>
            </div>
            <Field label="Where from">
              <Select value={source} onChange={(e) => setSource(e.target.value)}>
                {WAIT_SOURCES.filter((s) => s.key !== "recall").map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
              </Select>
            </Field>
            <Field label="More notes">
              <TextArea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Prefers Saturdays; gate code 1234" maxLength={INQUIRY_LIMITS.notes} />
            </Field>
          </div>
        )}
      </div>

      <ErrorLine>{serverError}</ErrorLine>
      <div className="flex justify-end gap-2 pt-2">
        <GhostButton type="button" onClick={onClose} className="!min-h-11">Cancel</GhostButton>
        <PrimaryButton type="submit" pending={pending} className="!min-h-11">Save inquiry</PrimaryButton>
      </div>
    </form>
  );
}
