"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, MapPin, Phone, Mail, MessageCircle, Pencil, Plus, Piano as PianoIcon, ExternalLink } from "lucide-react";
import { fmtDate, peso } from "@/lib/format";
import {
  INVOICE_STATUS_LABEL, INVOICE_STATUS_TONE, JOB_STATUS_LABEL, JOB_STATUS_TONE, invoiceCode, jobCode,
} from "@/lib/service";
import { billedHeadline, messengerHandle, withMessenger, parseMessengerHandle } from "@/lib/service-flow";
import { hasQuote, isBatchCustomer, jobHeading, withCustomerType } from "@/lib/service-reports";
import { telHref } from "@/lib/dashboard";
import type { CustomerDetail } from "@/server/service-data";
import {
  archiveCustomer, createJob, updateCustomer, createLocation, deleteLocation, createPiano, updatePiano, deletePiano,
} from "@/server/service";
import { lastServiceDate } from "@/lib/service-last-service";
import { JobFormModal, type ShowroomPiano } from "@/components/service-forms";
import { CustomerSheet } from "@/components/service-customers";
import {
  Chip, ConfirmDialog, EmptyState, ErrorLine, Field, GhostButton, Money, PrimaryButton, SectionCard, StatCard, SvcModal, TextInput, TONE_TEXT,
} from "@/components/service-ui";

const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-svc-accent)]";
const FAINT = { color: "var(--color-svc-text-faint)" } as const;

export default function CustomerDetailClient({
  detail, invoicePrefix, jobPrefix, technicians, showroomPianos, canSeeMoney,
}: {
  detail: CustomerDetail;
  invoicePrefix: string;
  jobPrefix: string;
  technicians: { id: string; name: string }[];
  showroomPianos: ShowroomPiano[];
  /** Billing figures are finance data — hidden from non-owner roles. */
  canSeeMoney: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [newJob, setNewJob] = useState(false);
  const [manage, setManage] = useState(false);
  const [messengerOpen, setMessengerOpen] = useState(false);
  const [confirm, setConfirm] = useState<{ kind: "location" | "piano"; id: string } | null>(null);

  const { customer, locations, pianos, jobs, invoices } = detail;
  const batch = isBatchCustomer(customer.tags, customer.name);
  const phone = telHref(customer.phone);
  const messenger = messengerHandle(customer.tags);

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (res && !res.ok) setError(res.error ?? "Something went wrong.");
      else router.refresh();
    });
  };

  // The management sheet (edit, addresses, pianos) expects the list-card shape.
  const card = {
    ...customer, locations,
    pianos: pianos.map((p) => ({ ...p, locationLabel: locations.find((l) => l.id === p.locationId)?.label ?? null })),
    jobCount: jobs.length, openJobCount: jobs.filter((j) => !["completed", "invoiced", "paid", "cancelled"].includes(j.status)).length,
    lastServiceAt: lastServiceDate(jobs, pianos), billedCents: detail.billedCents, paidCents: 0, outstandingCents: detail.outstandingCents,
    draftCount: detail.drafts.count, draftCents: detail.drafts.totalCents,
  } as Parameters<typeof CustomerSheet>[0]["customer"];

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-6 lg:py-8 max-w-[1200px] mx-auto space-y-5">
      <div>
        <Link href="/service/customers" className={`inline-flex items-center gap-1.5 text-[12.5px] hover:underline rounded-sm ${FOCUS}`} style={FAINT}>
          <ArrowLeft size={13} /> Customers
        </Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="font-serif text-3xl break-words" style={{ color: "var(--color-svc-text)" }}>{customer.name}</h1>
              {batch && <Chip tone="violet">Trip / batch</Chip>}
            </div>
            {customer.company ? <p className="text-[13px] mt-1" style={{ color: "var(--color-svc-text-dim)" }}>{customer.company}</p> : null}
            <p className="text-[14px] mt-2 svc-num" style={{ color: "var(--color-svc-text-dim)" }}>
              {canSeeMoney ? billedHeadline(jobs.length, detail.billedCents) : `${jobs.length} job${jobs.length === 1 ? "" : "s"}`}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <PrimaryButton onClick={() => setNewJob(true)} className="!min-h-11"><Plus size={15} /> New job for this customer</PrimaryButton>
            <GhostButton onClick={() => setManage(true)} className="inline-flex items-center gap-1.5 !min-h-11"><Pencil size={13} /> Edit & manage</GhostButton>
          </div>
        </div>
      </div>

      <ErrorLine>{error}</ErrorLine>

      <div className="flex flex-wrap items-center gap-2.5">
        {phone ? (
          <a href={phone} className={`btn-svc-ghost rounded-xl px-4 min-h-11 inline-flex items-center gap-2 text-[13px] ${FOCUS}`}><Phone size={15} /> Call {customer.phone}</a>
        ) : null}
        {messenger ? (
          <a href={`https://m.me/${messenger}`} target="_blank" rel="noopener noreferrer" className={`btn-svc-ghost rounded-xl px-4 min-h-11 inline-flex items-center gap-2 text-[13px] ${FOCUS}`}><MessageCircle size={15} /> Messenger</a>
        ) : (
          <button type="button" onClick={() => setMessengerOpen(true)} className={`btn-svc-ghost rounded-xl px-4 min-h-11 inline-flex items-center gap-2 text-[13px] ${FOCUS}`}><MessageCircle size={15} /> Add Messenger</button>
        )}
        {customer.email ? (
          <a href={`mailto:${customer.email}`} className={`btn-svc-ghost rounded-xl px-4 min-h-11 inline-flex items-center gap-2 text-[13px] ${FOCUS}`}><Mail size={15} /> {customer.email}</a>
        ) : null}
      </div>

      {canSeeMoney && (
        <div className="svc-tiles">
          <StatCard label="Billed" value={<Money cents={detail.billedCents} />} tone="violet" sub="sent invoices" />
          <StatCard label="Outstanding" value={<Money cents={detail.outstandingCents} />} tone={detail.outstandingCents > 0 ? "warn" : "slate"} sub="as of today" />
          {detail.drafts.count > 0 && <StatCard label="Drafts" value={<Money cents={detail.drafts.totalCents} />} sub={`${detail.drafts.count} not yet sent`} />}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <SectionCard title={`Addresses · ${locations.length}`}>
          {locations.length === 0 ? (
            <EmptyState icon={<MapPin size={19} strokeWidth={1.7} />} title="No addresses yet" hint="Add one under Edit & manage, or while creating a job." />
          ) : (
            <ul className="svc-divide">
              {locations.map((l) => (
                <li key={l.id} className="flex items-start justify-between gap-3 px-5 py-3.5">
                  <div className="min-w-0">
                    <p className="text-[13.5px]" style={{ color: "var(--color-svc-text)" }}>{l.label}</p>
                    <p className="text-[12.5px] mt-0.5" style={{ color: "var(--color-svc-text-dim)" }}>{l.addressLine}{l.area ? ` · ${l.area}` : ""}</p>
                    {l.accessNotes ? <p className="text-[12px] mt-1" style={FAINT}>{l.accessNotes}</p> : null}
                  </div>
                  <a
                    href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${l.addressLine}, ${l.city ?? ""}`)}`}
                    target="_blank" rel="noopener noreferrer"
                    className={`shrink-0 inline-flex items-center gap-1 min-h-10 text-[12.5px] hover:underline ${FOCUS}`} style={{ color: TONE_TEXT.azure }}
                  >
                    <ExternalLink size={12} /> Directions
                  </a>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard title={`Pianos · ${pianos.length}`}>
          {pianos.length === 0 ? (
            <EmptyState icon={<PianoIcon size={19} strokeWidth={1.7} />} title="No pianos yet" hint="Add instruments under Edit & manage, or while creating a job." />
          ) : (
            <ul className="svc-divide">
              {pianos.map((p) => (
                <li key={p.id} className="flex items-start justify-between gap-3 px-5 py-3.5">
                  <div className="min-w-0">
                    <p className="text-[13.5px]" style={{ color: "var(--color-svc-text)" }}>{[p.brand, p.model].filter(Boolean).join(" ") || p.type}</p>
                    <p className="text-[12.5px] mt-0.5" style={{ color: "var(--color-svc-text-dim)" }}>{p.type}{p.year ? ` · ${p.year}` : ""}</p>
                  </div>
                  <div className="text-right text-[12px] shrink-0" style={FAINT}>
                    {p.nextServiceDueAt ? <>Next service<br /><span className="svc-num" style={{ color: "var(--color-svc-text-dim)" }}>{fmtDate(new Date(p.nextServiceDueAt))}</span></> : "No recall set"}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

      <SectionCard title={`Jobs · ${jobs.length}`} action={<GhostButton onClick={() => setNewJob(true)} className="inline-flex items-center gap-1 !min-h-10"><Plus size={13} /> New job</GhostButton>}>
        {jobs.length === 0 ? (
          <EmptyState title="No jobs yet" hint="Create the first visit for this customer." />
        ) : (
          <ul className="svc-divide">
            {jobs.map((j) => {
              const h = jobHeading(j.title, j.serviceType);
              return (
                <li key={j.id}>
                  <Link href={`/service/jobs/${j.id}`} className={`flex items-center justify-between gap-3 px-5 py-3.5 hover:bg-white/[0.03] ${FOCUS}`}>
                    <div className="min-w-0">
                      <p className="text-[13.5px] truncate" style={{ color: "var(--color-svc-text)" }}>{h.heading}</p>
                      <p className="text-[12px] mt-0.5 svc-num" style={{ color: "var(--color-svc-text-dim)" }}>
                        <span className="font-mono">{jobCode(jobPrefix, j.jobNumber, j.createdAt)}</span> · {j.scheduledStart ? fmtDate(new Date(j.scheduledStart)) : "Unscheduled"}
                      </p>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      {canSeeMoney && (hasQuote(j.quotedCents) ? <Money cents={j.quotedCents} className="text-[13px]" /> : <span className="text-[12.5px]" style={FAINT}>No quote</span>)}
                      <Chip tone={JOB_STATUS_TONE[j.status] ?? "slate"}>{JOB_STATUS_LABEL[j.status] ?? j.status}</Chip>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </SectionCard>

      {canSeeMoney && (
        <SectionCard title={`Invoices · ${invoices.length}`}>
          {invoices.length === 0 ? (
            <EmptyState title="No invoices yet" hint="Invoices appear here once a job is billed." />
          ) : (
            <ul className="svc-divide">
              {invoices.map((i) => (
                <li key={i.id}>
                  <Link href={`/service/invoices/${i.id}`} className={`flex items-center justify-between gap-3 px-5 py-3.5 hover:bg-white/[0.03] ${FOCUS}`}>
                    <div className="min-w-0">
                      <p className="text-[13px] font-mono" style={{ color: "var(--color-svc-text)" }}>{invoiceCode(invoicePrefix, i.invoiceNumber, i.issueDate)}</p>
                      <p className="text-[12px] mt-0.5" style={{ color: "var(--color-svc-text-dim)" }}>{fmtDate(new Date(i.issueDate))}</p>
                    </div>
                    <div className="flex items-center gap-3 shrink-0 text-right">
                      <div>
                        <Money cents={i.totalCents} className="text-[13px]" />
                        {i.status !== "draft" && !i.voidedAt && i.balanceCents > 0 && <p className="text-[12px]" style={FAINT}>Balance {peso(i.balanceCents)}</p>}
                      </div>
                      <Chip tone={INVOICE_STATUS_TONE[i.status] ?? "slate"}>{INVOICE_STATUS_LABEL[i.status] ?? i.status}</Chip>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      )}

      {customer.notes ? (
        <SectionCard title="Notes"><p className="px-5 py-4 text-[13px]" style={{ color: "var(--color-svc-text-dim)" }}>{customer.notes}</p></SectionCard>
      ) : null}

      <JobFormModal
        open={newJob}
        mode="new"
        onClose={() => setNewJob(false)}
        pending={pending}
        customers={[{ id: customer.id, name: customer.name, isBatch: isBatchCustomer(customer.tags, customer.name) }]}
        showroomPianos={showroomPianos}
        technicians={technicians}
        initial={{ customerId: customer.id }}
        onSubmit={(values) => run(() => createJob(values))}
      />

      {manage && (
        <CustomerSheet
          customer={card}
          onClose={() => setManage(false)}
          pending={pending}
          onSave={(patch) => run(() => updateCustomer(customer.id, patch))}
          onArchive={() => { run(() => archiveCustomer(customer.id, true)); setManage(false); }}
          onRestore={() => { run(() => archiveCustomer(customer.id, false)); setManage(false); }}
          onAddLocation={(input) => run(() => createLocation({ ...input, customerId: customer.id }))}
          onDeleteLocation={(id) => setConfirm({ kind: "location", id })}
          onAddPiano={(input) => run(() => createPiano({ ...input, customerId: customer.id }))}
          onUpdatePiano={(id, patch) => run(() => updatePiano(id, patch))}
          onDeletePiano={(id) => setConfirm({ kind: "piano", id })}
        />
      )}

      <MessengerModal
        open={messengerOpen}
        onClose={() => setMessengerOpen(false)}
        pending={pending}
        onSave={(handle) => run(() => updateCustomer(customer.id, { ...customer, tags: withMessenger(withCustomerType(customer.tags, batch ? "batch" : "client"), handle) }))}
      />

      <ConfirmDialog
        open={!!confirm}
        title={confirm?.kind === "piano" ? "Remove this instrument?" : "Remove this location?"}
        message="Jobs already recorded keep their history."
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          if (confirm?.kind === "piano") run(() => deletePiano(confirm.id));
          if (confirm?.kind === "location") run(() => deleteLocation(confirm.id));
          setConfirm(null);
        }}
      />
    </div>
  );
}

function MessengerModal({ open, onClose, pending, onSave }: { open: boolean; onClose: () => void; pending: boolean; onSave: (handle: string) => void }) {
  return (
    <SvcModal open={open} onClose={onClose} title="Messenger">
      {open && <MessengerBody onClose={onClose} pending={pending} onSave={onSave} />}
    </SvcModal>
  );
}

function MessengerBody({ onClose, pending, onSave }: { onClose: () => void; pending: boolean; onSave: (handle: string) => void }) {
  const [text, setText] = useState("");
  const handle = parseMessengerHandle(text);
  return (
    <div className="space-y-3.5">
      <Field label="Facebook username or link" hint="Paste their m.me or facebook.com link">
        <TextInput value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. m.me/maria.santos" autoFocus />
      </Field>
      {text.trim() && !handle && <p role="alert" className="text-[12px]" style={{ color: TONE_TEXT.danger }}>That doesn&apos;t look like a Facebook username or link.</p>}
      <div className="flex justify-end gap-2">
        <GhostButton onClick={onClose} className="!min-h-11">Cancel</GhostButton>
        <PrimaryButton pending={pending} disabled={!handle} onClick={() => { if (handle) { onSave(handle); onClose(); } }} className="!min-h-11">Save</PrimaryButton>
      </div>
    </div>
  );
}
