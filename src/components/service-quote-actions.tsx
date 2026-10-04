"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { advanceJob, createInvoiceFromJob } from "@/server/service";
import type { QuoteStatus } from "@/lib/service-flow";

const BTN = "rounded-lg border border-[#bed1d2] bg-white px-3 py-2.5 text-[11px] text-[#214953] hover:bg-[#e7f2f0] disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#216c72]";
const PRIMARY = "rounded-lg border border-[#216c72] bg-[#216c72] px-3.5 py-2.5 text-[11px] text-white hover:bg-[#1b585d] disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#216c72]";

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
      {error ? <span role="alert" className="text-[11px] text-[#a95353]">{error}</span> : null}
    </>
  );
}
