"use client";

import { useMemo, useState, useTransition } from "react";
import { Info, Plus, Tags, Trash2 } from "lucide-react";
import { ITEM_KINDS } from "@/lib/service";
import { parsePesoInput } from "@/lib/service-flow";
import { includesLine, parseIncludes } from "@/lib/service-lines";
import type { ServiceCatalogItem } from "@/db/schema";
import { createCatalogItem, deleteCatalogItem, updateCatalogItem } from "@/server/service";
import { Chip, EmptyState, ErrorLine, Field, PesoInput, PrimaryButton, SectionCard, Select, TextArea, TextInput, UnitInput } from "@/components/service-ui";

const DIM = { color: "var(--color-svc-text-dim)" } as const;
const FAINT = { color: "var(--color-svc-text-faint)" } as const;

/** Package first (the one people ask about), then the line types. */
const KIND_OPTIONS = [{ key: "package", label: "Package" }, ...ITEM_KINDS.map((k) => ({ key: k.key, label: k.label }))];
const KIND_LABEL = Object.fromEntries(KIND_OPTIONS.map((k) => [k.key, k.label])) as Record<string, string>;
const GROUP_TITLE: Record<string, string> = { package: "Packages", service: "Services", part: "Parts", fee: "Fees", discount: "Discounts" };

const DETAILS_HINT = "Printed under the name on the quote and invoice, e.g. Brass pedal rod and felt";
const INCLUDES_HINT = "One item per line. Printed under the package name as “Includes: …”. The items inside need no price of their own.";

/**
 * The price book: your standard services, parts and packages. A package is sold for ONE price; the list of what it
 * includes is just words that print under its name — so setting one up is: name it, price it, list what is in it.
 */
export default function PriceBook({ catalog }: { catalog: ServiceCatalogItem[] }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (res && !res.ok) setError(res.error ?? "Something went wrong.");
    });
  };

  const plainItems = useMemo(() => catalog.filter((c) => c.kind !== "package" && c.active), [catalog]);
  const groups = useMemo(
    () => KIND_OPTIONS.map((k) => ({ ...k, items: catalog.filter((c) => c.kind === k.key) })).filter((g) => g.items.length > 0),
    [catalog],
  );

  return (
    <SectionCard title={<>Price book <span className="font-normal text-[12px]" style={FAINT}>· changes save as you go</span></>}>
      <div className="px-5 py-4 space-y-5">
        <p className="text-[14px] max-w-[62ch]" style={DIM}>
          Your standard services, parts and packages. While quoting, type a name and pick it — the price and details fill in.
        </p>

        <NewItemForm pending={pending} plainItems={plainItems} run={run} />
        <ErrorLine>{error}</ErrorLine>

        {catalog.length === 0 ? (
          <EmptyState
            icon={<Tags size={19} strokeWidth={1.7} />}
            title="Price book is empty"
            hint="Save your standard services and parts so quoting a visit takes seconds."
          />
        ) : (
          <div className="space-y-6">
            {groups.map((g) => (
              <section key={g.key} aria-label={GROUP_TITLE[g.key] ?? g.label}>
                <h3 className="text-[14px] font-medium mb-1" style={{ color: "var(--color-svc-text)" }}>
                  {GROUP_TITLE[g.key] ?? g.label} <span className="font-normal" style={FAINT}>· {g.items.length}</span>
                </h3>
                <ul className="svc-divide">
                  {g.items.map((item) => (
                    <ItemRow key={item.id} item={item} catalog={catalog} plainItems={plainItems} run={run} />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>
    </SectionCard>
  );
}

/* ---------------------------------------------------------------- add form */

function NewItemForm({
  pending, plainItems, run,
}: {
  pending: boolean;
  plainItems: ServiceCatalogItem[];
  run: (fn: () => Promise<{ ok: boolean; error?: string }>) => void;
}) {
  const [item, setItem] = useState({ name: "", kind: "service", price: "", minutes: "60", details: "" });
  const isPackage = item.kind === "package";
  const set = (patch: Partial<typeof item>) => setItem((s) => ({ ...s, ...patch }));

  const add = () => {
    if (!item.name.trim()) return;
    run(() => createCatalogItem({
      name: item.name.trim(), kind: item.kind, unitPrice: parsePesoInput(item.price) ?? 0,
      estimatedMinutes: Number(item.minutes) || 60,
      description: isPackage ? parseIncludes(item.details).join("\n") : item.details.trim() || null,
    }));
    setItem({ name: "", kind: item.kind, price: "", minutes: "60", details: "" });
  };

  return (
    <div className="rounded-xl p-4 space-y-3" style={{ background: "var(--color-svc-surface-2)", border: "1px solid var(--color-svc-border)" }}>
      <p className="text-[14px] font-medium" style={{ color: "var(--color-svc-text)" }}>Add to the price book</p>
      <div className="grid grid-cols-2 gap-3 min-[900px]:grid-cols-[minmax(0,1fr)_150px_130px_90px_auto] min-[900px]:items-end">
        <Field label="Item name" className="col-span-2 min-[900px]:col-span-1">
          <TextInput value={item.name} onChange={(e) => set({ name: e.target.value })} placeholder={isPackage ? "Basic piano service package" : "Concert tuning"} />
        </Field>
        <Field label="Type">
          <Select value={item.kind} onChange={(e) => set({ kind: e.target.value })}>
            {KIND_OPTIONS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
          </Select>
        </Field>
        <Field label={isPackage ? "Package price" : "Price"}>
          <PesoInput value={item.price} onChange={(v) => set({ price: v })} />
        </Field>
        <Field label="Minutes">
          <TextInput type="number" step="15" value={item.minutes} onChange={(e) => set({ minutes: e.target.value })} />
        </Field>
        <PrimaryButton pending={pending} disabled={!item.name.trim()} onClick={add} className="col-span-2 min-[900px]:col-span-1 !min-h-11">
          <Plus size={14} /> Add
        </PrimaryButton>
      </div>

      {isPackage ? (
        <div className="space-y-2">
          <p className="flex items-start gap-2 text-[13px]" style={DIM}>
            <Info size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
            A package is sold for one price. List what is in it below; it prints under the package name.
          </p>
          <IncludesEditor value={item.details} onChange={(v) => set({ details: v })} options={plainItems} label="What’s included" />
        </div>
      ) : (
        <Field label="Details" hint={DETAILS_HINT}>
          <TextInput value={item.details} maxLength={500} onChange={(e) => set({ details: e.target.value })} placeholder="Optional" />
        </Field>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- includes list */

/** The "what is in this package" list: one item per line, with a picker to add existing price-book items by name. */
function IncludesEditor({
  value, onChange, onCommit, options, label,
}: {
  value: string; onChange: (v: string) => void; onCommit?: (v: string) => void; options: ServiceCatalogItem[]; label: string;
}) {
  const lines = parseIncludes(value);
  const preview = includesLine(lines);
  const addName = (name: string) => {
    if (!name || lines.some((l) => l.toLowerCase() === name.toLowerCase())) return;
    const next = [...lines, name].join("\n");
    onChange(next);
    onCommit?.(next);
  };
  return (
    <div className="space-y-2">
      <Field label={label} hint={INCLUDES_HINT}>
        <TextArea
          rows={Math.min(8, Math.max(3, lines.length + 1))} value={value} maxLength={1_000}
          onChange={(e) => onChange(e.target.value)} onBlur={() => onCommit?.(value)}
          placeholder={"Standard tuning\nAction cleaning\nPedal adjustment"}
        />
      </Field>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {options.length > 0 ? (
          <label className="inline-flex items-center gap-2 text-[13px]" style={DIM}>
            Add from price book
            <Select
              aria-label="Add a price-book item to this list" value="" className="!w-auto !min-h-11 !text-[13px] max-w-56"
              onChange={(e) => { addName(e.target.value); }}
            >
              <option value="">Choose…</option>
              {options.map((o) => <option key={o.id} value={o.name}>{o.name}</option>)}
            </Select>
          </label>
        ) : null}
        {preview ? <p className="text-[13px]" style={FAINT}>Prints as: <span style={DIM}>{preview}</span></p> : null}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- one item */

function ItemRow({
  item, catalog, plainItems, run,
}: {
  item: ServiceCatalogItem;
  catalog: ServiceCatalogItem[];
  plainItems: ServiceCatalogItem[];
  run: (fn: () => Promise<{ ok: boolean; error?: string }>) => void;
}) {
  const isPackage = item.kind === "package";
  const [includes, setIncludes] = useState(item.description ?? "");
  const legacyMembers = isPackage && !parseIncludes(item.description).length ? catalog.filter((c) => c.packageId === item.id && c.active) : [];

  const convertLegacy = () => {
    const names = legacyMembers.map((m) => m.name);
    setIncludes(names.join("\n"));
    run(async () => {
      const first = await updateCatalogItem(item.id, { description: names.join("\n") });
      if (!first.ok) return first;
      // The old "In package" link is no longer used: free the members so each is an ordinary item again.
      for (const m of legacyMembers) await updateCatalogItem(m.id, { packageId: null });
      return { ok: true };
    });
  };

  return (
    <li className="@container py-3">
      <div className="grid grid-cols-2 gap-2 @min-[42rem]:grid-cols-[minmax(0,1fr)_124px_120px_76px_auto_44px] @min-[42rem]:items-center">
        <div className="col-span-2 @min-[42rem]:col-span-1 min-w-0">
          <input
            aria-label="Item name" defaultValue={item.name} maxLength={160}
            onBlur={(e) => { if (e.target.value.trim() && e.target.value !== item.name) run(() => updateCatalogItem(item.id, { name: e.target.value })); }}
            className="input-svc !py-1.5 !px-2.5 text-[14px] font-medium"
          />
        </div>
        <Select
          aria-label={`Type for ${item.name}`} defaultValue={item.kind}
          onChange={(e) => run(() => updateCatalogItem(item.id, { kind: e.target.value }))}
          className="!py-1.5 !px-2 text-[14px]"
        >
          {KIND_OPTIONS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
        </Select>
        <UnitInput
          type="number" prefix="₱" step="50" aria-label={`${isPackage ? "Package price" : "Price"} for ${item.name}`}
          defaultValue={item.unitPriceCents / 100}
          onBlur={(e) => run(() => updateCatalogItem(item.id, { unitPrice: Number(e.target.value) }))}
          className="input-svc !py-1.5 text-[14px]"
        />
        <input
          type="number" step="15" aria-label={`Minutes for ${item.name}`} defaultValue={item.estimatedMinutes}
          onBlur={(e) => run(() => updateCatalogItem(item.id, { estimatedMinutes: Number(e.target.value) }))}
          className="input-svc !py-1.5 !px-2 text-[14px]"
        />
        <label className="inline-flex items-center gap-2 min-h-11 text-[13px] cursor-pointer" style={DIM}>
          <input
            type="checkbox" className="w-5 h-5" defaultChecked={item.isQuickAdd} aria-label={`Quick-add chip for ${item.name}`}
            onChange={(e) => run(() => updateCatalogItem(item.id, { isQuickAdd: e.target.checked }))}
          />
          Quick add
        </label>
        <button
          type="button" onClick={() => run(() => deleteCatalogItem(item.id))} aria-label={`Delete ${item.name}`}
          className="inline-flex items-center justify-center min-w-11 min-h-11 justify-self-end rounded-lg hover:bg-white/[0.06]" style={FAINT}
        >
          <Trash2 size={14} />
        </button>
      </div>

      <div className="mt-2">
        {isPackage ? (
          <div className="space-y-2">
            <IncludesEditor
              value={includes} onChange={setIncludes} options={plainItems.filter((p) => p.id !== item.id)}
              onCommit={(v) => { if (parseIncludes(v).join("\n") !== parseIncludes(item.description).join("\n")) run(() => updateCatalogItem(item.id, { description: parseIncludes(v).join("\n") })); }}
              label="What’s included"
            />
            {legacyMembers.length > 0 ? (
              <div className="rounded-lg px-3 py-2.5 text-[13px] flex flex-wrap items-center gap-x-3 gap-y-1" style={{ background: "var(--color-svc-accent-soft)", color: "var(--color-svc-text)" }}>
                <Chip tone="azure">Old setup</Chip>
                <span>This package still uses the old “In package” links ({legacyMembers.map((m) => m.name).join(", ")}).</span>
                <button type="button" onClick={convertLegacy} className="underline min-h-11" style={{ color: "var(--color-svc-accent-text, var(--color-svc-accent))" }}>
                  Use these as the “What’s included” list
                </button>
              </div>
            ) : null}
          </div>
        ) : (
          <input
            aria-label={`Details for ${item.name}`} key={`${item.id}:${item.description ?? ""}`} defaultValue={item.description ?? ""} maxLength={500}
            placeholder="Details (optional), printed under the name, e.g. Brass pedal rod and felt"
            onBlur={(e) => { if (e.target.value.trim() !== (item.description ?? "")) run(() => updateCatalogItem(item.id, { description: e.target.value.trim() || null })); }}
            className="input-svc !py-1.5 !px-2.5 text-[13px]" style={DIM}
          />
        )}
        <p className="sr-only">{KIND_LABEL[item.kind] ?? item.kind}</p>
      </div>
    </li>
  );
}
