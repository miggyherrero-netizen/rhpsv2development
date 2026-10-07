"use client";

import { useState, useTransition } from "react";
type ActiveLink = { id: string; expiresAt: Date };
import { createServiceDocumentShare, revokeServiceDocumentShare } from "@/server/service-document-actions";

export default function ServiceDocumentActions({
  invoiceId, paymentId, shares = [],
}: {
  invoiceId?: string;
  paymentId?: string;
  shares?: ActiveLink[];
}) {
  const [open, setOpen] = useState(false);
  const [activeLinks, setActiveLinks] = useState(shares);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [link, setLink] = useState("");
  const [copied, setCopied] = useState(false);
  const focus = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1f6f6f]";
  const button = `inline-flex min-h-11 cursor-pointer items-center rounded-lg border border-[#9db8ba] bg-white px-4 text-sm font-medium text-[#174f54] transition-colors hover:bg-[#e7f2f0] disabled:opacity-50 ${focus}`;
  const primary = `inline-flex min-h-11 cursor-pointer items-center rounded-lg border border-[#1f6f6f] bg-[#1f6f6f] px-4 text-sm font-medium text-white transition-colors hover:bg-[#174f54] disabled:opacity-50 ${focus}`;

  function create() {
    if (!invoiceId) return;
    setError("");
    startTransition(async () => {
      try {
        const result = await createServiceDocumentShare({ invoiceId, paymentId });
        if (!result.ok) { setError(result.error); return; }
        setLink(new URL(result.path, window.location.origin).href);
        setCopied(false);
        setActiveLinks(current => [result.share, ...current]);
      } catch { setError("Couldn't create the link. Please try again."); }
    });
  }

  function revoke(id: string) {
    setError("");
    startTransition(async () => {
      try {
        const result = await revokeServiceDocumentShare(id);
        if (!result.ok) { setError(result.error); return; }
        // A just-created link might be the one revoked; never suggest it remains valid.
        setLink("");
        setActiveLinks(current => current.filter(s => s.id !== id));
      } catch { setError("Couldn't revoke the link. Please try again."); }
    });
  }

  async function copy() {
    try { await navigator.clipboard.writeText(link); setCopied(true); }
    catch { setError("Copy unavailable. Select the link above and copy it manually."); }
  }

  return <>
    <button className={primary} type="button" onClick={() => window.print()}>Print</button>
    <button className={button} type="button" onClick={() => window.print()} title="Choose Save as PDF in your browser’s print dialog">Save as PDF</button>
    {invoiceId ? <button className={button} type="button" onClick={() => setOpen(true)}>Share private link</button> : null}
    {open && <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 px-4" onClick={() => setOpen(false)}>
      <div className="w-full max-w-md rounded-2xl bg-white p-6 text-[#172a3e] shadow-xl" role="dialog" aria-modal="true" aria-labelledby="share-document-title" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-4"><div><h2 id="share-document-title" className="font-serif text-xl">Share this {paymentId ? "receipt" : "invoice"}</h2><p className="mt-2 text-sm leading-relaxed text-[#526873]">A view-only link expires in 14 days. Anyone with the link can view the document; send it only to the intended customer.</p></div><button type="button" onClick={() => setOpen(false)} className={`inline-flex size-11 cursor-pointer items-center justify-center rounded-lg text-xl ${focus}`} aria-label="Close sharing">×</button></div>
        {error ? <p role="alert" className="mt-3 rounded bg-red-50 p-2 text-sm text-red-800">{error}</p> : null}
        {link ? <div className="mt-4"><label htmlFor="new-share-link" className="text-sm font-semibold">New private link — copy it now</label><input id="new-share-link" value={link} readOnly onFocus={e=>e.target.select()} className="mt-2 w-full rounded-lg border border-[#9db8ba] p-2 text-sm"/><button type="button" onClick={copy} className={`${button} mt-2`}>{copied ? "Copied!" : "Copy link"}</button></div> : null}
        <button type="button" disabled={pending} onClick={create} className={`mt-4 min-h-11 w-full cursor-pointer rounded-lg bg-[#1f6f6f] px-4 text-sm font-semibold text-white hover:bg-[#174f54] disabled:opacity-50 ${focus}`}>{pending ? "Working…" : "Create new 14-day link"}</button>
        <div className="mt-5 border-t border-[#dce4e8] pt-4"><h3 className="text-sm font-semibold">Active links ({activeLinks.length})</h3>{activeLinks.length ? <ul className="mt-2 space-y-2">{activeLinks.map(s=><li key={s.id} className="flex items-center justify-between gap-2 rounded-lg bg-[#f1f7f5] p-2.5 text-sm"><span>Expires {new Date(s.expiresAt).toLocaleDateString("en-PH", {year:"numeric",month:"short",day:"numeric",timeZone:"Asia/Manila"})}</span><button type="button" disabled={pending} onClick={()=>revoke(s.id)} className={`min-h-11 cursor-pointer px-2 font-semibold text-[#a23f3f] disabled:opacity-50 ${focus}`}>Revoke</button></li>)}</ul> : <p className="mt-2 text-sm text-[#526873]">No active links yet. For security, old links cannot be displayed again.</p>}</div>
      </div>
    </div>}
  </>;
}
