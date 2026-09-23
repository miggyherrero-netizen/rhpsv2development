"use client";

import { useState, useTransition } from "react";
import { Plus, Trash2, Users, Tags, Building2, CalendarClock, Database } from "lucide-react";
import { peso } from "@/lib/format";
import { DAYS_SHORT } from "@/lib/config";
import { ITEM_KINDS } from "@/lib/service";
import type { ServiceSettings } from "@/server/service-data";
import type { ServiceCatalogItem, ServiceTechnician } from "@/db/schema";
import {
  updateSettings, createTechnician, updateTechnician, deleteTechnician,
  createCatalogItem, updateCatalogItem, deleteCatalogItem, seedServiceDemo,
} from "@/server/service";
import {
  Chip, ConfirmDialog, EmptyState, ErrorLine, Field, GhostButton, Money, PrimaryButton,
  SectionCard, Select, SuccessLine, SvcModal, TextInput, TONE_TEXT,
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
}: {
  settings: ServiceSettings;
  technicians: ServiceTechnician[];
  catalog: ServiceCatalogItem[];
  hasData: boolean;
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

  const [newItem, setNewItem] = useState({ name: "", kind: "service", price: "", minutes: "60" });

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
      });
      if (res.ok) setSaved(true);
      return res;
    });
  };

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-6 lg:py-8 max-w-[1100px] mx-auto space-y-6">
      <header>
        <p className="text-[10px] uppercase tracking-[0.3em]" style={{ color: "var(--color-svc-text-faint)" }}>
          Home Service
        </p>
        <h1 className="font-serif text-3xl mt-1" style={{ color: "var(--color-svc-text)" }}>
          Settings
        </h1>
        <p className="text-[12.5px] mt-1" style={{ color: "var(--color-svc-text-dim)" }}>
          Numbering, tax, crew rates, and the price book used on every visit
        </p>
      </header>

      <ErrorLine>{error}</ErrorLine>
      <SuccessLine>{saved ? "Settings saved." : null}</SuccessLine>

      {/* Business + invoicing */}
      <SectionCard title="Business & invoicing" className="overflow-hidden">
        <div className="px-5 py-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Business name">
            <TextInput value={businessName} onChange={(e) => setBusinessName(e.target.value)} />
          </Field>
          <Field label="Tax label" hint="Shown on invoices">
            <TextInput value={taxLabel} onChange={(e) => setTaxLabel(e.target.value)} />
          </Field>
          <Field label="Invoice prefix">
            <TextInput value={invoicePrefix} onChange={(e) => setInvoicePrefix(e.target.value.toUpperCase())} />
          </Field>
          <Field label="Job prefix">
            <TextInput value={jobPrefix} onChange={(e) => setJobPrefix(e.target.value.toUpperCase())} />
          </Field>
          <Field label="Tax rate" hint="Percent (12 = Philippine VAT)">
            <TextInput type="number" min={0} step="1" value={taxRate} onChange={(e) => setTaxRate(e.target.value)} />
          </Field>
          <Field label="Payment terms" hint="Days">
            <TextInput type="number" min={0} value={terms} onChange={(e) => setTerms(e.target.value)} />
          </Field>
          <Field label="Default crew rate" hint="Pesos / hour">
            <TextInput type="number" min={0} step="50" value={hourly} onChange={(e) => setHourly(e.target.value)} />
          </Field>
          <Field label="Default travel fee" hint="Pesos">
            <TextInput type="number" min={0} step="50" value={travelFee} onChange={(e) => setTravelFee(e.target.value)} />
          </Field>
          <Field label="Tuning interval" hint="Months between recalls">
            <TextInput type="number" min={1} value={interval} onChange={(e) => setInterval(e.target.value)} />
          </Field>
          <Field label="Recall lead time" hint="Days ahead to warn">
            <TextInput type="number" min={0} value={lead} onChange={(e) => setLead(e.target.value)} />
          </Field>
        </div>

        <div className="px-5 py-4" style={{ borderTop: "1px solid var(--color-svc-border)" }}>
          <p className="text-[10.5px] uppercase tracking-[0.16em] mb-3 flex items-center gap-1.5" style={{ color: "var(--color-svc-text-faint)" }}>
            <CalendarClock size={12} /> Dispatch hours
          </p>
          <div className="space-y-2">
            {DAYS_SHORT.map((day, index) => {
              const value = hours[index] ?? null;
              const open = !!value;
              return (
                <div key={day} className="flex items-center gap-3">
                  <span className="w-10 text-[12px]" style={{ color: "var(--color-svc-text-dim)" }}>{day}</span>
                  <label className="inline-flex items-center gap-2 text-[12px]" style={{ color: "var(--color-svc-text-dim)" }}>
                    <input
                      type="checkbox"
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
                        value={minToTime(value[0])}
                        onChange={(e) =>
                          setHours((prev) => ({ ...prev, [index]: [timeToMin(e.target.value), value[1]] }))
                        }
                        className="!w-32"
                      />
                      <span style={{ color: "var(--color-svc-text-faint)" }}>to</span>
                      <TextInput
                        type="time"
                        value={minToTime(value[1])}
                        onChange={(e) =>
                          setHours((prev) => ({ ...prev, [index]: [value[0], timeToMin(e.target.value)] }))
                        }
                        className="!w-32"
                      />
                    </>
                  ) : (
                    <span className="text-[11.5px]" style={{ color: "var(--color-svc-text-faint)" }}>Closed</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div
          className="px-5 py-3 flex justify-end"
          style={{ borderTop: "1px solid var(--color-svc-border)" }}
        >
          <PrimaryButton pending={pending} onClick={saveBusiness}>
            <Building2 size={14} /> Save settings
          </PrimaryButton>
        </div>
      </SectionCard>

      {/* Crew */}
      <SectionCard
        title="Field crew"
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
                  <p className="text-[13.5px]" style={{ color: "var(--color-svc-text)" }}>{t.name}</p>
                  <p className="text-[11.5px]" style={{ color: "var(--color-svc-text-faint)" }}>
                    {t.title}
                    {t.phone ? ` · ${t.phone}` : ""}
                  </p>
                </div>
                <label className="text-[11.5px] inline-flex items-center gap-1.5" style={{ color: "var(--color-svc-text-dim)" }}>
                  Cost
                  <input
                    type="number"
                    step="50"
                    defaultValue={t.hourlyRateCents / 100}
                    onBlur={(e) => run(() => updateTechnician(t.id, { hourlyRate: Number(e.target.value) }))}
                    className="input-svc !w-24 !py-1 !px-2 text-[12px]"
                  />
                </label>
                <label className="text-[11.5px] inline-flex items-center gap-1.5" style={{ color: "var(--color-svc-text-dim)" }}>
                  Charge
                  <input
                    type="number"
                    step="50"
                    defaultValue={t.billableRateCents / 100}
                    onBlur={(e) => run(() => updateTechnician(t.id, { billableRate: Number(e.target.value) }))}
                    className="input-svc !w-24 !py-1 !px-2 text-[12px]"
                  />
                </label>
                <button
                  onClick={() => run(() => updateTechnician(t.id, { active: !t.active }))}
                  className="text-[11.5px]"
                >
                  {t.active ? <Chip tone="success">active</Chip> : <Chip tone="slate">inactive</Chip>}
                </button>
                <button
                  onClick={() => setDeleteId(t.id)}
                  className="p-1.5 rounded-lg hover:bg-white/[0.06]"
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
      <SectionCard title="Price book">
        <div className="px-5 py-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_130px_120px_90px_auto] gap-2 items-end">
            <Field label="Item name">
              <TextInput
                value={newItem.name}
                onChange={(e) => setNewItem((s) => ({ ...s, name: e.target.value }))}
                placeholder="Concert tuning"
              />
            </Field>
            <Field label="Type">
              <Select value={newItem.kind} onChange={(e) => setNewItem((s) => ({ ...s, kind: e.target.value }))}>
                {ITEM_KINDS.map((k) => (
                  <option key={k.key} value={k.key}>{k.label}</option>
                ))}
              </Select>
            </Field>
            <Field label="Price">
              <TextInput
                type="number"
                step="50"
                value={newItem.price}
                onChange={(e) => setNewItem((s) => ({ ...s, price: e.target.value }))}
                placeholder="2500"
              />
            </Field>
            <Field label="Minutes">
              <TextInput
                type="number"
                step="15"
                value={newItem.minutes}
                onChange={(e) => setNewItem((s) => ({ ...s, minutes: e.target.value }))}
              />
            </Field>
            <PrimaryButton
              pending={pending}
              disabled={!newItem.name.trim()}
              onClick={() => {
                run(() =>
                  createCatalogItem({
                    name: newItem.name.trim(),
                    kind: newItem.kind,
                    unitPrice: Number(newItem.price) || 0,
                    estimatedMinutes: Number(newItem.minutes) || 60,
                  }),
                );
                setNewItem({ name: "", kind: "service", price: "", minutes: "60" });
              }}
            >
              <Plus size={14} /> Add
            </PrimaryButton>
          </div>

          {catalog.length === 0 ? (
            <EmptyState
              icon={<Tags size={19} strokeWidth={1.7} />}
              title="Price book is empty"
              hint="Save your standard services and parts so quoting a visit takes seconds."
            />
          ) : (
            <div className="overflow-x-auto thin-scroll pt-2">
              <table className="w-full text-left">
                <thead>
                  <tr style={{ color: "var(--color-svc-text-faint)" }}>
                    {["Item", "Type", "Price", "Minutes", ""].map((h) => (
                      <th key={h} className="py-2 text-[10px] uppercase tracking-[0.16em] font-normal">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="svc-divide">
                  {catalog.map((item) => (
                    <tr key={item.id} className="group">
                      <td className="py-2 pr-4">
                        <input
                          defaultValue={item.name}
                          onBlur={(e) => {
                            if (e.target.value !== item.name) run(() => updateCatalogItem(item.id, { name: e.target.value }));
                          }}
                          className="input-svc !py-1 !px-2 text-[12.5px]"
                        />
                      </td>
                      <td className="py-2 pr-4">
                        <Select
                          defaultValue={item.kind}
                          onChange={(e) => run(() => updateCatalogItem(item.id, { kind: e.target.value }))}
                          className="!py-1 !px-2 text-[12px] !w-auto"
                        >
                          {ITEM_KINDS.map((k) => (
                            <option key={k.key} value={k.key}>{k.label}</option>
                          ))}
                        </Select>
                      </td>
                      <td className="py-2 pr-4">
                        <input
                          type="number"
                          step="50"
                          defaultValue={item.unitPriceCents / 100}
                          onBlur={(e) => run(() => updateCatalogItem(item.id, { unitPrice: Number(e.target.value) }))}
                          className="input-svc !w-28 !py-1 !px-2 text-[12px]"
                        />
                      </td>
                      <td className="py-2 pr-4">
                        <input
                          type="number"
                          step="15"
                          defaultValue={item.estimatedMinutes}
                          onBlur={(e) => run(() => updateCatalogItem(item.id, { estimatedMinutes: Number(e.target.value) }))}
                          className="input-svc !w-20 !py-1 !px-2 text-[12px]"
                        />
                      </td>
                      <td className="py-2 text-right">
                        <button
                          onClick={() => run(() => deleteCatalogItem(item.id))}
                          className="p-1.5 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-white/[0.06]"
                          style={{ color: "var(--color-svc-text-faint)" }}
                          aria-label="Delete item"
                        >
                          <Trash2 size={13} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </SectionCard>

      {/* Demo data */}
      <SectionCard title="Sample data">
        <div className="px-5 py-4 flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-[13px]" style={{ color: "var(--color-svc-text)" }}>
              {hasData ? "Your workspace already has data" : "Load a realistic sample dataset"}
            </p>
            <p className="text-[11.5px] mt-0.5" style={{ color: "var(--color-svc-text-faint)" }}>
              {hasData
                ? "The demo seed is disabled so your real records stay untouched."
                : "Four customers, two technicians, a price book, jobs, time logs, and expenses."}
            </p>
          </div>
          <GhostButton
            disabled={pending || hasData}
            onClick={() => run(() => seedServiceDemo())}
            className="inline-flex items-center gap-1.5"
          >
            <Database size={14} /> Load sample data
          </GhostButton>
        </div>
      </SectionCard>

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
          <Field label="Cost / hour" hint="Pesos">
            <TextInput type="number" step="50" value={hourly} onChange={(e) => setHourly(e.target.value)} />
          </Field>
          <Field label="Charge / hour" hint="Pesos">
            <TextInput type="number" step="50" value={billable} onChange={(e) => setBillable(e.target.value)} />
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
                hourlyRate: Number(hourly) || 0,
                billableRate: Number(billable) || 0,
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
