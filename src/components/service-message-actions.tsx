"use client";

import { useState, useTransition } from "react";
import { Check, Copy, MessageCircle, MessageSquareText } from "lucide-react";
import { fillTemplate, firstName, messengerHref, smsHref, type Placeholder } from "@/lib/service-waitlist";
import { markMessaged } from "@/server/service-waitlist";

const DIM = { color: "var(--color-svc-text-dim)" } as const;
const BTN = "btn-svc-ghost rounded-xl px-3.5 min-h-11 inline-flex items-center gap-1.5 text-[13px]";

/**
 * The generated message for one client with the four things you do with it: Copy, Open Messenger (after copying),
 * SMS with the text prefilled, and "Messaged ✓" (status → messaged, next follow-up in 3 days). Every button is 44px tall.
 */
export default function MessageActions({
  entryId, customerName, phone, messenger, template, vars, onMessaged, showMessaged = true, compact = false, extra,
}: {
  entryId: string;
  customerName: string;
  phone: string | null;
  messenger: string | null;
  template: string;
  vars: Partial<Record<Placeholder, string | null | undefined>>;
  onMessaged?: () => void;
  showMessaged?: boolean;
  compact?: boolean;
  /** More buttons for the same row (e.g. "Convert to job"). */
  extra?: React.ReactNode;
}) {
  const filled = fillTemplate(template, { first_name: firstName(customerName), ...vars });
  const [copied, setCopied] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const copy = async (): Promise<boolean> => {
    try { await navigator.clipboard.writeText(filled.text); setCopied(true); setTimeout(() => setCopied(false), 2200); return true; }
    catch { setError("Couldn't copy automatically — select the text above and copy it."); return false; }
  };
  const sms = smsHref(phone, filled.text);
  const fb = messengerHref(messenger);

  return (
    <div className="space-y-2.5">
      {!compact && (
        <p className="text-[14px] rounded-xl px-3.5 py-3 whitespace-pre-wrap select-text" style={{ background: "var(--color-svc-surface-2)", color: "var(--color-svc-text)", border: "1px solid var(--color-svc-border)" }}>
          {filled.text}
        </p>
      )}
      {filled.missing.length > 0 && (
        <p className="text-[12px]" style={{ color: "var(--color-svc-warn)" }}>
          Not filled in yet: {filled.missing.map((m) => `{${m}}`).join(", ")} — the message reads fine without, or add the missing detail first.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => { void copy(); }} className={BTN} aria-label={`Copy message for ${customerName}`}>
          {copied ? <><Check size={14} aria-hidden="true" /> Copied</> : <><Copy size={14} aria-hidden="true" /> Copy</>}
        </button>
        {fb ? (
          <a href={fb} target="_blank" rel="noreferrer" onClick={() => { void copy(); }} className={BTN} aria-label={`Open Messenger chat with ${customerName} (the message is copied first)`}>
            <MessageCircle size={14} aria-hidden="true" /> Messenger
          </a>
        ) : null}
        {sms ? (
          <a href={sms} className={BTN} aria-label={`Text ${customerName} by SMS with the message filled in`}>
            <MessageSquareText size={14} aria-hidden="true" /> SMS
          </a>
        ) : null}
        {showMessaged && (
          <button
            type="button" disabled={pending || done} className={`${BTN} !text-[var(--color-svc-text)]`}
            onClick={() => start(async () => {
              setError(null);
              const r = await markMessaged(entryId);
              if (!r.ok) return setError(r.error);
              setDone(true); onMessaged?.();
            })}
            aria-label={`Mark ${customerName} as messaged`}
          >
            <Check size={14} aria-hidden="true" /> {done ? "Marked ✓" : "Messaged ✓"}
          </button>
        )}
        {extra}
      </div>
      {!fb && !compact && <p className="text-[12px]" style={DIM}>No Messenger username saved — add one on the customer page to get a Messenger button.</p>}
      {error && <p role="alert" className="text-[12px]" style={{ color: "var(--color-svc-danger)" }}>{error}</p>}
      <p role="status" aria-live="polite" className="sr-only">{copied ? "Message copied" : done ? "Marked as messaged" : ""}</p>
    </div>
  );
}
