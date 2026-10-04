"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { Plus, Search, ClipboardList, ArrowUpRight, Trash2 } from "lucide-react";
import { fmtDate, fmtTime, toLocalInput } from "@/lib/format";
import {
  JOB_STATUSES, JOB_STATUS_LABEL, JOB_STATUS_TONE, SERVICE_TYPES, SERVICE_TYPE_LABEL,
} from "@/lib/service";
import { hasQuote, jobHeading, needsClosing } from "@/lib/service-reports";
import type { JobRow } from "@/server/service-data";
import { createJob, deleteJob } from "@/server/service";
import {
  Chip, ConfirmDialog, Dot, EmptyState, ErrorLine, Field, FilterPills, GhostButton, Money,
  PrimaryButton, SectionCard, Select, SvcModal, TextInput, TONE_TEXT,
} from "@/components/service-ui";

/** The four filters people use daily; everything else lives under "More". */
const PRIMARY_FILTERS = [
  { key: "open", label: "Open" },
  { key: "scheduled", label: "Scheduled" },
  { key: "completed", label: "Completed" },
  { key: "all", label: "All" },
];
const MORE_FILTERS = [
  { key: "closing", label: "Needs closing" },
  ...JOB_STATUSES.filter((s) => !["scheduled", "completed"].includes(s.key)).map((s) => ({ key: s.key, label: s.label })),
];
const PRIMARY_KEYS = new Set(PRIMARY_FILTERS.map((f) => f.key));
const ALL_FILTER_KEYS = new Set([...PRIMARY_FILTERS, ...MORE_FILTERS].map((f) => f.key));

const OPEN_SET = new Set(["lead", "quoted", "scheduled", "en_route", "in_progress", "on_hold"]);

export default function JobsClient({
  jobs,
  customers,
  technicians,
  initialNew,
  initialFilter = "open",
}: {
  initialFilter?: string;
  jobs: JobRow[];
  customers: { id: string; name: string }[];
  technicians: { id: string; name: string; color: string }[];
  initialNew: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState(() => (ALL_FILTER_KEYS.has(initialFilter) ? initialFilter : "open"));
  const [nowMs] = useState(() => Date.now());
  const [type, setType] = useState("all");
  const [tech, setTech] = useState("all");
  const [query, setQuery] = useState("");
  const [newOpen, setNewOpen] = useState(initialNew);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return jobs.filter((j) => {
      if (status === "open" && !OPEN_SET.has(j.status)) return false;
      if (status === "closing" && !needsClosing(j, new Date(nowMs))) return false;
      if (status !== "open" && status !== "all" && status !== "closing" && j.status !== status) return false;
      if (type !== "all" && j.serviceType !== type) return false;
      if (tech !== "all" && j.technicianId !== tech) return false;
      if (q && ![j.title, j.customerName, j.addressLine ?? "", j.area ?? ""].join(" ").toLowerCase().includes(q))
        return false;
      return true;
    });
  }, [jobs, status, type, tech, query, nowMs]);

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (res && !res.ok) setError(res.error ?? "Something went wrong.");
    });
  };

  const totalQuoted = filtered.reduce((s, j) => s + j.quotedCents, 0);

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-6 lg:py-8 max-w-[1400px] mx-auto space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[11px] uppercase tracking-[0.2em]" style={{ color: "var(--color-svc-text-faint)" }}>
            Home Service
          </p>
          <h1 className="font-serif text-3xl mt-1" style={{ color: "var(--color-svc-text)" }}>
            Jobs
          </h1>
          <p className="text-[12.5px] mt-1" style={{ color: "var(--color-svc-text-dim)" }}>
            {filtered.length} shown · <Money cents={totalQuoted} /> quoted
          </p>
        </div>
        <PrimaryButton onClick={() => setNewOpen(true)}>
          <Plus size={15} /> New job
        </PrimaryButton>
      </header>

      <ErrorLine>{error}</ErrorLine>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <FilterPills options={PRIMARY_FILTERS} value={PRIMARY_KEYS.has(status) ? status : ""} onChange={setStatus} />
          <select
            aria-label="More status filters"
            value={PRIMARY_KEYS.has(status) ? "" : status}
            onChange={(e) => e.target.value && setStatus(e.target.value)}
            className="min-h-10 rounded-full px-3.5 text-[12.5px] border cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-svc-accent)]"
            style={{
              background: PRIMARY_KEYS.has(status) ? "var(--color-svc-surface-2)" : "var(--color-svc-accent-soft)",
              color: PRIMARY_KEYS.has(status) ? "var(--color-svc-text-dim)" : TONE_TEXT.azure,
              borderColor: "var(--color-svc-border)",
            }}
          >
            <option value="" disabled>More ▾</option>
            {MORE_FILTERS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
          </select>
        </div>
        <div className="flex-1" />
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--color-svc-text-faint)" }} />
          <TextInput
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search customer, address…"
            className="!pl-9 w-64"
          />
        </div>
        <Select value={type} onChange={(e) => setType(e.target.value)} aria-label="Filter by job type" className="!w-auto">
          <option value="all">All types</option>
          {SERVICE_TYPES.map((s) => (
            <option key={s.key} value={s.key}>{s.label}</option>
          ))}
        </Select>
        <Select value={tech} onChange={(e) => setTech(e.target.value)} aria-label="Filter by crew" className="!w-auto">
          <option value="all">All crew</option>
          {technicians.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </Select>
      </div>

      <SectionCard>
        {filtered.length === 0 ? (
          <EmptyState
            icon={<ClipboardList size={19} strokeWidth={1.7} />}
            title="No jobs match"
            hint="Adjust the filters or create a job for a customer."
            action={
              <PrimaryButton onClick={() => setNewOpen(true)}>
                <Plus size={15} /> New job
              </PrimaryButton>
            }
          />
        ) : (
          <div className="overflow-x-auto thin-scroll">
            <table className="w-full text-left">
              <thead>
                <tr style={{ color: "var(--color-svc-text-faint)" }}>
                  {["When", "Customer / job", "Crew", "Type", "Status", "Quote", ""].map((h) => (
                    <th
                      key={h}
                      className="px-5 py-2.5 text-[11px] uppercase tracking-[0.08em] font-normal whitespace-nowrap"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="svc-divide">
                {filtered.map((job) => {
                  const h = jobHeading(job.title, job.serviceType);
                  const closing = needsClosing(job, new Date(nowMs));
                  return (
                  <tr key={job.id} className="group transition hover:bg-white/[0.02]">
                    <td className="px-5 py-3 whitespace-nowrap">
                      {job.scheduledStart ? (
                        <>
                          <p className="text-[12.5px] tnum" style={{ color: "var(--color-svc-text)" }}>
                            {fmtDate(new Date(job.scheduledStart))}
                          </p>
                          <p className="text-[11px] tnum" style={{ color: "var(--color-svc-text-faint)" }}>
                            {fmtTime(new Date(job.scheduledStart))}
                          </p>
                        </>
                      ) : (
                        <span className="text-[12px]" style={{ color: "var(--color-svc-text-faint)" }}>
                          Unscheduled
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3 max-w-[320px]">
                      <Link href={`/service/jobs/${job.id}`} className="text-[13.5px] hover:underline" style={{ color: "var(--color-svc-text)" }}>
                        {h.heading}
                      </Link>
                      <p className="text-[12px] truncate" style={{ color: "var(--color-svc-text-dim)" }} title={h.sub ? `${h.sub} — ${job.customerName}` : undefined}>
                        {job.customerName}
                        {job.area ? ` · ${job.area}` : ""}
                        {h.sub ? <span style={{ color: "var(--color-svc-text-faint)" }}> · “{h.sub}”</span> : null}
                      </p>
                    </td>
                    <td className="px-5 py-3 whitespace-nowrap">
                      {job.technicianName ? (
                        <span className="inline-flex items-center gap-1.5 text-[12px]" style={{ color: "var(--color-svc-text-dim)" }}>
                          <Dot color={job.technicianColor ?? "#64748b"} /> {job.technicianName}
                        </span>
                      ) : (
                        <span className="text-[12px]" style={{ color: "var(--color-svc-text-faint)" }}>Unassigned</span>
                      )}
                    </td>
                    <td className="px-5 py-3 whitespace-nowrap text-[12px]" style={{ color: "var(--color-svc-text-dim)" }}>
                      {SERVICE_TYPE_LABEL[job.serviceType] ?? job.serviceType}
                    </td>
                    <td className="px-5 py-3 whitespace-nowrap">
                      <Chip tone={JOB_STATUS_TONE[job.status] ?? "slate"}>
                        {JOB_STATUS_LABEL[job.status] ?? job.status}
                      </Chip>
                      {closing ? <span className="ml-1.5 align-middle"><Chip tone="warn">Needs closing</Chip></span> : null}
                      {job.runningLog ? (
                        <span className="ml-1.5 text-[11px]" style={{ color: "var(--color-svc-warn)" }}>
                          ● live
                        </span>
                      ) : null}
                    </td>
                    <td className="px-5 py-3 whitespace-nowrap">
                      {hasQuote(job.quotedCents)
                        ? <Money cents={job.quotedCents} className="text-[13px]" />
                        : <span className="text-[12.5px]" style={{ color: "var(--color-svc-text-faint)" }}>No quote</span>}
                    </td>
                    <td className="px-5 py-3 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1 opacity-0 group-hover:opacity-100 transition">
                        <button
                          onClick={() => setConfirmId(job.id)}
                          className="p-1.5 rounded-lg hover:bg-white/[0.06]"
                          style={{ color: "var(--color-svc-text-faint)" }}
                          aria-label="Delete job"
                        >
                          <Trash2 size={13} />
                        </button>
                        <Link
                          href={`/service/jobs/${job.id}`}
                          className="p-1.5 rounded-lg hover:bg-white/[0.06]"
                          style={{ color: TONE_TEXT.azure }}
                          aria-label="Open job"
                        >
                          <ArrowUpRight size={14} />
                        </Link>
                      </div>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      <NewJobModal
        open={newOpen}
        onClose={() => setNewOpen(false)}
        customers={customers}
        technicians={technicians}
        pending={pending}
        onCreate={(input) => run(() => createJob(input))}
      />

      <ConfirmDialog
        open={!!confirmId}
        title="Delete this job?"
        message="Line items, timers, and the job timeline are removed too. Invoices stay on record."
        onCancel={() => setConfirmId(null)}
        onConfirm={() => {
          if (confirmId) run(() => deleteJob(confirmId));
          setConfirmId(null);
        }}
      />
    </div>
  );
}

function NewJobModal({
  open,
  onClose,
  customers,
  technicians,
  pending,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  customers: { id: string; name: string }[];
  technicians: { id: string; name: string; color: string }[];
  pending: boolean;
  onCreate: (input: {
    customerId: string; title: string; serviceType: string; technicianId: string | null;
    scheduledStart: string | null; priority: string; travelFee: number; notes: string;
  }) => void;
}) {
  const [customerId, setCustomerId] = useState("");
  const [title, setTitle] = useState("");
  const [serviceType, setServiceType] = useState("tuning");
  const [technicianId, setTechnicianId] = useState("");
  const [start, setStart] = useState("");
  const [priority, setPriority] = useState("normal");
  const [travelFee, setTravelFee] = useState("");
  const [notes, setNotes] = useState("");

  const submit = () => {
    if (!customerId) return;
    onCreate({
      customerId,
      title: title.trim() || "Home service visit",
      serviceType,
      technicianId: technicianId || null,
      scheduledStart: start || null,
      priority,
      travelFee: Number(travelFee || 0),
      notes,
    });
    onClose();
    setCustomerId(""); setTitle(""); setStart(""); setTravelFee(""); setNotes("");
  };

  return (
    <SvcModal open={open} onClose={onClose} title="New job" subtitle="Leaving the time blank parks it in Unscheduled.">
      <div className="space-y-3.5">
        <Field label="Customer">
          <Select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
            <option value="">Select a customer…</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </Select>
        </Field>
        <Field label="Job title">
          <TextInput value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Standard tuning — Yamaha U1" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Service type">
            <Select value={serviceType} onChange={(e) => setServiceType(e.target.value)}>
              {SERVICE_TYPES.map((s) => (
                <option key={s.key} value={s.key}>{s.label}</option>
              ))}
            </Select>
          </Field>
          <Field label="Technician">
            <Select value={technicianId} onChange={(e) => setTechnicianId(e.target.value)}>
              <option value="">Unassigned</option>
              {technicians.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Scheduled start" hint="Manila time">
            <TextInput type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} />
          </Field>
          <Field label="Travel fee" hint="Pesos">
            <TextInput type="number" min={0} step="50" value={travelFee} onChange={(e) => setTravelFee(e.target.value)} placeholder="0" />
          </Field>
        </div>
        <Field label="Priority">
          <Select value={priority} onChange={(e) => setPriority(e.target.value)}>
            <option value="low">Low</option>
            <option value="normal">Normal</option>
            <option value="high">High</option>
            <option value="urgent">Urgent</option>
          </Select>
        </Field>
        <Field label="Notes">
          <TextInput value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Gate code, stairwell, client requests…" />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <GhostButton onClick={onClose}>Cancel</GhostButton>
          <PrimaryButton pending={pending} disabled={!customerId} onClick={submit}>
            Create job
          </PrimaryButton>
        </div>
      </div>
    </SvcModal>
  );
}
