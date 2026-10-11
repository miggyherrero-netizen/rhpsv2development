"use client";

/**
 * "Convert to job": one hook + one button shared by the waitlist, Today and the customer page.
 * The button loads the entry's details (customer, piano, location, service, notes), opens the normal job form with them
 * filled in, and the form's "Create job" books the visit and links the waitlist entry in one go.
 */

import { useState, useTransition } from "react";
import Link from "next/link";
import { CalendarPlus, Loader2 } from "lucide-react";
import type { JobInitial } from "@/lib/service-waitlist-convert";
import { convertWaitlistEntryToJob, getConvertDefaults } from "@/server/service-waitlist";
import { JobFormModal } from "@/components/service-forms";
import { ErrorLine } from "@/components/service-ui";

type Active = { entryId: string; initial: JobInitial; customerName: string; isBatch: boolean; areaLabel: string | null };

export function useConvertToJob({ technicians }: { technicians: { id: string; name: string }[] }) {
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [active, setActive] = useState<Active | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ jobId: string; customerName: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const start = async (entryId: string) => {
    setLoadError(null); setCreated(null); setSubmitError(null); setLoadingId(entryId);
    try {
      const r = await getConvertDefaults(entryId);
      if (!r.ok || !r.data) setLoadError(r.ok ? "Couldn't open this entry." : r.error);
      else setActive({ entryId, ...r.data });
    } catch {
      setLoadError("Couldn't open this entry. Check your connection and try again.");
    } finally {
      setLoadingId(null);
    }
  };

  const close = () => { setActive(null); setSubmitError(null); };

  const modal = active ? (
    <JobFormModal
      open mode="new" onClose={close} pending={pending}
      customers={[{ id: active.initial.customerId, name: active.customerName, isBatch: active.isBatch }]}
      technicians={technicians}
      initial={{ ...active.initial }}
      convert={{
        title: "Convert to job",
        subtitle: `${active.areaLabel ? `${active.areaLabel} · ` : ""}Carried over from the waitlist. Add the time and scope.`,
        submitLabel: "Create job", customerName: active.customerName, error: submitError,
      }}
      onSubmit={(values) => {
        setSubmitError(null);
        startTransition(async () => {
          try {
            const r = await convertWaitlistEntryToJob(active.entryId, values);
            if (!r.ok || !r.data) { setSubmitError(r.ok ? "Couldn't create the job." : r.error); return; }
            setCreated({ jobId: r.data.jobId, customerName: active.customerName });
            setActive(null);
          } catch {
            setSubmitError("It may have been saved. Check the customer page before trying again.");
          }
        });
      }}
    />
  ) : null;

  const notice = (
    <>
      <ErrorLine>{loadError}</ErrorLine>
      {created && (
        <p role="status" className="text-[14px] mt-3 flex flex-wrap items-center gap-x-3 gap-y-1" style={{ color: "var(--color-svc-success)" }}>
          <span>Job created for {created.customerName}. The waitlist entry is now Scheduled.</span>
          <Link href={`/service/jobs/${created.jobId}`} className="inline-flex items-center min-h-11 underline underline-offset-2" style={{ color: "var(--color-svc-accent)" }}>Open job</Link>
        </p>
      )}
    </>
  );

  return { start, loadingId, modal, notice };
}

const GHOST = "btn-svc-ghost rounded-xl px-3.5 min-h-11 inline-flex items-center gap-1.5 text-[13px] disabled:opacity-60 disabled:cursor-not-allowed";
const PRIMARY = "btn-svc-primary rounded-[10px] px-4 min-h-11 inline-flex items-center justify-center gap-2 text-[14px] disabled:cursor-not-allowed";

export function ConvertButton({ onClick, loading, customerName, primary = false }: { onClick: () => void; loading?: boolean; customerName: string; primary?: boolean }) {
  return (
    <button
      type="button" onClick={onClick} disabled={loading} className={primary ? PRIMARY : GHOST}
      style={primary ? undefined : { color: "var(--color-svc-accent)" }} aria-label={`Convert to job, ${customerName}`}
    >
      {loading ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <CalendarPlus size={14} aria-hidden="true" />} Convert to job
    </button>
  );
}
