"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { nextJobStep } from "@/lib/service-flow";
import { advanceJob, createInvoiceFromJob } from "@/server/service";
import { PrimaryButton } from "@/components/service-ui";

/**
 * The one "what happens next" button for a job: Start travel → Arrived → Complete → Create invoice.
 * Steps that need more than a click (schedule, send the quote) take you to the job instead.
 */
export default function StepButton({
  job, invoiceId, onError, className = "",
}: {
  job: { id: string; status: string; itemCount: number; scheduledStart: Date | string | null; jobType?: string };
  invoiceId: string | null;
  onError?: (message: string | null) => void;
  className?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [localError, setLocalError] = useState<string | null>(null);
  const step = nextJobStep(job.status, { hasLineItems: job.itemCount > 0, hasInvoice: !!invoiceId, hasSchedule: !!job.scheduledStart, isSale: job.jobType === "sale" });
  if (!step) return null;
  const fail = (m: string) => { setLocalError(m); onError?.(m); };
  const cls = `!min-h-11 !px-3.5 text-[12.5px] ${className}`;

  if (step.key === "schedule" || step.key === "send_quote" || step.key === "accept_quote") {
    return (
      <Link href={`/service/jobs/${job.id}`} className={`btn-svc-ghost rounded-xl inline-flex items-center gap-1.5 px-3.5 min-h-11 text-[12.5px] ${className}`}>
        {step.label} <ArrowRight size={13} aria-hidden="true" />
      </Link>
    );
  }
  if (step.key === "view_invoice") {
    return invoiceId ? (
      <Link href={`/service/invoices/${invoiceId}`} className={`btn-svc-ghost rounded-xl inline-flex items-center gap-1.5 px-3.5 min-h-11 text-[12.5px] ${className}`}>
        {step.label} <ArrowRight size={13} aria-hidden="true" />
      </Link>
    ) : null;
  }
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <PrimaryButton
        pending={pending} className={cls} title={step.hint}
        onClick={() => {
          setLocalError(null); onError?.(null);
          start(async () => {
            if (step.key === "create_invoice") {
              const res = await createInvoiceFromJob(job.id, { discountCents: 0, includeTravel: true });
              if (!res.ok) return fail(res.error);
              if (res.data?.id) router.push(`/service/invoices/${res.data.id}`);
              return;
            }
            const res = await advanceJob(job.id, step.key);
            if (!res.ok) fail(res.error);
          });
        }}
      >
        {step.label} <ArrowRight size={13} aria-hidden="true" />
      </PrimaryButton>
      {localError && !onError ? <span role="alert" className="text-[11.5px]" style={{ color: "var(--color-svc-danger)" }}>{localError}</span> : null}
    </span>
  );
}
