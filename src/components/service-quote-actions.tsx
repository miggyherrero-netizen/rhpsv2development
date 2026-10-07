"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { advanceJob, createInvoiceFromJob } from "@/server/service";
import type { QuoteStatus } from "@/lib/service-flow";

const BTN = "inline-flex min-h-11 cursor-pointer items-center rounded-lg border border-[#9db8ba] bg-white px-4 text-sm font-medium text-[#174f54] transition-colors hover:bg-[#e7f2f0] disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1f6f6f]";
const PRIMARY = "inline-flex min-h-11 cursor-pointer items-center rounded-lg border border-[#1f6f6f] bg-[#1f6f6f] px-4 text-sm font-medium text-white transition-colors hover:bg-[#174f54] disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1f6f6f]";

export default function QuoteActions({ jobId, status, hasLines, invoiceId }: { jobId: string; status: QuoteStatus; hasLines: boolean; invoiceId: string | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState("");

  const run = (fn: () => Promise<{ ok: boolean; error?: string; data?: { id: string } }>, after?: (id?: string) => void) => {
    setError("");
    start(async () => {
      const res = await fn();
      if (!res.ok) return setError(res.error ?? "Something went wrong.");
      after ? after(res.data?.id) : router.refresh();
    });
  };

  return (
    <>
      <button type="button" className={BTN} onClick={() => window.print()}>Print / Save as PDF</button>
      {status === "draft" && hasLines && <button type="button" disabled={pending} className={PRIMARY} onClick={() => run(() => advanceJob(jobId, "send_quote"))}>Mark as sent</button>}
      {status === "sent" && <button type="button" disabled={pending} className={PRIMARY} onClick={() => run(() => advanceJob(jobId, "accept_quote"))}>Mark accepted</button>}
      {status === "accepted" && !invoiceId && <button type="button" disabled={pending} className={PRIMARY} onClick={() => run(() => createInvoiceFromJob(jobId), (id) => id && router.push(`/service/invoices/${id}`))}>Convert to invoice</button>}
      {invoiceId && <button type="button" className={BTN} onClick={() => router.push(`/service/invoices/${invoiceId}`)}>View invoice</button>}
      {error ? <span role="alert" className="text-sm text-[#a23f3f]">{error}</span> : null}
    </>
  );
}
