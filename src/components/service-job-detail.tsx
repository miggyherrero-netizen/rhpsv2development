"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft, MapPin, Phone, Receipt, Trash2, Plus, Play, Square, Navigation, Timer as TimerIcon,
  Pencil, Wallet, TrendingUp, MessageSquarePlus, ExternalLink, Clock3,
} from "lucide-react";
import { fmtDate, fmtTime, toLocalInput, peso } from "@/lib/format";
import {
  JOB_STATUSES, JOB_STATUS_LABEL, JOB_STATUS_TONE, SERVICE_TYPES, SERVICE_TYPE_LABEL,
  TIME_KINDS, TIME_KIND_LABEL, ITEM_KINDS, EXPENSE_CATEGORIES, EXPENSE_CATEGORY_LABEL,
  computeTotals, elapsedMinutes, fmtMinutes, jobCode, jobMargin, lineTotalCents,
} from "@/lib/service";
import type { JobDetail } from "@/server/service-data";
import {
  updateJob, setJobStatus, assignJob, addJobItem, updateJobItem, deleteJobItem, addJobNote,
  startTimer, stopTimer, addManualTime, deleteTimeLog, createInvoiceFromJob, createExpense,
  deleteExpense, deleteJob,
} from "@/server/service";
import {
  Chip, ConfirmDialog, Dot, EmptyState, ErrorLine, Field, GhostButton, Money, PrimaryButton,
  SectionCard, Select, StatCard, SvcModal, TextArea, TextInput, TONE_TEXT,
} from "@/components/service-ui";

export default function JobDetailClient({
  detail: initialDetail,
  jobPrefix,
  taxRateBps,
}: {
  detail: JobDetail;
  jobPrefix: string;
  taxRateBps: number;
}) {
  const detail = initialDetail;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [itemOpen, setItemOpen] = useState(false);
  const [timeOpen, setTimeOpen] = useState(false);
  const [expenseOpen, setExpenseOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [note, setNote] = useState("");

  const { job } = detail;
  const totals = useMemo(
    () => computeTotals(detail.items, { taxRateBps }),
    [detail.items, taxRateBps],
  );
  const workMinutes = detail.timeLogs.filter((l) => l.kind === "work").reduce((s, l) => s + (l.minutes ?? 0), 0);
  const travelMinutes = detail.timeLogs.filter((l) => l.kind === "travel").reduce((s, l) => s + (l.minutes ?? 0), 0);
  const expenseCents = detail.expenses.reduce((s, e) => s + e.amountCents, 0);
  const invoicedCents = detail.invoices.filter((i) => !i.voidedAt).reduce((s, i) => s + i.totalCents, 0);
  const margin = jobMargin({
    laborCostCents: job.laborCostCents,
    partsCostCents: job.partsCostCents,
    expenseCents,
    invoicedCents,
  });

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (res && !res.ok) setError(res.error ?? "Something went wrong.");
    });
  };

  const runTo = async (fn: () => Promise<{ ok: true; data?: { id: string } } | { ok: false; error: string }>) => {
    setError(null);
    const res = await fn();
    if (res.ok && res.data?.id) router.push(`/service/invoices/${res.data.id}`);
    else if (!res.ok) setError(res.error);
  };

  const statusTone = JOB_STATUS_TONE[job.status] ?? "slate";

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-6 lg:py-8 max-w-[1400px] mx-auto space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <Link
            href="/service/jobs"
            className="inline-flex items-center gap-1.5 text-[12px] hover:underline"
            style={{ color: "var(--color-svc-text-faint)" }}
          >
            <ArrowLeft size={13} /> Jobs
          </Link>
          <div className="flex flex-wrap items-center gap-3 mt-2">
            <span className="font-mono text-[12px] tnum" style={{ color: "var(--color-svc-text-faint)" }}>
              {jobCode(jobPrefix, job.jobNumber, job.createdAt)}
            </span>
            <Chip tone={statusTone}>{JOB_STATUS_LABEL[job.status] ?? job.status}</Chip>
            {job.runningLog ? <Chip tone="warn">{job.runningLog.kind} running</Chip> : null}
          </div>
          <h1 className="font-serif text-3xl mt-1.5" style={{ color: "var(--color-svc-text)" }}>
            {job.title}
          </h1>
          <p className="text-[12.5px] mt-1" style={{ color: "var(--color-svc-text-dim)" }}>
            {job.customerName}
            {job.scheduledStart ? ` · ${fmtDate(new Date(job.scheduledStart))} at ${fmtTime(new Date(job.scheduledStart))}` : " · unscheduled"}
            {job.technicianName ? ` · ${job.technicianName}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={job.status}
            disabled={pending}
            onChange={(e) => run(() => setJobStatus(job.id, e.target.value))}
            className="!w-auto"
          >
            {JOB_STATUSES.map((s) => (
              <option key={s.key} value={s.key}>{s.label}</option>
            ))}
          </Select>
          <Select
            value={job.technicianId ?? ""}
            disabled={pending}
            onChange={(e) => run(() => assignJob(job.id, e.target.value || null))}
            className="!w-auto"
          >
            <option value="">Unassigned</option>
            {detail.technicians.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </Select>
          <GhostButton onClick={() => setEditOpen(true)} className="inline-flex items-center gap-1.5">
            <Pencil size={13} /> Edit
          </GhostButton>
          <GhostButton
            onClick={() => setConfirmDelete(true)}
            className="inline-flex items-center gap-1.5"
            style={{ color: TONE_TEXT.danger }}
          >
            <Trash2 size={13} /> Delete
          </GhostButton>
        </div>
      </div>

      <ErrorLine>{error}</ErrorLine>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-5">
        {/* Main column */}
        <div className="space-y-5">
          {/* Visit details */}
          <SectionCard title="Visit">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4 px-5 py-4">
              <Info label="Customer">
                {job.customerName}
                {detail.customer.phone ? (
                  <a href={`tel:${detail.customer.phone}`} className="ml-2 inline-flex items-center gap-1 hover:underline" style={{ color: TONE_TEXT.azure }}>
                    <Phone size={11} /> {detail.customer.phone}
                  </a>
                ) : null}
              </Info>
              <Info label="Service type">{SERVICE_TYPE_LABEL[job.serviceType] ?? job.serviceType}</Info>
              <Info label="Location">
                {detail.location ? (
                  <>
                    <span>{detail.location.label} · {detail.location.addressLine}</span>
                    <a
                      href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(
                        `${detail.location.addressLine}, ${detail.location.city}`,
                      )}`}
                      target="_blank"
                      rel="noreferrer"
                      className="ml-2 inline-flex items-center gap-1 hover:underline"
                      style={{ color: TONE_TEXT.azure }}
                    >
                      <MapPin size={11} /> Directions
                    </a>
                    {detail.location.accessNotes ? (
                      <p className="text-[11.5px] mt-1" style={{ color: "var(--color-svc-text-faint)" }}>
                        {detail.location.accessNotes}
                      </p>
                    ) : null}
                  </>
                ) : (
                  <span style={{ color: "var(--color-svc-text-faint)" }}>No location set</span>
                )}
              </Info>
              <Info label="Piano">
                {detail.piano
                  ? `${[detail.piano.brand, detail.piano.model].filter(Boolean).join(" ") || detail.piano.type} (${detail.piano.type})`
                  : "Not linked"}
              </Info>
              <Info label="Scheduled">
                {job.scheduledStart
                  ? `${fmtDate(new Date(job.scheduledStart))} · ${fmtTime(new Date(job.scheduledStart))}${
                      job.scheduledEnd ? ` – ${fmtTime(new Date(job.scheduledEnd))}` : ""
                    }`
                  : "Unscheduled"}
              </Info>
              <Info label="Estimate">
                {fmtMinutes(job.estimatedMinutes)}
                {job.travelMinutes ? ` · ${fmtMinutes(job.travelMinutes)} travel` : ""}
              </Info>
              {job.notes ? (
                <div className="sm:col-span-2">
                  <Info label="Notes">{job.notes}</Info>
                </div>
              ) : null}
              {job.privateNotes ? (
                <div className="sm:col-span-2">
                  <Info label="Private notes">{job.privateNotes}</Info>
                </div>
              ) : null}
            </div>
          </SectionCard>

          {/* Line items */}
          <SectionCard
            title="Quote lines"
            action={
              <GhostButton onClick={() => setItemOpen(true)} className="inline-flex items-center gap-1.5">
                <Plus size={13} /> Add line
              </GhostButton>
            }
          >
            {detail.items.length === 0 ? (
              <EmptyState
                icon={<Receipt size={19} strokeWidth={1.7} />}
                title="No line items yet"
                hint="Add the services, parts, and fees for this visit."
              />
            ) : (
              <>
                <div className="overflow-x-auto thin-scroll">
                  <table className="w-full text-left">
                    <thead>
                      <tr style={{ color: "var(--color-svc-text-faint)" }}>
                        {["Description", "Type", "Qty", "Unit price", "Amount", ""].map((h) => (
                          <th key={h} className="px-5 py-2.5 text-[10px] uppercase tracking-[0.16em] font-normal">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="svc-divide">
                      {detail.items.map((item) => (
                        <tr key={item.id} className="group">
                          <td className="px-5 py-2.5 text-[13px]" style={{ color: "var(--color-svc-text)" }}>
                            {item.description}
                          </td>
                          <td className="px-5 py-2.5 text-[11.5px]" style={{ color: "var(--color-svc-text-dim)" }}>
                            {item.kind}
                            {item.taxable ? "" : " · no VAT"}
                          </td>
                          <td className="px-5 py-2.5">
                            <input
                              type="number"
                              min={1}
                              defaultValue={item.qty}
                              onBlur={(e) => {
                                const qty = Number(e.target.value);
                                if (qty > 0 && qty !== item.qty) run(() => updateJobItem(item.id, { qty }));
                              }}
                              className="input-svc !w-16 !py-1 !px-2 text-[12px]"
                            />
                          </td>
                          <td className="px-5 py-2.5">
                            <input
                              type="number"
                              min={0}
                              step="50"
                              defaultValue={item.unitPriceCents / 100}
                              onBlur={(e) => {
                                const value = Number(e.target.value);
                                if (!Number.isNaN(value)) run(() => updateJobItem(item.id, { unitPrice: value }));
                              }}
                              className="input-svc !w-28 !py-1 !px-2 text-[12px]"
                            />
                          </td>
                          <td className="px-5 py-2.5">
                            <Money cents={lineTotalCents(item)} className="text-[13px]" />
                          </td>
                          <td className="px-5 py-2.5 text-right">
                            <button
                              onClick={() => run(() => deleteJobItem(item.id))}
                              className="p-1.5 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-white/[0.06]"
                              style={{ color: "var(--color-svc-text-faint)" }}
                              aria-label="Remove line"
                            >
                              <Trash2 size={13} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div
                  className="px-5 py-3 space-y-1.5 text-[12.5px]"
                  style={{ borderTop: "1px solid var(--color-svc-border)" }}
                >
                  <Row label="Subtotal"><Money cents={totals.subtotalCents} /></Row>
                  <Row label={`VAT (${(taxRateBps / 100).toFixed(0)}%)`}><Money cents={totals.taxCents} /></Row>
                  <Row label="Total" strong><Money cents={totals.totalCents} /></Row>
                </div>
              </>
            )}
          </SectionCard>

          {/* Time log */}
          <SectionCard
            title="Time on this job"
            action={
              <div className="flex items-center gap-2">
                <GhostButton
                  disabled={pending || !!job.runningLog}
                  onClick={() => run(() => startTimer(job.id, "travel", job.technicianId))}
                  className="!text-[11.5px] inline-flex items-center gap-1.5"
                >
                  <Navigation size={12} /> Travel
                </GhostButton>
                <GhostButton
                  disabled={pending || !!job.runningLog}
                  onClick={() => run(() => startTimer(job.id, "work", job.technicianId))}
                  className="!text-[11.5px] inline-flex items-center gap-1.5"
                >
                  <Play size={12} /> On site
                </GhostButton>
                <GhostButton onClick={() => setTimeOpen(true)} className="!text-[11.5px] inline-flex items-center gap-1.5">
                  <Clock3 size={12} /> Manual
                </GhostButton>
              </div>
            }
          >
            {job.runningLog ? (
              <div
                className="flex items-center justify-between gap-3 px-5 py-3"
                style={{ background: "var(--color-svc-warn-soft)" }}
              >
                <span className="text-[12.5px]" style={{ color: "var(--color-svc-warn)" }}>
                  {TIME_KIND_LABEL[job.runningLog.kind] ?? job.runningLog.kind} running since{" "}
                  {fmtTime(new Date(job.runningLog.startedAt))}
                </span>
                <GhostButton
                  disabled={pending}
                  onClick={() => run(() => stopTimer(job.runningLog!.id))}
                  className="inline-flex items-center gap-1.5"
                >
                  <Square size={12} /> Stop
                </GhostButton>
              </div>
            ) : null}

            {detail.timeLogs.length === 0 ? (
              <EmptyState
                icon={<TimerIcon size={19} strokeWidth={1.7} />}
                title="No time recorded"
                hint="Start a timer to capture travel and on-site minutes for job costing."
              />
            ) : (
              <div className="svc-divide">
                {detail.timeLogs.map((log) => (
                  <div key={log.id} className="flex items-center gap-3 px-5 py-2.5 group">
                    <Chip tone={log.kind === "work" ? "azure" : log.kind === "travel" ? "violet" : "slate"}>
                      {TIME_KIND_LABEL[log.kind] ?? log.kind}
                    </Chip>
                    <span className="text-[12.5px]" style={{ color: "var(--color-svc-text-dim)" }}>
                      {fmtDate(new Date(log.startedAt))} {fmtTime(new Date(log.startedAt))}
                      {log.endedAt ? ` – ${fmtTime(new Date(log.endedAt))}` : " · running"}
                    </span>
                    <span className="text-[12.5px]" style={{ color: "var(--color-svc-text-faint)" }}>
                      {log.technicianName ?? "Unassigned"}
                    </span>
                    <div className="flex-1" />
                    <span className="text-[13px] tnum" style={{ color: "var(--color-svc-text)" }}>
                      {log.endedAt ? fmtMinutes(log.minutes) : fmtMinutes(elapsedMinutes(log.startedAt))}
                    </span>
                    <button
                      onClick={() => run(() => deleteTimeLog(log.id))}
                      className="p-1.5 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-white/[0.06]"
                      style={{ color: "var(--color-svc-text-faint)" }}
                      aria-label="Delete time entry"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
                <div className="px-5 py-2.5 flex gap-5 text-[12px]" style={{ color: "var(--color-svc-text-faint)" }}>
                  <span>On site {fmtMinutes(workMinutes)}</span>
                  <span>Travel {fmtMinutes(travelMinutes)}</span>
                  <span>Labor cost {peso(job.laborCostCents / 100)}</span>
                </div>
              </div>
            )}
          </SectionCard>

          {/* Expenses */}
          <SectionCard
            title="Job expenses"
            action={
              <GhostButton onClick={() => setExpenseOpen(true)} className="inline-flex items-center gap-1.5">
                <Plus size={13} /> Add
              </GhostButton>
            }
          >
            {detail.expenses.length === 0 ? (
              <EmptyState title="No expenses on this job" hint="Fuel, materials, and subcontractor costs reduce the job margin." />
            ) : (
              <div className="svc-divide">
                {detail.expenses.map((e) => (
                  <div key={e.id} className="flex items-center gap-3 px-5 py-2.5 group">
                    <Chip tone="slate">{EXPENSE_CATEGORY_LABEL[e.category] ?? e.category}</Chip>
                    <span className="text-[12.5px] flex-1 truncate" style={{ color: "var(--color-svc-text-dim)" }}>
                      {e.description}
                    </span>
                    <span className="text-[11.5px]" style={{ color: "var(--color-svc-text-faint)" }}>
                      {fmtDate(new Date(e.spentAt))}
                    </span>
                    <Money cents={e.amountCents} className="text-[13px]" />
                    <button
                      onClick={() => run(() => deleteExpense(e.id))}
                      className="p-1.5 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-white/[0.06]"
                      style={{ color: "var(--color-svc-text-faint)" }}
                      aria-label="Delete expense"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
                <div className="px-5 py-2.5 text-[12px]" style={{ color: "var(--color-svc-text-faint)" }}>
                  Total expenses {peso(expenseCents / 100)}
                </div>
              </div>
            )}
          </SectionCard>
        </div>

        {/* Side column */}
        <div className="space-y-5">
          <SectionCard title="Invoicing">
            <div className="px-5 py-4 space-y-3">
              <Row label="Quoted (pre-VAT)"><Money cents={job.quotedCents} /></Row>
              <Row label="Invoiced"><Money cents={invoicedCents} /></Row>
              {detail.invoices.map((inv) => (
                <Link
                  key={inv.id}
                  href={`/service/invoices/${inv.id}`}
                  className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl transition hover:bg-white/[0.03]"
                  style={{ background: "var(--color-svc-surface-2)" }}
                >
                  <span className="text-[12.5px]" style={{ color: "var(--color-svc-text)" }}>
                    Invoice #{inv.invoiceNumber}
                    <span className="ml-1.5 text-[11px]" style={{ color: "var(--color-svc-text-faint)" }}>
                      {inv.status}
                    </span>
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <Money cents={inv.totalCents} className="text-[12.5px]" />
                    <ExternalLink size={12} style={{ color: "var(--color-svc-text-faint)" }} />
                  </span>
                </Link>
              ))}
              {job.status !== "cancelled" && (
                <PrimaryButton
                  className="w-full"
                  pending={pending}
                  disabled={detail.items.length === 0}
                  onClick={() => runTo(() => createInvoiceFromJob(job.id, { discountCents: 0, includeTravel: true }))}
                >
                  <Receipt size={14} />
                  {detail.invoices.length ? "Create another invoice" : "Create invoice"}
                </PrimaryButton>
              )}
              {detail.items.length === 0 && (
                <p className="text-[11.5px]" style={{ color: "var(--color-svc-text-faint)" }}>
                  Add at least one quote line before invoicing.
                </p>
              )}
            </div>
          </SectionCard>

          <div className="grid grid-cols-2 gap-3">
            <StatCard label="Job cost" value={peso(margin.costCents / 100)} sub="labor + parts + expenses" />
            <StatCard
              label="Margin"
              value={`${margin.marginPct}%`}
              sub={peso(margin.profitCents / 100)}
              tone={margin.profitCents >= 0 ? "success" : "danger"}
              icon={<TrendingUp size={15} />}
            />
          </div>

          <SectionCard title="Timeline">
            <div className="px-5 py-4 space-y-3">
              <div className="flex gap-2">
                <TextInput
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Add a note…"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && note.trim()) {
                      run(() => addJobNote(job.id, note.trim()));
                      setNote("");
                    }
                  }}
                />
                <GhostButton
                  disabled={pending || !note.trim()}
                  onClick={() => {
                    run(() => addJobNote(job.id, note.trim()));
                    setNote("");
                  }}
                  aria-label="Add note"
                >
                  <MessageSquarePlus size={14} />
                </GhostButton>
              </div>
              <div className="space-y-3 max-h-[380px] overflow-y-auto thin-scroll pr-1">
                {detail.events.map((ev) => (
                  <div key={ev.id} className="flex gap-3">
                    <Dot
                      color={
                        ev.type === "payment" ? "var(--color-svc-success)"
                          : ev.type === "completed" ? "var(--color-svc-success)"
                          : ev.type === "cancelled" ? "var(--color-svc-danger)"
                          : "var(--color-svc-accent)"
                      }
                      size={6}
                    />
                    <div className="min-w-0">
                      <p className="text-[12.5px]" style={{ color: "var(--color-svc-text)" }}>
                        {ev.message ?? ev.type}
                      </p>
                      <p className="text-[11px] mt-0.5" style={{ color: "var(--color-svc-text-faint)" }}>
                        {fmtDate(new Date(ev.at))} · {fmtTime(new Date(ev.at))}
                        {ev.actorName ? ` · ${ev.actorName}` : ""}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </SectionCard>
        </div>
      </div>

      {/* Modals */}
      <EditJobModal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        job={job}
        pending={pending}
        onSave={(patch) => run(() => updateJob(job.id, patch))}
      />
      <AddItemModal
        open={itemOpen}
        onClose={() => setItemOpen(false)}
        catalog={detail.catalog}
        pending={pending}
        onCreate={(input) => run(() => addJobItem(job.id, input))}
      />
      <ManualTimeModal
        open={timeOpen}
        onClose={() => setTimeOpen(false)}
        technicians={detail.technicians}
        pending={pending}
        onCreate={(input) => run(() => addManualTime({ ...input, jobId: job.id }))}
      />
      <ExpenseModal
        open={expenseOpen}
        onClose={() => setExpenseOpen(false)}
        pending={pending}
        onCreate={(input) => run(() => createExpense({ ...input, jobId: job.id }))}
      />
      <ConfirmDialog
        open={confirmDelete}
        title="Delete this job?"
        message="The job, its line items, timers, and timeline will be removed. Invoices are kept."
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => {
          setConfirmDelete(false);
          startTransition(async () => {
            await deleteJob(job.id);
            router.push("/service/jobs");
          });
        }}
      />
    </div>
  );
}

/* ============================================================
 * Local pieces
 * ============================================================ */

function Info({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-[0.16em] mb-1" style={{ color: "var(--color-svc-text-faint)" }}>
        {label}
      </p>
      <p className="text-[13px]" style={{ color: "var(--color-svc-text)" }}>
        {children}
      </p>
    </div>
  );
}

function Row({ label, children, strong }: { label: string; children: React.ReactNode; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span style={{ color: strong ? "var(--color-svc-text)" : "var(--color-svc-text-dim)" }}>{label}</span>
      <span className={strong ? "font-medium" : ""}>{children}</span>
    </div>
  );
}

function EditJobModal({
  open,
  onClose,
  job,
  pending,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  job: JobDetail["job"];
  pending: boolean;
  onSave: (patch: {
    title: string; serviceType: string; priority: string; scheduledStart: string | null;
    estimatedMinutes: number; travelFee: number; notes: string; privateNotes: string;
  }) => void;
}) {
  const [title, setTitle] = useState(job.title);
  const [serviceType, setServiceType] = useState(job.serviceType);
  const [priority, setPriority] = useState(job.priority);
  const [start, setStart] = useState(job.scheduledStart ? toLocalInput(new Date(job.scheduledStart)).slice(0, 16) : "");
  const [minutes, setMinutes] = useState(String(job.estimatedMinutes));
  const [travel, setTravel] = useState(String(job.travelFeeCents / 100));
  const [notes, setNotes] = useState(job.notes ?? "");
  const [privateNotes, setPrivateNotes] = useState(job.privateNotes ?? "");

  return (
    <SvcModal open={open} onClose={onClose} title="Edit visit" wide>
      <div className="space-y-3.5">
        <Field label="Job title">
          <TextInput value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Service type">
            <Select value={serviceType} onChange={(e) => setServiceType(e.target.value)}>
              {SERVICE_TYPES.map((s) => (
                <option key={s.key} value={s.key}>{s.label}</option>
              ))}
            </Select>
          </Field>
          <Field label="Priority">
            <Select value={priority} onChange={(e) => setPriority(e.target.value)}>
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </Select>
          </Field>
          <Field label="Duration (min)">
            <TextInput type="number" min={15} step={15} value={minutes} onChange={(e) => setMinutes(e.target.value)} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Scheduled start" hint="Manila time">
            <TextInput type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} />
          </Field>
          <Field label="Travel fee" hint="Pesos">
            <TextInput type="number" min={0} step={50} value={travel} onChange={(e) => setTravel(e.target.value)} />
          </Field>
        </div>
        <Field label="Notes (visible to client)">
          <TextArea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <Field label="Private notes">
          <TextArea rows={2} value={privateNotes} onChange={(e) => setPrivateNotes(e.target.value)} />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <GhostButton onClick={onClose}>Cancel</GhostButton>
          <PrimaryButton
            pending={pending}
            onClick={() => {
              onSave({
                title,
                serviceType,
                priority,
                scheduledStart: start || null,
                estimatedMinutes: Number(minutes) || 60,
                travelFee: Number(travel) || 0,
                notes,
                privateNotes,
              });
              onClose();
            }}
          >
            Save changes
          </PrimaryButton>
        </div>
      </div>
    </SvcModal>
  );
}

function AddItemModal({
  open,
  onClose,
  catalog,
  pending,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  catalog: JobDetail["catalog"];
  pending: boolean;
  onCreate: (input: { kind: string; description: string; qty: number; unitPrice: number; taxable: boolean; catalogItemId?: string | null }) => void;
}) {
  const [kind, setKind] = useState("service");
  const [description, setDescription] = useState("");
  const [qty, setQty] = useState("1");
  const [price, setPrice] = useState("");
  const [taxable, setTaxable] = useState(true);

  const pickFromCatalog = (id: string) => {
    const item = catalog.find((c) => c.id === id);
    if (!item) return;
    setDescription(item.name);
    setPrice(String(item.unitPriceCents / 100));
    setKind(item.kind);
    setTaxable(item.taxable);
  };

  return (
    <SvcModal open={open} onClose={onClose} title="Add quote line">
      <div className="space-y-3.5">
        {catalog.length > 0 && (
          <Field label="From price book" hint="Prefills the fields below">
            <Select defaultValue="" onChange={(e) => pickFromCatalog(e.target.value)}>
              <option value="">Choose an item…</option>
              {catalog.map((c) => (
                <option key={c.id} value={c.id}>{c.name} — {peso(c.unitPriceCents / 100)}</option>
              ))}
            </Select>
          </Field>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Type">
            <Select value={kind} onChange={(e) => setKind(e.target.value)}>
              {ITEM_KINDS.map((k) => (
                <option key={k.key} value={k.key}>{k.label}</option>
              ))}
            </Select>
          </Field>
          <Field label="Quantity">
            <TextInput type="number" min={1} value={qty} onChange={(e) => setQty(e.target.value)} />
          </Field>
        </div>
        <Field label="Description">
          <TextInput value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Concert tuning" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Unit price" hint="Pesos">
            <TextInput type="number" step="50" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="2500" />
          </Field>
          <Field label="VAT">
            <Select value={taxable ? "yes" : "no"} onChange={(e) => setTaxable(e.target.value === "yes")}>
              <option value="yes">Taxable</option>
              <option value="no">Exempt</option>
            </Select>
          </Field>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <GhostButton onClick={onClose}>Cancel</GhostButton>
          <PrimaryButton
            pending={pending}
            disabled={!description.trim()}
            onClick={() => {
              onCreate({
                kind,
                description: description.trim(),
                qty: Number(qty) || 1,
                unitPrice: Number(price) || 0,
                taxable,
              });
              onClose();
              setDescription(""); setPrice(""); setQty("1");
            }}
          >
            Add line
          </PrimaryButton>
        </div>
      </div>
    </SvcModal>
  );
}

function ManualTimeModal({
  open,
  onClose,
  technicians,
  pending,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  technicians: JobDetail["technicians"];
  pending: boolean;
  onCreate: (input: { kind: string; technicianId: string | null; startedAt: string; endedAt: string; note: string }) => void;
}) {
  const [kind, setKind] = useState("work");
  const [technicianId, setTechnicianId] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [note, setNote] = useState("");

  return (
    <SvcModal open={open} onClose={onClose} title="Add time manually">
      <div className="space-y-3.5">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Type">
            <Select value={kind} onChange={(e) => setKind(e.target.value)}>
              {TIME_KINDS.map((k) => (
                <option key={k.key} value={k.key}>{k.label}</option>
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
          <Field label="Start">
            <TextInput type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} />
          </Field>
          <Field label="End">
            <TextInput type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} />
          </Field>
        </div>
        <Field label="Note">
          <TextInput value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <GhostButton onClick={onClose}>Cancel</GhostButton>
          <PrimaryButton
            pending={pending}
            disabled={!start || !end}
            onClick={() => {
              onCreate({
                kind,
                technicianId: technicianId || null,
                startedAt: start,
                endedAt: end,
                note,
              });
              onClose();
            }}
          >
            Add time
          </PrimaryButton>
        </div>
      </div>
    </SvcModal>
  );
}

function ExpenseModal({
  open,
  onClose,
  pending,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  pending: boolean;
  onCreate: (input: { category: string; description: string; amount: number; spentAt: string | null }) => void;
}) {
  const [category, setCategory] = useState("materials");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [spentAt, setSpentAt] = useState("");

  return (
    <SvcModal open={open} onClose={onClose} title="Add job expense">
      <div className="space-y-3.5">
        <Field label="Category">
          <Select value={category} onChange={(e) => setCategory(e.target.value)}>
            {EXPENSE_CATEGORIES.map((c) => (
              <option key={c.key} value={c.key}>{c.label}</option>
            ))}
          </Select>
        </Field>
        <Field label="Description">
          <TextInput value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Damper felt stock" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Amount" hint="Pesos">
            <TextInput type="number" step="50" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <Field label="Date">
            <TextInput type="datetime-local" value={spentAt} onChange={(e) => setSpentAt(e.target.value)} />
          </Field>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <GhostButton onClick={onClose}>Cancel</GhostButton>
          <PrimaryButton
            pending={pending}
            disabled={!description.trim()}
            onClick={() => {
              onCreate({ category, description: description.trim(), amount: Number(amount) || 0, spentAt: spentAt || null });
              onClose();
              setDescription(""); setAmount("");
            }}
          >
            Add expense
          </PrimaryButton>
        </div>
      </div>
    </SvcModal>
  );
}
