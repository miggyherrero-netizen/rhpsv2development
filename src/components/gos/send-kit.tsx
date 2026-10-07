"use client";

import { useEffect, useRef, useState } from "react";
import { INBOX_URL } from "@/lib/gos/format";

const WINDOW_MS = 30 * 60_000;

/** Shared "Send kit": Copy -> Open Inbox -> "Did you send it?" (30 min) . Robert sends, the app only drafts. */
export default function SendKit({
  text, onSent, sentLabel = "Yes, sent", copyLabel = "Copy reply",
}: { text: string; onSent: () => void | Promise<void>; sentLabel?: string; copyLabel?: string }) {
  const [copied, setCopied] = useState(false);
  const [manual, setManual] = useState(false);
  const [asking, setAsking] = useState(false);
  const [inboxError, setInboxError] = useState(false);
  const armedAt = useRef<number | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    function onVisible() {
      if (document.visibilityState !== "visible" || armedAt.current === null) return;
      if (Date.now() - armedAt.current <= WINDOW_MS) {
        setAsking(true);
        if (hideTimer.current) clearTimeout(hideTimer.current);
        hideTimer.current = setTimeout(() => setAsking(false), 30_000);
      }
      armedAt.current = null;
    }
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setManual(false);
      setTimeout(() => setCopied(false), 2000);
      armedAt.current = Date.now();
    } catch {
      setManual(true);
    }
  }

  function openInbox() {
    armedAt.current = Date.now();
    const w = window.open(INBOX_URL, "_blank", "noopener,noreferrer");
    setInboxError(!w);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <button type="button" className="gos-btn-black" onClick={copy}>{copied ? "✓ Copied" : copyLabel}</button>
        <button type="button" className="gos-btn-ghost" onClick={openInbox}>Open Inbox</button>
      </div>
      <span role="status" className="sr-only">{copied ? "Copied" : ""}</span>
      {manual && (
        <div role="alert" className="gos-card">
          <p className="mb-2 text-sm">Long-press → Copy</p>
          <textarea readOnly className="gos-input min-h-24" value={text} onFocus={(e) => e.currentTarget.select()} autoFocus />
        </div>
      )}
      {inboxError && (
        <p role="alert" className="text-sm text-[var(--gos-danger)]">✕ Couldn&apos;t open the inbox. Open Messenger yourself — your reply is copied.</p>
      )}
      {asking && (
        <div role="alertdialog" aria-label="Did you send it?" className="gos-card flex flex-wrap items-center gap-2">
          <span className="font-bold">Did you send it?</span>
          <button type="button" className="gos-btn-black" onClick={async () => { setAsking(false); await onSent(); }}>{sentLabel}</button>
          <button type="button" className="gos-btn-ghost" onClick={() => setAsking(false)}>Not yet</button>
        </div>
      )}
    </div>
  );
}
