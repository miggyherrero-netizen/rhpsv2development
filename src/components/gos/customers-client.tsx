"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { customerStatusLabel, type CustomerStatus } from "@/lib/gos/customers";
import { manilaDate } from "@/lib/gos/format";
import { searchCustomers, type CustomerRow } from "@/server/gos/customers";

type Row = Omit<CustomerRow, "inquiryAt" | "updatedAt" | "createdAt" | "repliedAt"> & { inquiryAt: string; updatedAt: string; createdAt: string; repliedAt: string | null };

const FILTERS = ["All", "Active", "Unpaid", "Past", "Lost"] as const;
type Filter = (typeof FILTERS)[number];
const ACTIVE: CustomerStatus[] = ["New", "Replied", "Quoted", "Booked"];

function matches(f: Filter, s: CustomerStatus) {
  if (f === "All") return true;
  if (f === "Active") return ACTIVE.includes(s);
  if (f === "Unpaid") return s === "Completed";
  if (f === "Past") return s === "Paid";
  return s === "Lost";
}

export default function CustomersClient({ rows }: { rows: Row[] }) {
  const [filter, setFilter] = useState<Filter>("All");
  const [sort, setSort] = useState<"recent" | "name">("recent");
  const [q, setQ] = useState("");
  const [foundRaw, setFound] = useState<Row[] | null>(null);

  useEffect(() => {
    if (!q.trim()) return;
    const t = setTimeout(async () => {
      const res = await searchCustomers(q);
      if (res.ok) setFound(JSON.parse(JSON.stringify(res.value)));
    }, 150);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = document.activeElement as HTMLElement | null;
      if (e.key === "/" && !(el && ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName))) {
        e.preventDefault();
        document.getElementById("gos-search")?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const found = q.trim() ? foundRaw : null;
  let list = (found ?? rows).filter((r) => matches(filter, r.status as CustomerStatus));
  if (!found) list = [...list].sort((a, b) => (sort === "name" ? a.name.localeCompare(b.name) : b.updatedAt.localeCompare(a.updatedAt)));
  const recent = rows.slice(0, 5);

  return (
    <div className="mt-2 space-y-4">
      <h1 className="text-2xl font-bold">Customers</h1>
      <label className="block">
        <span className="sr-only">Search customers</span>
        <input id="gos-search" className="gos-input" placeholder="Search name, area, phone, note  ( / )" value={q} onChange={(e) => setQ(e.target.value)} />
      </label>
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter">
        {FILTERS.map((f) => (
          <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)}
            className={`gos-tap rounded-full border px-4 ${filter === f ? "bg-[var(--gos-black)] text-white" : "bg-white"}`}>{f}</button>
        ))}
        {!found && (
          <label className="ml-auto text-sm">Sort{" "}
            <select className="gos-input !min-h-9 !w-auto" value={sort} onChange={(e) => setSort(e.target.value as "recent" | "name")}>
              <option value="recent">Recent activity</option>
              <option value="name">Name</option>
            </select>
          </label>
        )}
      </div>

      {!q.trim() && (
        <section aria-label="Recently opened">
          <h2 className="mb-1 text-sm font-bold text-[var(--gos-ink-dim)]">Recent</h2>
          <ul className="flex flex-wrap gap-2">
            {recent.map((r) => <li key={r.id}><Link className="gos-tap inline-flex items-center rounded-full border bg-white px-3" href={`/os/customers/${r.id}`}>{r.name}</Link></li>)}
          </ul>
        </section>
      )}

      {q.trim() && found && found.length === 0 && (
        <p role="status" className="gos-card">No match for &apos;{q}&apos;. Tap + Add inquiry and type &apos;{q}&apos; as the name.</p>
      )}

      <ul className="space-y-2">
        {list.map((r) => (
          <li key={r.id}>
            <Link href={`/os/customers/${r.id}`} className="gos-card gos-tap block">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-bold">{r.name}</span>
                <span>{customerStatusLabel(r.status as CustomerStatus)}</span>
              </div>
              <div className="mt-1 flex flex-wrap gap-2 text-sm text-[var(--gos-ink-dim)]">
                {r.area && <span>{r.area}</span>}
                <span>Updated {manilaDate(new Date(r.updatedAt))}</span>
                {r.cameFrom === "Messenger" && r.adKind === "unknown" && <span className="rounded border px-1">No ad tag</span>}
                {r.possibleDuplicate && <span className="rounded border border-[var(--gos-danger)] px-1">⚠ Possible duplicate</span>}
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
