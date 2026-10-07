"use client";

import TripSettings from "@/components/service-settings-trips";
import PriceBook from "@/components/service-price-book";

import { useEffect, useMemo, useState, useTransition } from "react";
import { Plus, Trash2, Users, Building2, CalendarClock, Database, Receipt, TrendingUp, Eye } from "lucide-react";
import { peso } from "@/lib/format";
import { DAYS_SHORT } from "@/lib/config";
import type { AvgInvoiceBasis } from "@/lib/service";
import { parsePesoInput } from "@/lib/service-flow";
import type { ServiceSettings } from "@/server/service-data";
import type { ServiceCatalogItem, ServiceTechnician } from "@/db/schema";
import {
  updateSettings, createTechnician, updateTechnician, deleteTechnician,
  seedServiceDemo,
} from "@/server/service";
import {
  Chip, ConfirmDialog, EmptyState, ErrorLine, Field, GhostButton, Money, PrimaryButton,
  SectionCard, Select, SuccessLine, SvcModal, TextInput, ToggleRow, TONE_TEXT, UnitInput, PesoInput,
} from "@/components/service-ui";

const minToTime = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const timeToMin = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

export default function SettingsClient({
  settings,
  technicians,
  catalog,
  hasData,
  homeBase,
  radiusKm,
  routes,
  templates,
  cityLabels,
}: {
  settings: ServiceSettings;
  technicians: ServiceTechnician[];
  catalog: ServiceCatalogItem[];
  hasData: boolean;
  homeBase: string;
  radiusKm: number;
  routes: { id: string; name: string; cityCodes: string[] }[];
  templates: { key: string; name: string; body: string }[];
  cityLabels: Record<string, string>;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [techOpen, setTechOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const [businessName, setBusinessName] = useState(settings.businessName);
  const [invoicePrefix, setInvoicePrefix] = useState(settings.invoicePrefix);
  const [jobPrefix, setJobPrefix] = useState(settings.jobPrefix);
  const [taxRate, setTaxRate] = useState(String(settings.taxRateBps / 100));
  const [taxLabel, setTaxLabel] = useState(settings.taxLabel);
  const [terms, setTerms] = useState(String(settings.defaultTermsDays));
  const [hourly, setHourly] = useState(String(settings.defaultHourlyRateCents / 100));
  const [travelFee, setTravelFee] = useState(String(settings.defaultTravelFeeCents / 100));
  const [interval, setInterval] = useState(String(settings.defaultTuningIntervalMonths));
  const [lead, setLead] = useState(String(settings.reminderLeadDays));
  const [hours, setHours] = useState<Record<number, [number, number] | null>>(settings.workingHours ?? {});
  const [vatEnabled, setVatEnabled] = useState(settings.vatEnabled);
  const [marginExcludesVat, setMarginExcludesVat] = useState(settings.marginExcludesVat);
  const [includeLaborCost, setIncludeLaborCost] = useState(settings.includeLaborCost);
  const [avgInvoiceBasis, setAvgInvoiceBasis] = useState<AvgInvoiceBasis>(settings.avgInvoiceBasis);
  const [showFinance, setShowFinance] = useState(settings.showFinance);
  const [showJobMargins, setShowJobMargins] = useState(settings.showJobMargins);


  // "Unsaved changes" = the form no longer matches the last saved snapshot.
  const current = useMemo(
    () => JSON.stringify({ businessName, invoicePrefix, jobPrefix, taxRate, taxLabel, terms, hourly, travelFee, interval, lead, hours, vatEnabled, marginExcludesVat, includeLaborCost, avgInvoiceBasis, showFinance, showJobMargins }),
    [businessName, invoicePrefix, jobPrefix, taxRate, taxLabel, terms, hourly, travelFee, interval, lead, hours, vatEnabled, marginExcludesVat, includeLaborCost, avgInvoiceBasis, showFinance, showJobMargins],
  );
  const [baseline, setBaseline] = useState(current);
  const dirty = current !== baseline;
  // Which part of the page changed — the save bar names it so "Save" is never ambiguous.
  const changedSections = (() => {
    if (!dirty) return [] as string[];
    const a = JSON.parse(baseline) as Record<string, unknown>;
    const b = JSON.parse(current) as Record<string, unknown>;
    const differs = (keys: string[]) => keys.some((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
    return [
      differs(["businessName", "invoicePrefix", "jobPrefix", "terms", "hourly", "travelFee", "interval", "lead"]) && "Business & invoicing",
      differs(["vatEnabled", "taxLabel", "taxRate"]) && "Tax & invoices",
      differs(["marginExcludesVat", "includeLaborCost", "avgInvoiceBasis"]) && "Profit & reports",
      differs(["showFinance", "showJobMargins"]) && "Workspace visibility",
      differs(["hours"]) && "Dispatch hours",
    ].filter((x): x is string => !!x);
  })();
  const discard = () => {
    const b = JSON.parse(baseline) as Record<string, never>;
    setBusinessName(b.businessName); setInvoicePrefix(b.invoicePrefix); setJobPrefix(b.jobPrefix); setTaxRate(b.taxRate);
    setTaxLabel(b.taxLabel); setTerms(b.terms); setHourly(b.hourly); setTravelFee(b.travelFee); setInterval(b.interval);
    setLead(b.lead); setHours(b.hours); setVatEnabled(b.vatEnabled); setMarginExcludesVat(b.marginExcludesVat);
    setIncludeLaborCost(b.includeLaborCost); setAvgInvoiceBasis(b.avgInvoiceBasis); setShowFinance(b.showFinance); setShowJobMargins(b.showJobMargins);
  };

  // Warn before the tab closes / reloads, and before an in-app link would drop the edits.
  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || e.defaultPrevented || e.metaKey || e.ctrlKey) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin || url.pathname === window.location.pathname) return;
      if (!window.confirm("You have unsaved changes. Leave without saving?")) { e.preventDefault(); e.stopPropagation(); }
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", onClick, true);
    return () => { window.removeEventListener("beforeunload", beforeUnload); document.removeEventListener("click", onClick, true); };
  }, [dirty]);

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const res = await fn();
      if (res && !res.ok) setError(res.error ?? "Something went wrong.");
    });
  };

  const saveBusiness = () => {
    run(async () => {
      const res = await updateSettings({
        businessName,
        invoicePrefix,
        jobPrefix,
        taxRateBps: Math.round(Number(taxRate) * 100),
        taxLabel,
        defaultTermsDays: Number(terms),
        defaultHourlyRate: Number(hourly),
        defaultTravelFee: Number(travelFee),
        defaultTuningIntervalMonths: Number(interval),
        reminderLeadDays: Number(lead),
        workingHours: hours,
        vatEnabled,
        marginExcludesVat,
        includeLaborCost,
        avgInvoiceBasis,
        showFinance,
        showJobMargins,
      });
      if (res.ok) { setSaved(true); setBaseline(current); }
      return res;
    });
  };

  return (
    <div className={`px-4 sm:px-6 lg:px-8 py-6 lg:py-8 max-w-[1100px] mx-auto space-y-6 ${dirty ? "pb-28" : ""}`}>
      <header>
        <p className="text-[12px] uppercase tracking-[0.2em]" style={{ color: "var(--color-svc-text-faint)" }}>
          Home Service
        </p>
        <h1 className="font-serif text-3xl mt-1" style={{ color: "var(--color-svc-text)" }}>
          Settings
        </h1>
        <p className="text-[13px] mt-1" style={{ color: "var(--color-svc-text-dim)" }}>
          Numbering, tax, crew rates, and the price book used on every visit
        </p>
      </header>

      <ErrorLine>{error}</ErrorLine>
      <SuccessLine>{saved ? "Settings saved." : null}</SuccessLine>

      {/* Business + invoicing */}
      <SectionCard title={<>Business &amp; invoicing <span className="font-normal text-[12px]" style={{ color: "var(--color-svc-text-faint)" }}>· tax, reports, visibility and hours below save with “Save changes”</span></>} className="overflow-hidden">
        <div className="px-5 py-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Business name" className="sm:col-span-2">
            <TextInput value={businessName} onChange={(e) => setBusinessName(e.target.value)} />
          </Field>
          <Field label="Invoice prefix">
            <TextInput value={invoicePrefix} onChange={(e) => setInvoicePrefix(e.target.value.toUpperCase())} />
          </Field>
          <Field label="Job prefix">
            <TextInput value={jobPrefix} onChange={(e) => setJobPrefix(e.target.value.toUpperCase())} />
          </Field>
          <Field label="Payment terms" hint="How long clients have to pay">
            <UnitInput type="number" inputMode="numeric" min={0} suffix="days" value={terms} onChange={(e) => setTerms(e.target.value)} />
          </Field>
          <Field label="Default crew rate" hint="What you pay per hour of crew time">
            <UnitInput type="number" inputMode="decimal" min={0} step="50" prefix="₱" suffix="/hr" value={hourly} onChange={(e) => setHourly(e.target.value)} />
          </Field>
          <Field label="Default travel fee">
            <UnitInput type="number" inputMode="decimal" min={0} step="50" prefix="₱" value={travelFee} onChange={(e) => setTravelFee(e.target.value)} />
          </Field>
          <Field label="Tuning interval" hint="Time between recalls">
            <UnitInput type="number" inputMode="numeric" min={1} suffix="months" value={interval} onChange={(e) => setInterval(e.target.value)} />
          </Field>
          <Field label="Recall lead time" hint="How early to warn before a recall is due">
            <UnitInput type="number" inputMode="numeric" min={0} suffix="days" value={lead} onChange={(e) => setLead(e.target.value)} />
          </Field>
        </div>

        <div className="px-5 py-4 space-y-4" style={{ borderTop: "1px solid var(--color-svc-border)" }}>
          <SubHeading icon={<Receipt size={12} />}>Tax &amp; invoices</SubHeading>
          <ToggleRow
            label="Charge VAT on new invoices"
            hint="Off means no VAT on newly created invoices; existing invoices stay as saved."
            checked={vatEnabled}
            onChange={setVatEnabled}
          />
          {vatEnabled ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Tax label" hint="Shown on invoices">
                <TextInput value={taxLabel} onChange={(e) => setTaxLabel(e.target.value)} />
              </Field>
              <Field label="Tax rate" hint="12 = Philippine VAT">
                <UnitInput type="number" inputMode="decimal" min={0} step="1" suffix="%" value={taxRate} onChange={(e) => setTaxRate(e.target.value)} />
              </Field>
            </div>
          ) : (
            <p className="text-[13px]" style={{ color: "var(--color-svc-text-faint)" }}>
              VAT is off — new invoices carry no tax. Turn it on to set the label and rate.
            </p>
          )}
        </div>

        <div className="px-5 py-4 space-y-4" style={{ borderTop: "1px solid var(--color-svc-border)" }}>
          <SubHeading icon={<TrendingUp size={12} />}>Profit &amp; reports</SubHeading>
          <ToggleRow
            label="Exclude VAT from job profit"
            hint={vatEnabled
              ? "VAT goes to the government, so profit uses the amount before VAT."
              : "Not applicable while VAT is off (it only affects invoices that carry VAT)."}
            checked={marginExcludesVat}
            disabled={!vatEnabled}
            onChange={setMarginExcludesVat}
          />
          <ToggleRow
            label="Include crew labor in job cost"
            hint="Uses recorded crew time and rates."
            checked={includeLaborCost}
            onChange={setIncludeLaborCost}
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Average invoice based on">
              <Select
                value={avgInvoiceBasis}
                onChange={(e) => setAvgInvoiceBasis(e.target.value === "job" ? "job" : "invoice")}
              >
                <option value="invoice">Invoices</option>
                <option value="job">Completed jobs</option>
              </Select>
            </Field>
          </div>
        </div>

        <div className="px-5 py-4 space-y-4" style={{ borderTop: "1px solid var(--color-svc-border)" }}>
          <SubHeading icon={<Eye size={12} />}>Workspace visibility</SubHeading>
          <ToggleRow
            label="Show Finance in menu"
            hint="Hides the link only; the page still opens by address."
            checked={showFinance}
            onChange={setShowFinance}
          />
          <ToggleRow
            label="Show job margins"
            hint="Hides profit and margin on job pages and in Finance."
            checked={showJobMargins}
            onChange={setShowJobMargins}
          />
        </div>

        <div className="px-5 py-4 space-y-3" style={{ borderTop: "1px solid var(--color-svc-border)" }}>
          <SubHeading icon={<CalendarClock size={12} />}>Dispatch hours</SubHeading>
          <div className="space-y-2">
            {DAYS_SHORT.map((day, index) => {
              const value = hours[index] ?? null;
              const open = !!value;
              return (
                <div key={day} className="flex items-center gap-3">
                  <label className="inline-flex items-center gap-3 min-h-11 pr-3 text-[12px] cursor-pointer" style={{ color: "var(--color-svc-text-dim)" }}>
                    <span className="w-10" style={{ color: "var(--color-svc-text-dim)" }}>{day}</span>
                    <input
                      type="checkbox"
                      className="w-5 h-5 shrink-0 cursor-pointer"
                      checked={open}
                      onChange={(e) =>
                        setHours((prev) => ({ ...prev, [index]: e.target.checked ? [480, 1080] : null }))
                      }
                    />
                    Open
                  </label>
                  {open ? (
                    <>
                      <TextInput
                        type="time"
                        aria-label={`${day} opening time`}
                        value={minToTime(value[0])}
                        onChange={(e) =>
                          setHours((prev) => ({ ...prev, [index]: [timeToMin(e.target.value), value[1]] }))
                        }
                        className="!w-32"
                      />
                      <span style={{ color: "var(--color-svc-text-faint)" }}>to</span>
                      <TextInput
                        type="time"
                        aria-label={`${day} closing time`}
                        value={minToTime(value[1])}
                        onChange={(e) =>
                          setHours((prev) => ({ ...prev, [index]: [value[0], timeToMin(e.target.value)] }))
                        }
                        className="!w-32"
                      />
                    </>
                  ) : (
                    <span className="text-[12px]" style={{ color: "var(--color-svc-text-faint)" }}>Closed</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>

      </SectionCard>

      <TripSettings homeBase={homeBase} radiusKm={radiusKm} routes={routes} templates={templates} cityLabels={cityLabels} />

      {/* Appears only when something changed */}
      {dirty && (
        <div
          role="status"
          aria-label="Unsaved changes"
          className="fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] md:bottom-0 md:left-60 z-30 border-t px-4 sm:px-6 lg:px-8 py-3 flex flex-wrap items-center justify-between gap-3 anim-sheet"
          style={{ background: "var(--color-svc-surface)", borderColor: "var(--color-svc-border-strong)", boxShadow: "0 -10px 30px rgba(0,0,0,0.35)" }}
        >
          <p className="text-[14px]" style={{ color: "var(--color-svc-text)" }}>
            <span className="inline-block w-2 h-2 rounded-full mr-2 align-middle" style={{ background: "var(--color-svc-warn)" }} />
            You have unsaved changes{changedSections.length ? <span style={{ color: "var(--color-svc-text-dim)" }}> in {changedSections.join(", ")}</span> : null}
          </p>
          <div className="flex items-center gap-2">
            <GhostButton onClick={discard} className="!min-h-11">Discard</GhostButton>
            <PrimaryButton pending={pending} onClick={saveBusiness} className="!min-h-11">
              <Building2 size={14} /> Save changes
            </PrimaryButton>
          </div>
        </div>
      )}

      {/* Crew */}
      <SectionCard
        title={<>Field crew <span className="font-normal text-[12px]" style={{ color: "var(--color-svc-text-faint)" }}>· saves instantly</span></>}
        action={
          <GhostButton onClick={() => setTechOpen(true)} className="inline-flex items-center gap-1.5">
            <Plus size={13} /> Add technician
          </GhostButton>
        }
      >
        {technicians.length === 0 ? (
          <EmptyState
            icon={<Users size={19} strokeWidth={1.7} />}
            title="No technicians yet"
            hint="Add the people who go out on visits — their hourly rate drives job costing."
          />
        ) : (
          <div className="svc-divide">
            {technicians.map((t) => (
              <div key={t.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <span className="w-3 h-3 rounded-full" style={{ background: t.color }} />
                <div className="min-w-[160px] flex-1">
                  <p className="text-[14px]" style={{ color: "var(--color-svc-text)" }}>{t.name}</p>
                  <p className="text-[12px]" style={{ color: "var(--color-svc-text-faint)" }}>
                    {t.title}
                    {t.phone ? ` · ${t.phone}` : ""}
                  </p>
                </div>
                <label className="text-[12px] inline-flex items-center gap-1.5" style={{ color: "var(--color-svc-text-dim)" }}>
                  Cost
                  <UnitInput
                    type="number"
                    prefix="₱"
                    step="50"
                    defaultValue={t.hourlyRateCents / 100}
                    onBlur={(e) => run(() => updateTechnician(t.id, { hourlyRate: Number(e.target.value) }))}
                    className="input-svc !w-24 !py-1 !px-2 text-[12px]"
                  />
                </label>
                <label className="text-[12px] inline-flex items-center gap-1.5" style={{ color: "var(--color-svc-text-dim)" }}>
                  Charge
                  <UnitInput
                    type="number"
                    prefix="₱"
                    step="50"
                    defaultValue={t.billableRateCents / 100}
                    onBlur={(e) => run(() => updateTechnician(t.id, { billableRate: Number(e.target.value) }))}
                    className="input-svc !w-24 !py-1 !px-2 text-[12px]"
                  />
                </label>
                <button
                  onClick={() => run(() => updateTechnician(t.id, { active: !t.active }))}
                  className="text-[12px]"
                >
                  {t.active ? <Chip tone="success">active</Chip> : <Chip tone="slate">inactive</Chip>}
                </button>
                <button
                  onClick={() => setDeleteId(t.id)}
                  className="inline-flex items-center justify-center min-w-11 min-h-11 rounded-lg hover:bg-white/[0.06]"
                  style={{ color: "var(--color-svc-text-faint)" }}
                  aria-label="Delete technician"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {/* Price book */}
      <PriceBook catalog={catalog} />

      {/* Demo data */}
      {!hasData && (
        <SectionCard title="Sample data" action={<span className="text-[12px]" style={{ color: "var(--color-svc-text-faint)" }}>only offered while the workspace is empty</span>}>
          <div className="px-5 py-4 flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-[14px]" style={{ color: "var(--color-svc-text)" }}>Load a realistic sample dataset</p>
              <p className="text-[12px] mt-0.5" style={{ color: "var(--color-svc-text-faint)" }}>
                Four customers, two technicians, a price book, jobs, time logs, and expenses.
              </p>
            </div>
            <GhostButton disabled={pending} onClick={() => run(() => seedServiceDemo())} className="inline-flex items-center gap-1.5 !min-h-11">
              <Database size={14} /> Load sample data
            </GhostButton>
          </div>
        </SectionCard>
      )}

      <AddTechnicianModal open={techOpen} onClose={() => setTechOpen(false)} pending={pending} onCreate={(i) => run(() => createTechnician(i))} />

      <ConfirmDialog
        open={!!deleteId}
        title="Remove this technician?"
        message="Past time logs keep their record; the crew member stops appearing on the dispatch board."
        onCancel={() => setDeleteId(null)}
        onConfirm={() => {
          if (deleteId) run(() => deleteTechnician(deleteId));
          setDeleteId(null);
        }}
      />
    </div>
  );
}

/** Small uppercase section label inside a settings card (matches "Dispatch hours"). */
function SubHeading({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <p
      className="text-[12px] uppercase tracking-[0.1em] flex items-center gap-1.5"
      style={{ color: "var(--color-svc-text-dim)" }}
    >
      {icon} {children}
    </p>
  );
}

function AddTechnicianModal({
  open,
  onClose,
  pending,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  pending: boolean;
  onCreate: (input: {
    name: string; title: string; phone: string; color: string;
    hourlyRate: number; billableRate: number;
  }) => void;
}) {
  const [name, setName] = useState("");
  const [title, setTitle] = useState("Field Technician");
  const [phone, setPhone] = useState("");
  const [color, setColor] = useState("#4d8df0");
  const [hourly, setHourly] = useState("250");
  const [billable, setBillable] = useState("850");

  return (
    <SvcModal open={open} onClose={onClose} title="Add technician">
      <div className="space-y-3.5">
        <Field label="Name">
          <TextInput value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Title">
            <TextInput value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field label="Phone">
            <TextInput value={phone} onChange={(e) => setPhone(e.target.value)} />
          </Field>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Cost / hour" hint="What you pay">
            <PesoInput value={hourly} onChange={setHourly} suffix="/hr" placeholder="e.g. 250" />
          </Field>
          <Field label="Charge / hour" hint="What you bill">
            <PesoInput value={billable} onChange={setBillable} suffix="/hr" placeholder="e.g. 600" />
          </Field>
          <Field label="Colour">
            <TextInput type="color" value={color} onChange={(e) => setColor(e.target.value)} className="!p-1 h-[38px]" />
          </Field>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <GhostButton onClick={onClose}>Cancel</GhostButton>
          <PrimaryButton
            pending={pending}
            disabled={!name.trim()}
            onClick={() => {
              onCreate({
                name: name.trim(), title, phone, color,
                hourlyRate: parsePesoInput(hourly) ?? 0,
                billableRate: parsePesoInput(billable) ?? 0,
              });
              onClose();
              setName(""); setPhone("");
            }}
          >
            Add technician
          </PrimaryButton>
        </div>
      </div>
    </SvcModal>
  );
}
