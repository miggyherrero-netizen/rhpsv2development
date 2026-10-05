"use client";

import { CityPicker, type PlaceValue } from "@/components/service-place-picker";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { Plus, Search, Users, Phone, Mail, MapPin, Pencil, Trash2, Archive, Piano as PianoIcon } from "lucide-react";
import { fmtDate } from "@/lib/format";
import {
  CUSTOMER_SOURCES, CUSTOMER_SOURCE_LABEL, PIANO_TYPES, EXPENSE_CATEGORIES,
} from "@/lib/service";
import { isBatchCustomer, withCustomerType } from "@/lib/service-reports";
import { customerRowSummary, dueLabel, dueSortKey, telHref, type CustomerRowSummary } from "@/lib/service-customer-list";
import { parsePesoInput } from "@/lib/service-flow";
import type { CustomerCard, RecallRow } from "@/server/service-data";
import {
  createCustomer, updateCustomer, archiveCustomer, createLocation, deleteLocation,
  createPiano, updatePiano, deletePiano,
} from "@/server/service";
import {
  Chip, ConfirmDialog, EmptyState, PesoInput, ErrorLine, Field, FilterPills, GhostButton, Money,
  PrimaryButton, SectionCard, Select, StatCard, SvcModal, TextArea, TextInput, TONE_TEXT,
} from "@/components/service-ui";

export default function CustomersClient({
  customers,
  recalls,
}: {
  customers: CustomerCard[];
  recalls: RecallRow[];
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("active");
  const [sort, setSort] = useState<"name" | "due" | "owes" | "billed" | "recent">("name");
  // One "now" for the whole list so every row measures overdue against the same moment.
  const [now] = useState(() => new Date());
  const [newOpen, setNewOpen] = useState(false);

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (res && !res.ok) setError(res.error ?? "Something went wrong.");
    });
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const when = (c: CustomerCard) => (c.lastServiceAt ? new Date(c.lastServiceAt).getTime() : -Infinity);
    const rows = customers
      .filter((c) => {
        if (filter === "archived") return !!c.archivedAt;
        if (c.archivedAt) return false;
        // Trips / batches are groups of visits, not clients — they get their own list.
        return filter === "batch" ? isBatchCustomer(c.tags, c.name) : !isBatchCustomer(c.tags, c.name);
      })
      .filter((c) => !q || [c.name, c.company ?? "", c.phone ?? "", c.email ?? ""].join(" ").toLowerCase().includes(q))
      .map((c) => ({ c, sum: customerRowSummary(c, now) }));
    const byName = (a: { c: CustomerCard }, b: { c: CustomerCard }) => a.c.name.localeCompare(b.c.name);
    return rows.sort((a, b) =>
      sort === "billed" ? b.c.billedCents - a.c.billedCents || byName(a, b)
      : sort === "owes" ? b.c.outstandingCents - a.c.outstandingCents || byName(a, b)
      : sort === "due" ? dueSortKey(a.sum) - dueSortKey(b.sum) || byName(a, b)
      : sort === "recent" ? when(b.c) - when(a.c) || byName(a, b)
      : byName(a, b));
  }, [customers, query, filter, sort, now]);

  const totals = useMemo(
    () => ({
      clients: customers.filter((c) => !c.archivedAt && !isBatchCustomer(c.tags, c.name)).length,
      batches: customers.filter((c) => !c.archivedAt && isBatchCustomer(c.tags, c.name)).length,
      pianos: customers.reduce((s, c) => s + c.pianos.length, 0),
      billed: customers.reduce((s, c) => s + c.billedCents, 0),
      outstanding: customers.reduce((s, c) => s + c.outstandingCents, 0),
    }),
    [customers],
  );

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-6 lg:py-8 max-w-[1400px] mx-auto space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[11px] uppercase tracking-[0.2em]" style={{ color: "var(--color-svc-text-faint)" }}>
            Home Service
          </p>
          <h1 className="font-serif text-3xl mt-1" style={{ color: "var(--color-svc-text)" }}>
            Customers
          </h1>
          <p className="text-[12.5px] mt-1" style={{ color: "var(--color-svc-text-dim)" }}>
            {totals.clients} clients{totals.batches > 0 ? ` · ${totals.batches} trip${totals.batches === 1 ? "" : "s"} / batch${totals.batches === 1 ? "" : "es"}` : ""} · {totals.pianos} instruments · {recalls.length} due for service
          </p>
        </div>
        <PrimaryButton onClick={() => setNewOpen(true)}>
          <Plus size={15} /> New customer
        </PrimaryButton>
      </header>

      <ErrorLine>{error}</ErrorLine>

      <div className="svc-tiles">
        <StatCard label="Clients" value={totals.clients} icon={<Users size={15} />} />
        <StatCard label="Instruments" value={totals.pianos} tone="azure" icon={<PianoIcon size={15} />} />
        <StatCard label="Lifetime billed" value={<Money cents={totals.billed} />} tone="violet" />
        <StatCard
          label="Outstanding"
          value={<Money cents={totals.outstanding} />}
          tone={totals.outstanding > 0 ? "warn" : "slate"}
        />
      </div>

      {recalls.length > 0 && (
        <SectionCard title="Due for service">
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
            {recalls.map((r) => (
              <div key={r.pianoId} className="px-5 py-3.5" style={{ background: "var(--color-svc-surface)", boxShadow: "0 0 0 0.5px var(--color-svc-border)" }}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[13.5px] truncate" style={{ color: "var(--color-svc-text)" }}>
                      {r.customerName}
                    </p>
                    <p className="text-[11.5px] truncate" style={{ color: "var(--color-svc-text-faint)" }}>
                      {r.pianoLabel} · {r.area ?? r.addressLine ?? "—"}
                    </p>
                  </div>
                  <Chip tone={r.daysUntilDue < 0 ? "danger" : r.daysUntilDue <= 14 ? "warn" : "slate"}>
                    {r.daysUntilDue < 0 ? `${Math.abs(r.daysUntilDue)}d overdue` : `in ${r.daysUntilDue}d`}
                  </Chip>
                </div>
                <div className="flex items-center justify-between gap-2 mt-2">
                  <span className="text-[11.5px]" style={{ color: "var(--color-svc-text-faint)" }}>
                    Due {fmtDate(new Date(r.nextServiceDueAt))}
                  </span>
                  <Link
                    href={`/service/jobs?new=1`}
                    className="text-[11.5px] hover:underline"
                    style={{ color: TONE_TEXT.azure }}
                  >
                    Book visit
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <FilterPills
          options={[
            { key: "active", label: "Clients" },
            ...(totals.batches > 0 || filter === "batch" ? [{ key: "batch", label: "Trips / batches" }] : []),
            { key: "archived", label: "Archived" },
          ]}
          value={filter}
          onChange={setFilter}
        />
        <div className="flex-1" />
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--color-svc-text-faint)" }} />
          <TextInput
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, phone…"
            aria-label="Search customers"
            className="!pl-9 w-64"
          />
        </div>
        <Select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label="Sort customers" className="!w-auto">
          <option value="name">Sort: Name A–Z</option>
          <option value="due">Sort: Due soonest</option>
          <option value="owes">Sort: Owes most</option>
          <option value="billed">Sort: Most billed</option>
          <option value="recent">Sort: Latest service</option>
        </Select>
      </div>

      {filtered.length === 0 ? (
        <SectionCard>
          <EmptyState
            icon={<Users size={19} strokeWidth={1.7} />}
            title="No customers yet"
            hint="Add the households, schools, and chapels you service."
            action={
              <PrimaryButton onClick={() => setNewOpen(true)}>
                <Plus size={15} /> New customer
              </PrimaryButton>
            }
          />
        </SectionCard>
      ) : (
        <CustomerList rows={filtered} />
      )}

      <NewCustomerModal open={newOpen} onClose={() => setNewOpen(false)} pending={pending} onCreate={(i) => run(() => createCustomer(i))} />

    </div>
  );
}

/* ---- The list: one line per customer on wide screens, a compact card on narrow ones ---- */

const ROW_COLS = "minmax(0,2.4fr) minmax(0,1.2fr) minmax(0,1.3fr) 7.5rem 9rem 6.5rem";
const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--color-svc-accent)]";

type ListRow = { c: CustomerCard; sum: CustomerRowSummary };

function CustomerList({ rows }: { rows: ListRow[] }) {
  return (
    <div className="@container">
      <div className="card-svc overflow-hidden">
        {/* Column headings — wide screens only; narrow rows label their own values */}
        <div
          className="hidden @min-[56rem]:grid items-center gap-4 px-5 py-2.5 text-[12px]"
          style={{ gridTemplateColumns: ROW_COLS, color: "var(--color-svc-text-faint)", borderBottom: "1px solid var(--color-svc-border)" }}
        >
          <span>Customer</span><span>Area</span><span>Phone</span><span>Last service</span><span>Next due</span><span className="text-right">Owes</span>
        </div>
        <ul>
          {rows.map(({ c, sum }, i) => (
            <CustomerRow key={c.id} c={c} sum={sum} first={i === 0} />
          ))}
        </ul>
      </div>
    </div>
  );
}

function CustomerRow({ c, sum, first }: ListRow & { first: boolean }) {
  const batch = isBatchCustomer(c.tags, c.name);
  const tel = telHref(c.phone);
  const sub = c.company || (batch ? "Trip / batch" : CUSTOMER_SOURCE_LABEL[c.source] ?? c.source);
  const last = c.lastServiceAt ? fmtDate(new Date(c.lastServiceAt)) : null;
  const dueText = dueLabel(sum);
  const dueTone = sum.dueState === "overdue" ? "danger" : sum.dueState === "soon" ? "warn" : "slate";
  const owes = c.outstandingCents > 0;

  const nextDue = sum.nextDueAt ? (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
      <span className="svc-num text-[13px]" style={{ color: "var(--color-svc-text-dim)" }}>{fmtDate(sum.nextDueAt)}</span>
      {dueText && sum.dueState !== "later" ? <Chip tone={dueTone}>{dueText}</Chip> : null}
    </span>
  ) : <Dash />;

  return (
    <li
      className="relative hover:bg-white/[0.03] transition-colors"
      style={first ? undefined : { borderTop: "1px solid var(--color-svc-border)" }}
    >
      {/* Wide: one aligned line */}
      <div className="hidden @min-[56rem]:grid items-center gap-4 px-5 py-3 min-h-[60px]" style={{ gridTemplateColumns: ROW_COLS }}>
        <div className="min-w-0">
          <NameLink c={c} />
          <p className="text-[12px] truncate" style={{ color: "var(--color-svc-text-faint)" }}>
            {sub}{c.openJobCount > 0 ? <span style={{ color: TONE_TEXT.azure }}> · {c.openJobCount} open job{c.openJobCount === 1 ? "" : "s"}</span> : null}
          </p>
        </div>
        <p className="text-[13px] truncate" style={{ color: "var(--color-svc-text-dim)" }}>{sum.area ?? <Dash />}</p>
        <div className="min-w-0">{tel ? <CallLink tel={tel} phone={c.phone!} name={c.name} /> : <Dash />}</div>
        <p className="svc-num text-[13px]" style={{ color: "var(--color-svc-text-dim)" }}>{last ?? <Dash />}</p>
        <div className="text-[13px]">{nextDue}</div>
        <p className="text-right svc-num text-[13px]">{owes ? <Money cents={c.outstandingCents} className="!text-[13px]" /> : <Dash />}</p>
      </div>

      {/* Narrow: name, then area · last service, then what needs attention */}
      <div className="@min-[56rem]:hidden flex items-start gap-3 px-4 py-3">
        <div className="min-w-0 flex-1 space-y-1">
          <NameLink c={c} />
          <p className="text-[12.5px] truncate" style={{ color: "var(--color-svc-text-dim)" }}>
            {[sum.area, last ? `Last service ${last}` : null].filter(Boolean).join(" · ") || sub}
          </p>
          {(sum.nextDueAt || owes || c.openJobCount > 0) ? (
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-0.5 text-[12.5px]">
              {sum.nextDueAt ? (
                <span className="inline-flex items-center gap-1.5" style={{ color: "var(--color-svc-text-dim)" }}>
                  Next due {fmtDate(sum.nextDueAt)}{dueText && sum.dueState !== "later" ? <Chip tone={dueTone}>{dueText}</Chip> : null}
                </span>
              ) : null}
              {owes ? <span className="inline-flex items-center gap-1" style={{ color: TONE_TEXT.warn }}>Owes <Money cents={c.outstandingCents} className="!text-[12.5px]" /></span> : null}
              {c.openJobCount > 0 ? <span style={{ color: TONE_TEXT.azure }}>{c.openJobCount} open job{c.openJobCount === 1 ? "" : "s"}</span> : null}
            </p>
          ) : null}
        </div>
        {tel ? (
          <a
            href={tel}
            aria-label={`Call ${c.name}`}
            className={`relative z-10 shrink-0 inline-flex items-center justify-center w-11 h-11 rounded-full ${FOCUS}`}
            style={{ background: "var(--color-svc-surface-2, rgba(255,255,255,0.05))", color: TONE_TEXT.azure, border: "1px solid var(--color-svc-border)" }}
          >
            <Phone size={16} />
          </a>
        ) : null}
      </div>
    </li>
  );
}

/** The whole row is clickable through this one link (stretched), so the phone link can sit on top of it. */
function NameLink({ c }: { c: CustomerCard }) {
  return (
    <Link
      href={`/service/customers/${c.id}`}
      className={`block text-[14.5px] font-medium truncate after:absolute after:inset-0 after:content-[''] ${FOCUS}`}
      style={{ color: "var(--color-svc-text)" }}
    >
      {c.name}
    </Link>
  );
}

function CallLink({ tel, phone, name }: { tel: string; phone: string; name: string }) {
  return (
    <a
      href={tel}
      aria-label={`Call ${name} at ${phone}`}
      className={`relative z-10 inline-flex items-center gap-1.5 min-h-9 text-[13px] hover:underline ${FOCUS}`}
      style={{ color: TONE_TEXT.azure }}
    >
      <Phone size={12} /> <span className="svc-num truncate">{phone}</span>
    </a>
  );
}

/** Empty value: a real dash, hidden from screen readers (the column heading already says what is missing). */
function Dash() {
  return <span aria-hidden="true" style={{ color: "var(--color-svc-text-faint)" }}>—</span>;
}

function NewCustomerModal({
  open,
  onClose,
  pending,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  pending: boolean;
  onCreate: (input: {
    name: string; company: string; phone: string; email: string; source: string; notes: string; tags: string[];
  }) => void;
}) {
  const [kind, setKind] = useState<"client" | "batch">("client");
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [source, setSource] = useState("referral");
  const [notes, setNotes] = useState("");

  const submit = () => {
    if (!name.trim()) return;
    onCreate({ name: name.trim(), company, phone, email, source, notes, tags: withCustomerType([], kind) });
    onClose();
    setName(""); setCompany(""); setPhone(""); setEmail(""); setNotes(""); setKind("client");
  };

  return (
    <SvcModal open={open} onClose={onClose} title="New customer">
      <div className="space-y-3.5">
        <Field label="Type" hint="Use “Trip / batch” for a group of visits (e.g. an out-of-town trip), not a person">
          <Select value={kind} onChange={(e) => setKind(e.target.value as "client" | "batch")}>
            <option value="client">Client (person, household, school…)</option>
            <option value="batch">Trip / batch</option>
          </Select>
        </Field>
        <Field label="Name" hint="Saved in Title Case">
          <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder={kind === "batch" ? "Gensan Trip — Nov" : "Maria Santos"} autoFocus />
        </Field>
        <Field label="Company / institution" hint="Optional — schools, chapels, hotels">
          <TextInput value={company} onChange={(e) => setCompany(e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Phone">
            <TextInput value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0917 000 0000" />
          </Field>
          <Field label="Email">
            <TextInput type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
        </div>
        <Field label="How they found us">
          <Select value={source} onChange={(e) => setSource(e.target.value)}>
            {CUSTOMER_SOURCES.map((s) => (
              <option key={s.key} value={s.key}>{s.label}</option>
            ))}
          </Select>
        </Field>
        <Field label="Notes">
          <TextArea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <GhostButton onClick={onClose}>Cancel</GhostButton>
          <PrimaryButton pending={pending} disabled={!name.trim()} onClick={submit}>
            Create customer
          </PrimaryButton>
        </div>
      </div>
    </SvcModal>
  );
}

export function CustomerSheet({
  customer,
  onClose,
  pending,
  onSave,
  onArchive,
  onRestore,
  onAddLocation,
  onDeleteLocation,
  onAddPiano,
  onUpdatePiano,
  onDeletePiano,
}: {
  customer: CustomerCard;
  onClose: () => void;
  pending: boolean;
  onSave: (patch: {
    name: string; company: string; phone: string; email: string; source: string; notes: string; tags: string[];
  }) => void;
  onArchive: () => void;
  onRestore: () => void;
  onAddLocation: (input: {
    label: string; addressLine: string; city: string; area: string; accessNotes: string;
    travelMinutes: number; travelFee: number; cityCode?: string | null; barangayCode?: string | null;
  }) => void;
  onDeleteLocation: (id: string) => void;
  onAddPiano: (input: {
    brand: string; model: string; type: string; serialNumber: string;
    locationId: string; tuningIntervalMonths: number; conditionNotes: string;
  }) => void;
  onUpdatePiano: (id: string, patch: { tuningIntervalMonths?: number; lastServiceAt?: string | null; nextServiceDueAt?: string | null }) => void;
  onDeletePiano: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(customer.name);
  const [kind, setKind] = useState<"client" | "batch">(isBatchCustomer(customer.tags, customer.name) ? "batch" : "client");
  const [company, setCompany] = useState(customer.company ?? "");
  const [phone, setPhone] = useState(customer.phone ?? "");
  const [email, setEmail] = useState(customer.email ?? "");
  const [source, setSource] = useState(customer.source);
  const [notes, setNotes] = useState(customer.notes ?? "");

  const [locOpen, setLocOpen] = useState(false);
  const [pianoOpen, setPianoOpen] = useState(false);

  return (
    <SvcModal open onClose={onClose} title={customer.name} subtitle={`${customer.jobCount} jobs · billed ${""}`} wide>
      <div className="space-y-5">
        {/* Contact */}
        <div>
          {editing ? (
            <div className="space-y-3">
              <Field label="Type">
                <Select value={kind} onChange={(e) => setKind(e.target.value as "client" | "batch")}>
                  <option value="client">Client</option>
                  <option value="batch">Trip / batch</option>
                </Select>
              </Field>
              <Field label="Name">
                <TextInput value={name} onChange={(e) => setName(e.target.value)} />
              </Field>
              <Field label="Company">
                <TextInput value={company} onChange={(e) => setCompany(e.target.value)} />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Phone">
                  <TextInput value={phone} onChange={(e) => setPhone(e.target.value)} />
                </Field>
                <Field label="Email">
                  <TextInput value={email} onChange={(e) => setEmail(e.target.value)} />
                </Field>
              </div>
              <Field label="Source">
                <Select value={source} onChange={(e) => setSource(e.target.value)}>
                  {CUSTOMER_SOURCES.map((s) => (
                    <option key={s.key} value={s.key}>{s.label}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Notes">
                <TextArea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
              </Field>
              <div className="flex gap-2">
                <PrimaryButton
                  pending={pending}
                  onClick={() => {
                    // Keep every existing tag; only the explicit type tag changes.
                    onSave({ name, company, phone, email, source, notes, tags: withCustomerType(customer.tags, kind) });
                    setEditing(false);
                  }}
                >
                  Save
                </PrimaryButton>
                <GhostButton onClick={() => setEditing(false)}>Cancel</GhostButton>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1 text-[12.5px]" style={{ color: "var(--color-svc-text-dim)" }}>
                {customer.company ? <p>{customer.company}</p> : null}
                {customer.phone ? <p>{customer.phone}</p> : null}
                {customer.email ? <p>{customer.email}</p> : null}
                {customer.notes ? (
                  <p style={{ color: "var(--color-svc-text-faint)" }}>{customer.notes}</p>
                ) : null}
                <p className="pt-1" style={{ color: "var(--color-svc-text-faint)" }}>
                  Last service: {customer.lastServiceAt ? fmtDate(new Date(customer.lastServiceAt)) : "—"}
                </p>
              </div>
              <div className="flex gap-2">
                <GhostButton onClick={() => setEditing(true)} className="inline-flex items-center gap-1.5">
                  <Pencil size={13} /> Edit
                </GhostButton>
                {customer.archivedAt ? (
                  <GhostButton onClick={onRestore}>Restore</GhostButton>
                ) : (
                  <GhostButton onClick={onArchive} className="inline-flex items-center gap-1.5">
                    <Archive size={13} /> Archive
                  </GhostButton>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Locations */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-[12px] uppercase tracking-[0.16em]" style={{ color: "var(--color-svc-text-faint)" }}>
              Locations
            </h4>
            <GhostButton onClick={() => setLocOpen(true)} className="!text-[11.5px] inline-flex items-center gap-1">
              <Plus size={12} /> Add
            </GhostButton>
          </div>
          <div className="space-y-2">
            {customer.locations.length === 0 ? (
              <p className="text-[12px]" style={{ color: "var(--color-svc-text-faint)" }}>No addresses yet.</p>
            ) : (
              customer.locations.map((l) => (
                <div
                  key={l.id}
                  className="flex items-start justify-between gap-3 px-3.5 py-2.5 rounded-xl"
                  style={{ background: "var(--color-svc-surface-2)" }}
                >
                  <div className="min-w-0">
                    <p className="text-[12.5px]" style={{ color: "var(--color-svc-text)" }}>
                      {l.label} · {l.addressLine}, {l.city}
                    </p>
                    <p className="text-[11px] mt-0.5" style={{ color: "var(--color-svc-text-faint)" }}>
                      {l.area ? `${l.area} · ` : ""}{l.travelMinutes}m travel · {l.travelFeeCents / 100} fee
                      {l.accessNotes ? ` · ${l.accessNotes}` : ""}
                    </p>
                  </div>
                  <button
                    onClick={() => onDeleteLocation(l.id)}
                    className="inline-flex items-center justify-center min-w-11 min-h-11 rounded-lg hover:bg-white/[0.06]"
                    style={{ color: "var(--color-svc-text-faint)" }}
                    aria-label="Delete location"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Pianos */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-[12px] uppercase tracking-[0.16em]" style={{ color: "var(--color-svc-text-faint)" }}>
              Instruments
            </h4>
            <GhostButton onClick={() => setPianoOpen(true)} className="!text-[11.5px] inline-flex items-center gap-1">
              <Plus size={12} /> Add
            </GhostButton>
          </div>
          <div className="space-y-2">
            {customer.pianos.length === 0 ? (
              <p className="text-[12px]" style={{ color: "var(--color-svc-text-faint)" }}>No instruments recorded.</p>
            ) : (
              customer.pianos.map((p) => (
                <div
                  key={p.id}
                  className="px-3.5 py-2.5 rounded-xl"
                  style={{ background: "var(--color-svc-surface-2)" }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[12.5px]" style={{ color: "var(--color-svc-text)" }}>
                        {[p.brand, p.model].filter(Boolean).join(" ") || p.type}
                        <span style={{ color: "var(--color-svc-text-faint)" }}> · {p.type}</span>
                        {p.year ? <span style={{ color: "var(--color-svc-text-faint)" }}> · {p.year}</span> : null}
                      </p>
                      <p className="text-[11px] mt-0.5" style={{ color: "var(--color-svc-text-faint)" }}>
                        {p.locationLabel ? `${p.locationLabel} · ` : ""}
                        every {p.tuningIntervalMonths} months ·
                        {p.nextServiceDueAt ? ` next due ${fmtDate(new Date(p.nextServiceDueAt))}` : " no due date set"}
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        min={1}
                        max={24}
                        defaultValue={p.tuningIntervalMonths}
                        onBlur={(e) => {
                          const months = Number(e.target.value);
                          if (months > 0 && months !== p.tuningIntervalMonths) onUpdatePiano(p.id, { tuningIntervalMonths: months });
                        }}
                        className="input-svc !w-16 !py-1 !px-2 text-[11.5px]"
                        title="Tuning interval (months)"
                      />
                      <button
                        onClick={() => onDeletePiano(p.id)}
                        className="inline-flex items-center justify-center min-w-11 min-h-11 rounded-lg hover:bg-white/[0.06]"
                        style={{ color: "var(--color-svc-text-faint)" }}
                        aria-label="Delete instrument"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <AddLocationModal
        open={locOpen}
        onClose={() => setLocOpen(false)}
        pending={pending}
        onCreate={(input) => {
          onAddLocation(input);
          setLocOpen(false);
        }}
      />
      <AddPianoModal
        open={pianoOpen}
        onClose={() => setPianoOpen(false)}
        locations={customer.locations.map((l) => ({ id: l.id, label: l.label }))}
        pending={pending}
        onCreate={(input) => {
          onAddPiano(input);
          setPianoOpen(false);
        }}
      />
    </SvcModal>
  );
}

function AddLocationModal({
  open,
  onClose,
  pending,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  pending: boolean;
  onCreate: (input: {
    label: string; addressLine: string; city: string; area: string; accessNotes: string;
    travelMinutes: number; travelFee: number; cityCode?: string | null; barangayCode?: string | null;
  }) => void;
}) {
  const [place, setPlace] = useState<PlaceValue>({ cityCode: null, barangayCode: null });
  const [label, setLabel] = useState("Residence");
  const [addressLine, setAddressLine] = useState("");
  const [city, setCity] = useState("Davao City");
  const [area, setArea] = useState("");
  const [accessNotes, setAccessNotes] = useState("");
  const [travelMinutes, setTravelMinutes] = useState("20");
  const [travelFee, setTravelFee] = useState("0");

  return (
    <SvcModal open={open} onClose={onClose} title="Add location">
      <div className="space-y-3.5">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Label">
            <TextInput value={label} onChange={(e) => setLabel(e.target.value)} />
          </Field>
          <Field label="Area / zone">
            <TextInput value={area} onChange={(e) => setArea(e.target.value)} placeholder="Matina" />
          </Field>
        </div>
        <Field label="Address">
          <TextInput value={addressLine} onChange={(e) => setAddressLine(e.target.value)} placeholder="14 Palm Drive" />
        </Field>
        <CityPicker value={place} onChange={(v, hit) => { setPlace(v); if (hit) setCity(hit.name); }} />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Travel (minutes)">
            <TextInput type="number" min={0} value={travelMinutes} onChange={(e) => setTravelMinutes(e.target.value)} />
          </Field>
          <Field label="Travel fee" hint="Pesos">
            <PesoInput value={travelFee} onChange={setTravelFee} placeholder="e.g. 300" />
          </Field>
        </div>
        <Field label="Access notes" hint="Gate code, stairs, parking">
          <TextInput value={accessNotes} onChange={(e) => setAccessNotes(e.target.value)} />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <GhostButton onClick={onClose}>Cancel</GhostButton>
          <PrimaryButton
            pending={pending}
            disabled={!addressLine.trim()}
            onClick={() =>
              onCreate({
                label, addressLine, city, area, accessNotes, cityCode: place.cityCode, barangayCode: place.barangayCode,
                travelMinutes: Number(travelMinutes) || 0,
                travelFee: parsePesoInput(travelFee) ?? 0,
              })
            }
          >
            Add location
          </PrimaryButton>
        </div>
      </div>
    </SvcModal>
  );
}

function AddPianoModal({
  open,
  onClose,
  locations,
  pending,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  locations: { id: string; label: string }[];
  pending: boolean;
  onCreate: (input: {
    brand: string; model: string; type: string; serialNumber: string;
    locationId: string; tuningIntervalMonths: number; conditionNotes: string;
  }) => void;
}) {
  const [brand, setBrand] = useState("");
  const [model, setModel] = useState("");
  const [type, setType] = useState("Upright");
  const [serial, setSerial] = useState("");
  const [locationId, setLocationId] = useState(locations[0]?.id ?? "");
  const [interval, setInterval] = useState("6");
  const [condition, setCondition] = useState("");

  return (
    <SvcModal open={open} onClose={onClose} title="Add instrument">
      <div className="space-y-3.5">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Brand">
            <TextInput value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="Yamaha" />
          </Field>
          <Field label="Model">
            <TextInput value={model} onChange={(e) => setModel(e.target.value)} placeholder="U1" />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Type">
            <Select value={type} onChange={(e) => setType(e.target.value)}>
              {PIANO_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </Select>
          </Field>
          <Field label="Serial">
            <TextInput value={serial} onChange={(e) => setSerial(e.target.value)} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Located at">
            <Select value={locationId} onChange={(e) => setLocationId(e.target.value)}>
              <option value="">Not set</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>{l.label}</option>
              ))}
            </Select>
          </Field>
          <Field label="Tuning interval" hint="Months">
            <TextInput type="number" min={1} value={interval} onChange={(e) => setInterval(e.target.value)} />
          </Field>
        </div>
        <Field label="Condition notes">
          <TextArea rows={2} value={condition} onChange={(e) => setCondition(e.target.value)} />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <GhostButton onClick={onClose}>Cancel</GhostButton>
          <PrimaryButton
            pending={pending}
            disabled={!brand.trim()}
            onClick={() =>
              onCreate({
                brand, model, type, serialNumber: serial, locationId,
                tuningIntervalMonths: Number(interval) || 6,
                conditionNotes: condition,
              })
            }
          >
            Add instrument
          </PrimaryButton>
        </div>
      </div>
    </SvcModal>
  );
}
