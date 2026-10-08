"use client";

import { useId, useState } from "react";
import { ChevronDown } from "lucide-react";
import { fieldLabel, formatValue } from "@/lib/service-finance-history";
import { describeReason } from "@/lib/service-finance-edit";
import type { FinanceHistoryItem } from "@/server/service-finance-history-data";

const when = new Intl.DateTimeFormat("en-PH", {
  timeZone: "Asia/Manila", year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
});

const ACTION_LABEL: Record<FinanceHistoryItem["action"], string> = {
  create: "Added", update: "Edited", delete: "Deleted", status: "Status",
};

/** Newest-first timeline of finance edits. Rows with field changes expand to show "from -> to". */
export default function FinanceHistoryList({ items, tableMissing }: { items: FinanceHistoryItem[]; tableMissing: boolean }) {
  if (tableMissing) {
    return (
      <p className="px-5 py-4 text-[13px]" style={{ color: "var(--color-svc-text-dim)" }}>
        History is not switched on yet. Ask your developer to run the finance history update on the database.
      </p>
    );
  }
  if (items.length === 0) {
    return <p className="px-5 py-4 text-[13px]" style={{ color: "var(--color-svc-text-dim)" }}>No changes recorded yet.</p>;
  }
  return (
    <ol className="svc-divide">
      {items.map((it) => <HistoryRow key={it.id} item={it} />)}
    </ol>
  );
}

function HistoryRow({ item }: { item: FinanceHistoryItem }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const entries = Object.entries(item.changes ?? {});
  const reasonText = describeReason(item.reason);
  const text = (
    <>
      <span className="block text-[12px] tnum" style={{ color: "var(--color-svc-text-dim)" }}>
        {when.format(new Date(item.at))} · {ACTION_LABEL[item.action]}{item.actorName ? ` · ${item.actorName}` : ""}
      </span>
      <span className="block text-[14px] mt-0.5" style={{ color: "var(--color-svc-text)" }}>{item.summary}</span>
      {reasonText ? (
        <span className="block text-[13px] mt-0.5 break-words" style={{ color: "var(--color-svc-text-dim)" }}>{reasonText}</span>
      ) : null}
    </>
  );
  return (
    <li className="px-5">
      {entries.length ? (
        <button
          type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls={panelId}
          className="w-full min-h-11 py-2.5 flex items-start justify-between gap-3 text-left rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2"
          style={{ outlineColor: "var(--color-svc-accent)" }}
        >
          <span className="min-w-0">{text}</span>
          <span className="shrink-0 inline-flex items-center gap-1 text-[12px] pt-0.5" style={{ color: "var(--color-svc-accent-text, var(--color-svc-accent))" }}>
            {open ? "Hide details" : "Show details"}
            <ChevronDown size={14} className={open ? "rotate-180" : ""} aria-hidden="true" />
          </span>
        </button>
      ) : (
        <div className="py-2.5 min-h-11">{text}</div>
      )}
      {open && entries.length ? (
        <dl id={panelId} className="pb-3 grid grid-cols-1 gap-1.5">
          {entries.map(([field, c]) => (
            <div key={field} className="grid grid-cols-[7.5rem_1fr] gap-x-3 text-[13px]">
              <dt style={{ color: "var(--color-svc-text-dim)" }}>{fieldLabel(field)}</dt>
              <dd className="tnum break-words" style={{ color: "var(--color-svc-text)" }}>
                <span style={{ color: "var(--color-svc-text-dim)" }}>{formatValue(field, c.from)}</span>
                <span aria-label="changed to"> → </span>
                <span>{formatValue(field, c.to)}</span>
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
    </li>
  );
}
