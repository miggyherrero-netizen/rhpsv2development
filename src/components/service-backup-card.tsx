"use client";

import { useId, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, Download, ShieldAlert } from "lucide-react";
import { SectionCard, PrimaryButton, TextInput, TONE_TEXT } from "@/components/service-ui";
import { fileNameFromDisposition, formatBytes } from "@/lib/backup-download";

type Result = { kind: "error" | "success"; text: string } | null;

/**
 * "Download a backup of your data": POST /api/backup with the owner's password in the JSON body (never in a URL).
 * The password lives only in the uncontrolled input and is cleared right after it is read.
 */
export default function BackupCard() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [hasText, setHasText] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result>(null);
  const hintId = useId();
  const statusId = useId();

  async function download() {
    const el = inputRef.current;
    const password = el?.value ?? "";
    if (!password || busy) return;
    if (el) el.value = "";
    setHasText(false);
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/backup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        cache: "no-store",
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        let text = "The backup could not be created. Nothing was downloaded.";
        try { text = ((await res.json()) as { error?: string }).error ?? text; } catch { /* keep default */ }
        if (res.status === 401) text = "Your session ended. Please log in again, then retry.";
        setResult({ kind: "error", text });
        return;
      }
      const blob = await res.blob();
      const name = fileNameFromDisposition(res.headers.get("Content-Disposition"), "herrero-backup.json.gz");
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setResult({ kind: "success", text: `Saved ${name} (${formatBytes(blob.size)}). Store it somewhere safe and private now (an encrypted drive), then delete other copies.` });
    } catch {
      setResult({ kind: "error", text: "Could not reach the server. Check your connection and try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <SectionCard title="Download a backup of your data">
      <form
        className="px-5 py-4 space-y-4"
        onSubmit={(e) => { e.preventDefault(); void download(); }}
      >
        <div className="space-y-1.5 max-w-[62ch]">
          <p className="text-[14px]" style={{ color: "var(--color-svc-text)" }}>
            One file with everything in the app, including payroll and staff data: customers, jobs, invoices, payments, expenses, the waitlist, the price book,
            workers with their hours and pay rates, inventory, projects with client-portal links, settings and the website hero image.</p>
          <p className="text-[13px]" style={{ color: "var(--color-svc-text-dim)" }}>
            Not inside: passwords, login sessions and shared invoice links. After a restore you set the passwords and PINs again.
          </p>
        </div>

        <div
          className="flex gap-2.5 rounded-[10px] px-3.5 py-3 text-[13px] max-w-[62ch]"
          style={{ border: "1px solid var(--color-svc-border)", background: "rgba(255,255,255,0.03)", color: "var(--color-svc-text)" }}
        >
          <ShieldAlert size={18} className="shrink-0 mt-0.5" aria-hidden="true" style={{ color: TONE_TEXT.warn }} />
          <p>
            <strong>Keep this file as private as a password.</strong>{" "}
            It holds your customers&apos; personal data (names, phones, addresses)
            and working links to their client portals. It is not encrypted: keep it on an encrypted drive (BitLocker), never in chat or e-mail.
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <label className="block w-full sm:w-72">
            <span className="block text-[12px] mb-1.5" style={{ color: "var(--color-svc-text-dim)" }}>Type your password to confirm</span>
            <TextInput
              ref={inputRef}
              type="password"
              name="backup-confirm-password"
              autoComplete="current-password"
              onChange={(e) => setHasText(e.target.value.length > 0)}
              aria-describedby={`${hintId} ${statusId}`}
              className="!min-h-11"
            />
          </label>
          <PrimaryButton type="submit" pending={busy} disabled={!hasText} className="!min-h-11 w-full sm:w-auto">
            {!busy && <Download size={15} aria-hidden="true" />}
            {busy ? "Preparing backup…" : "Download backup"}
          </PrimaryButton>
        </div>

        <div id={statusId} aria-live="polite" aria-atomic="true" className="min-h-[1.25rem]">
          {result?.kind === "error" && (
            <p className="text-[13px] flex items-start gap-1.5" style={{ color: TONE_TEXT.danger }}>
              <AlertCircle size={15} className="shrink-0 mt-0.5" aria-hidden="true" /> <span>{result.text}</span>
            </p>
          )}
          {result?.kind === "success" && (
            <p className="text-[13px] flex items-start gap-1.5" style={{ color: TONE_TEXT.success }}>
              <CheckCircle2 size={15} className="shrink-0 mt-0.5" aria-hidden="true" /> <span>{result.text}</span>
            </p>
          )}
        </div>

        <p id={hintId} className="text-[12px] max-w-[62ch]" style={{ color: "var(--color-svc-text-faint)" }}>
          This button only makes a copy. To restore a backup, your developer uses the command line (see docs/BACKUP.md). Up to 5 tries every 10 minutes; 5 wrong passwords in a row lock the button for 15 minutes.
        </p>
      </form>
    </SectionCard>
  );
}
