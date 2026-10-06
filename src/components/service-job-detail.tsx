"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft, MapPin, Phone, Receipt, Trash2, Plus, ArrowRight, FileText, PauseCircle, Play, Square, Navigation, Timer as TimerIcon,
  Pencil, Wallet, TrendingUp, MessageSquarePlus, ExternalLink, Clock3,
} from "lucide-react";
import { fmtDate, fmtTime, toLocalInput, peso } from "@/lib/format";
import {
  JOB_STATUSES, JOB_STATUS_LABEL, JOB_STATUS_TONE, SERVICE_TYPES, SERVICE_TYPE_LABEL,
  TIME_KINDS, TIME_KIND_LABEL, ITEM_KINDS, EXPENSE_CATEGORIES, EXPENSE_CATEGORY_LABEL,
  computeTotals, elapsedMinutes, fmtMinutes, jobCode, jobMargin, lineTotalCents, taxLineLabel,
} from "@/lib/service";
import { countable } from "@/lib/service-reports";
import { nextJobStep, parsePesoInput } from "@/lib/service-flow";
import { ExpenseFormModal, JobFormModal, TimeEditModal, type ShowroomPiano } from "@/components/service-forms";
import { timeSourceLabel } from "@/lib/service-time-events";
import LineEditor, { toServerLine, type LineAdapter } from "@/components/service-line-editor";
import type { CatalogEntry, EditorLine } from "@/lib/service-lines";
import type { JobDetail } from "@/server/service-data";
import {
  advanceJob, updateJob, setJobStatus, addJobItems, updateJobItem, deleteJobItem, addJobNote, createCatalogItem,
  startTimer, stopTimer, addManualTime, updateTimeLog, deleteTimeLog, createInvoiceFromJob, createExpense,
  deleteExpense, deleteJob,
} from "@/server/service";
import {
  Chip, ConfirmTypeDialog, DateField, Dot, PesoInput, EmptyState, ErrorLine, Field, GhostButton, MoreMenu, Money, PrimaryButton,
  SectionCard, Select, StatCard, SvcModal, TextArea, TextInput, TONE_TEXT, UnitInput, type MoreItem,
} from "@/components/service-ui";

export default function JobDetailClient({
  detail: initialDetail,
  showroomPianos,
  jobPrefix,
  taxRateBps,
  taxLabel,
  vatEnabled,
  marginExcludesVat,
  includeLaborCost,
  showJobMargins,
}: {
  detail: JobDetail;
  showroomPianos: ShowroomPiano[];
  jobPrefix: string;
  taxRateBps: number;
  taxLabel: string;
  /** Owner setting: quote previews (and new invoices) carry no VAT when false. */
  vatEnabled: boolean;
  marginExcludesVat: boolean;
  includeLaborCost: boolean;
  showJobMargins: boolean;
}) {
  const detail = initialDetail;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [timeOpen, setTimeOpen] = useState(false);
  const [editLogId, setEditLogId] = useState<string | null>(null);
  const [expenseOpen, setExpenseOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [note, setNote] = useState("");

  const { job } = detail;
  // The editor owns the lines while the page is open; totals follow what it shows, saved or still saving.
  const editorLines = useMemo<EditorLine[]>(() => detail.items.map((i) => ({
    id: i.id, kind: i.kind, description: i.description, qty: i.qty, unitPriceCents: i.unitPriceCents, taxable: i.taxable,
    costCents: i.costCents, catalogItemId: i.catalogItemId, minutes: i.minutes, details: i.details, position: i.position,
  })), []); // eslint-disable-line react-hooks/exhaustive-deps -- seeded once; the editor keeps its own state afterwards
  const [liveLines, setLiveLines] = useState<EditorLine[]>(editorLines);
  const lineAdapter = useMemo<LineAdapter>(() => ({
    addMany: async (lines, position) => {
      const res = await addJobItems(detail.job.id, lines.map((l) => ({ ...toServerLine(l), position })));
      return res.ok ? { ok: true, ids: res.data!.ids, positions: res.data!.positions } : res;
    },
    update: (id, patch) => updateJobItem(id, patch),
    remove: (id) => deleteJobItem(id),
    saveToPriceBook: async (l) => {
      const res = await createCatalogItem({ name: l.description, description: l.details ?? null, kind: l.kind, unitPrice: l.unitPriceCents / 100, taxable: l.taxable, estimatedMinutes: l.minutes ?? 60 });
      if (!res.ok) return res;
      const now = new Date();
      return { ok: true, entry: { id: res.data!.id, name: l.description, kind: l.kind, unitPriceCents: l.unitPriceCents, taxable: l.taxable, estimatedMinutes: l.minutes ?? 60, description: l.details ?? null, active: true, isQuickAdd: false, packageId: null, createdAt: now, updatedAt: now } as CatalogEntry };
    },
  }), [detail.job.id]);
  const totals = useMemo(
    () => computeTotals(liveLines, { taxRateBps, vatEnabled }),
    [liveLines, taxRateBps, vatEnabled],
  );
  const workMinutes = detail.timeLogs.filter((l) => l.kind === "work").reduce((s, l) => s + (l.minutes ?? 0), 0);
  const travelMinutes = detail.timeLogs.filter((l) => l.kind === "travel").reduce((s, l) => s + (l.minutes ?? 0), 0);
  const expenseCents = detail.expenses.reduce((s, e) => s + e.amountCents, 0);
  // Drafts never count as invoiced — same rule as Finance job margins.
  const liveInvoices = countable(detail.invoices);
  const invoicedCents = liveInvoices.reduce((s, i) => s + i.totalCents, 0);
  // Saved VAT on each invoice — historical invoices keep whatever rate they were issued at.
  const invoicedTaxCents = liveInvoices.reduce((s, i) => s + i.taxCents, 0);
  const margin = jobMargin(
    {
      laborCostCents: job.laborCostCents,
      partsCostCents: job.partsCostCents,
      expenseCents,
      invoicedCents,
      taxCents: invoicedTaxCents,
    },
    { marginExcludesVat, includeLaborCost },
  );
  const costBreakdown = includeLaborCost ? "labor + parts + expenses" : "parts + expenses";

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (res && !res.ok) setError(res.error ?? "Something went wrong.");
    });
  };

  const runTo = (fn: () => Promise<{ ok: true; data?: { id: string } } | { ok: false; error: string }>) => {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (res.ok && res.data?.id) router.push(`/service/invoices/${res.data.id}`);
      else if (!res.ok) setError(res.error);
    });
  };

  const statusTone = JOB_STATUS_TONE[job.status] ?? "slate";

  // One primary "next step" instead of a free status dropdown; every status stays reachable under More.
  const liveInvoice = detail.invoices.find((i) => !i.voidedAt) ?? null;
  const isSale = job.jobType === "sale";
  const step = nextJobStep(job.status, { hasLineItems: detail.items.length > 0, hasInvoice: !!liveInvoice, hasSchedule: !!job.scheduledStart, isSale });
  const onStep = () => {
    if (!step) return;
    if (step.key === "schedule") return setEditOpen(true);
    if (step.key === "view_invoice") return liveInvoice && router.push(`/service/invoices/${liveInvoice.id}`);
    if (step.key === "create_invoice") return void runTo(() => createInvoiceFromJob(job.id, { discountCents: 0, includeTravel: true }));
    startTransition(async () => {
      setError(null);
      const res = await advanceJob(job.id, step.key);
      if (!res.ok) return setError(res.error);
      if (step.key === "send_quote") router.push(`/service/jobs/${job.id}/quote`);
    });
  };
  const moreItems: MoreItem[] = [
    ...(!isSale && detail.items.length > 0 ? [{ label: "Open quote document", href: `/service/jobs/${job.id}/quote`, icon: <FileText size={14} /> }] : []),
    ...(job.status === "scheduled" || job.status === "en_route" || job.status === "in_progress"
      ? [{ label: "Put on hold", onSelect: () => run(() => setJobStatus(job.id, "on_hold")), icon: <PauseCircle size={14} /> }] : []),
    ...JOB_STATUSES.filter((s) => s.key !== job.status && s.key !== "on_hold").map((s) => ({
      label: `Set status: ${s.label}`, onSelect: () => run(() => setJobStatus(job.id, s.key)), disabled: pending,
    })),
    { label: "Delete job…", danger: true, separated: true, icon: <Trash2 size={14} />, onSelect: () => { setDeleteError(null); setConfirmDelete(true); } },
  ];

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
        <div className="flex flex-col items-start sm:items-end gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            {step ? (
              <PrimaryButton pending={pending} onClick={onStep} className="!min-h-11 !px-5">
                {step.label} <ArrowRight size={15} />
              </PrimaryButton>
            ) : (
              <Chip tone="success">{isSale ? "Sold — nothing left to do" : "Paid — nothing left to do"}</Chip>
            )}
            <GhostButton onClick={() => setEditOpen(true)} className="inline-flex items-center gap-1.5 !min-h-10">
              <Pencil size={13} /> Edit
            </GhostButton>
            <MoreMenu items={moreItems} />
          </div>
          {step ? <p className="text-[12px]" style={{ color: "var(--color-svc-text-faint)" }}>{step.hint}</p> : null}
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
                {detail.piano ? (
                  `${[detail.piano.brand, detail.piano.model].filter(Boolean).join(" ") || detail.piano.type} (${detail.piano.type})`
                ) : detail.customerPianos.length > 0 ? (
                  // No piano on this job yet — offer the customer's instruments instead of a dead "Not linked".
                  <span className="flex flex-wrap items-center gap-2">
                    <Select
                      aria-label="Link a piano to this job"
                      defaultValue=""
                      disabled={pending}
                      className="!w-auto !min-h-10"
                      onChange={(e) => e.target.value && run(() => updateJob(job.id, { pianoId: e.target.value }))}
                    >
                      <option value="" disabled>Link piano…</option>
                      {detail.customerPianos.map((p) => (
                        <option key={p.id} value={p.id}>
                          {[p.brand, p.model].filter(Boolean).join(" ") || p.type} ({p.type})
                        </option>
                      ))}
                    </Select>
                  </span>
                ) : (
                  <span>
                    <span style={{ color: "var(--color-svc-text-faint)" }}>No piano on file · </span>
                    <Link href="/service/customers" className="hover:underline" style={{ color: TONE_TEXT.azure }}>
                      add a piano to this customer
                    </Link>
                  </span>
                )}
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

          {isSale && detail.sale && (
            <SectionCard
              title="Piano sale"
              action={<GhostButton onClick={() => setEditOpen(true)} className="inline-flex items-center gap-1.5 !min-h-10"><Pencil size={13} /> Edit sale</GhostButton>}
            >
              <div className="px-5 py-4 space-y-2.5 text-[13px]">
                <Row label="Piano"><span style={{ color: "var(--color-svc-text)" }}>{detail.sale.pianoLabel ?? "Not chosen yet"}</span></Row>
                <Row label="Sale price"><Money cents={job.salePriceCents} /></Row>
                <Row label="Deposit received"><Money cents={job.depositCents} /></Row>
                <Row label={["completed", "invoiced", "paid"].includes(job.status) ? "Balance" : "Balance due on delivery"} strong>
                  {detail.sale.balanceCents > 0 ? <Money cents={detail.sale.balanceCents} /> : <span style={{ color: "var(--color-svc-success)" }}>Settled</span>}
                </Row>
                {showJobMargins ? (
                  <div className="pt-3 space-y-2.5" style={{ borderTop: "1px solid var(--color-svc-border)" }}>
                    <Row label="Buy cost"><Money cents={job.buyCostCents} /></Row>
                    <Row label="Prep costs"><Money cents={job.prepCostCents} /></Row>
                    {detail.sale.stockExpensesCents > job.buyCostCents ? (
                      <p className="text-[12px]" style={{ color: "var(--color-svc-warn)" }}>
                        Stock expenses on this piano total {peso(detail.sale.stockExpensesCents)} — more than the buy cost above, so profit uses that figure.
                      </p>
                    ) : null}
                    <Row label="Profit on this piano" strong>
                      <span style={{ color: detail.sale.profit.profitCents >= 0 ? "var(--color-svc-success)" : "var(--color-svc-danger)" }}>
                        <Money cents={detail.sale.profit.profitCents} /> · {detail.sale.profit.marginPct}%
                      </span>
                    </Row>
                    <p className="text-[12px]" style={{ color: "var(--color-svc-text-faint)" }}>
                      Counted in Finance once the sale is completed.
                    </p>
                  </div>
                ) : null}
              </div>
            </SectionCard>
          )}

          {!isSale && (
            <>
          {/* Line items: always-editable rows + an empty row at the bottom; every edit autosaves. */}
          <SectionCard title="Quote lines">
            <div className="pt-3 pb-1">
              <LineEditor
                initialLines={editorLines}
                catalog={detail.catalog}
                adapter={lineAdapter}
                onChange={setLiveLines}
                vatEnabled={vatEnabled}
                allowCost={showJobMargins}
                noun="line"
              />
            </div>
            <div
              className="px-5 py-3 space-y-1.5 text-[12.5px]"
              style={{ borderTop: "1px solid var(--color-svc-border)" }}
            >
              <Row label="Subtotal"><Money cents={totals.subtotalCents} /></Row>
              {vatEnabled ? (
                <Row label={taxLineLabel(taxLabel, taxRateBps)}><Money cents={totals.taxCents} /></Row>
              ) : null}
              <Row label="Total" strong><Money cents={totals.totalCents} /></Row>
            </div>
          </SectionCard>
            </>
          )}

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
                  <div key={log.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2.5 group">
                    <Chip tone={log.kind === "work" ? "azure" : log.kind === "travel" ? "violet" : "slate"}>
                      {TIME_KIND_LABEL[log.kind] ?? log.kind}
                    </Chip>
                    <span className="text-[11px]" style={{ color: "var(--color-svc-text-faint)" }}>{timeSourceLabel(log)}</span>
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
                      onClick={() => setEditLogId(log.id)}
                      className="inline-flex items-center justify-center min-w-11 min-h-11 rounded-lg opacity-0 group-hover:opacity-100 focus-visible:opacity-100 [@media(pointer:coarse)]:opacity-100 hover:bg-white/[0.06]"
                      style={{ color: "var(--color-svc-text-faint)" }}
                      aria-label="Edit time entry"
                    >
                      <Pencil size={13} />
                    </button>
                    <button
                      onClick={() => run(() => deleteTimeLog(log.id))}
                      className="inline-flex items-center justify-center min-w-11 min-h-11 rounded-lg opacity-0 group-hover:opacity-100 focus-visible:opacity-100 [@media(pointer:coarse)]:opacity-100 hover:bg-white/[0.06]"
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
                  <span>Labor cost {peso(job.laborCostCents)}</span>
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
                      className="inline-flex items-center justify-center min-w-11 min-h-11 rounded-lg opacity-0 group-hover:opacity-100 focus-visible:opacity-100 [@media(pointer:coarse)]:opacity-100 hover:bg-white/[0.06]"
                      style={{ color: "var(--color-svc-text-faint)" }}
                      aria-label="Delete expense"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
                <div className="px-5 py-2.5 text-[12px]" style={{ color: "var(--color-svc-text-faint)" }}>
                  Total expenses {peso(expenseCents)}
                </div>
              </div>
            )}
          </SectionCard>
        </div>

        {/* Side column */}
        <div className="space-y-5">
          {!isSale && (
            <>
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
            </>
          )}

          {showJobMargins && !isSale ? (
            <div className="grid grid-cols-2 gap-3">
              <StatCard label="Job cost" value={peso(margin.costCents)} sub={costBreakdown} />
              <StatCard
                label="Margin"
                value={`${margin.marginPct}%`}
                sub={peso(margin.profitCents)}
                tone={margin.profitCents >= 0 ? "success" : "danger"}
                icon={<TrendingUp size={15} />}
              />
            </div>
          ) : null}

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
      <JobFormModal
        open={editOpen}
        mode="edit"
        onClose={() => setEditOpen(false)}
        pending={pending}
        customers={detail.customers}
        showroomPianos={showroomPianos}
        technicians={detail.technicians.filter((t) => t.active || t.id === job.technicianId).map((t) => ({ id: t.id, name: t.name }))}
        initial={{
          customerId: job.customerId, locationId: job.locationId, pianoId: job.pianoId, technicianId: job.technicianId,
          title: job.title, serviceType: job.serviceType, priority: job.priority,
          scheduledStart: job.scheduledStart ? toLocalInput(new Date(job.scheduledStart)).slice(0, 16) : "",
          estimatedMinutes: job.estimatedMinutes, travelFee: job.travelFeeCents / 100,
          notes: job.notes ?? "", privateNotes: job.privateNotes ?? "",
          jobType: job.jobType, salePianoId: job.salePianoId,
          buyCost: job.buyCostCents / 100, prepCost: job.prepCostCents / 100, salePrice: job.salePriceCents / 100, deposit: job.depositCents / 100,
        }}
        onSubmit={(values) => run(() => updateJob(job.id, values))}
      />
      <TimeEditModal
        open={!!editLogId}
        onClose={() => setEditLogId(null)}
        pending={pending}
        log={(() => { const l = detail.timeLogs.find((x) => x.id === editLogId); return l ? { id: l.id, kind: l.kind, startedAt: l.startedAt, endedAt: l.endedAt, note: l.note, fromStatus: l.source === "event" } : null; })()}
        onSubmit={(id, v) => run(() => updateTimeLog(id, v))}
      />
      <ManualTimeModal
        open={timeOpen}
        onClose={() => setTimeOpen(false)}
        technicians={detail.technicians}
        pending={pending}
        onCreate={(input) => run(() => addManualTime({ ...input, jobId: job.id }))}
      />
      <ExpenseFormModal
        open={expenseOpen}
        onClose={() => setExpenseOpen(false)}
        pending={pending}
        fixedJobId={job.id}
        onSubmit={(values) => run(() => createExpense(values))}
      />
      <ConfirmTypeDialog
        open={confirmDelete}
        title="Delete this job?"
        message="The job, its line items, timers, and timeline will be removed. Invoices are kept."
        code={jobCode(jobPrefix, job.jobNumber, job.createdAt)}
        error={deleteError}
        pending={pending}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={(typed) =>
          startTransition(async () => {
            const res = await deleteJob(job.id, typed);
            if (res.ok) router.push("/service/jobs");
            else setDeleteError(res.error);
          })
        }
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
      <p className="text-[11px] uppercase tracking-[0.1em] mb-1" style={{ color: "var(--color-svc-text-faint)" }}>
        {label}
      </p>
      {/* a div, not a p: some values contain their own paragraphs (access notes) */}
      <div className="text-[13px]" style={{ color: "var(--color-svc-text)" }}>
        {children}
      </div>
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
            <DateField kind="datetime-local" value={start} onChange={setStart} />
          </Field>
          <Field label="End">
            <DateField kind="datetime-local" value={end} onChange={setEnd} />
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

