"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Search, ClipboardList, ArrowUpRight, ChevronDown } from "lucide-react";
import { fmtTime } from "@/lib/format";
import {
  JOB_STATUSES, JOB_STATUS_LABEL, JOB_STATUS_TONE, SERVICE_TYPES, SERVICE_TYPE_LABEL,
} from "@/lib/service";
import { hasQuote, jobHeading, needsClosing } from "@/lib/service-reports";
import { OPEN_JOB_STATUSES, groupJobs, quickFilterCounts, relativeDayLabel } from "@/lib/service-jobs-list";
import type { JobRow } from "@/server/service-data";
import { createJob } from "@/server/service";
import { JobFormModal, type ShowroomPiano } from "@/components/service-forms";
import {
  Chip, Dot, EmptyState, ErrorLine, GhostButton, Money,
  PrimaryButton, SectionCard, Select, TextInput, TONE_TEXT,
} from "@/components/service-ui";

/** The four filters people use daily; everything else lives under "More". */
const PRIMARY_FILTERS = [
  { key: "open", label: "Open" },
  { key: "scheduled", label: "Scheduled" },
  { key: "completed", label: "Completed" },
  { key: "all", label: "All" },
] as const;
const MORE_FILTERS = [
  { key: "closing", label: "Needs closing" },
  ...JOB_STATUSES.filter((s) => !["scheduled", "completed"].includes(s.key)).map((s) => ({ key: s.key, label: s.label })),
];
const PRIMARY_KEYS = new Set<string>(PRIMARY_FILTERS.map((f) => f.key));
const ALL_FILTER_KEYS = new Set<string>([...PRIMARY_FILTERS, ...MORE_FILTERS].map((f) => f.key));
const OPEN_SET = new Set(OPEN_JOB_STATUSES);

const pillStyle = (active: boolean) => ({
  background: active ? "var(--color-svc-accent-soft)" : "var(--color-svc-surface-2)",
  color: active ? TONE_TEXT.azure : "var(--color-svc-text-dim)",
  border: `1px solid ${active ? "var(--color-svc-accent-soft)" : "var(--color-svc-border)"}`,
});
const PILL_CLASS =
  "inline-flex items-center gap-1.5 px-4 min-h-11 rounded-full text-[13px] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-svc-accent)]";

function MorePill({ value, onChange }: { value: string; onChange: (key: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const active = !PRIMARY_KEYS.has(value);
  const activeLabel = MORE_FILTERS.find((f) => f.key === value)?.label;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        aria-pressed={active}
        onClick={() => setOpen((o) => !o)}
        className={PILL_CLASS}
        style={pillStyle(active)}
      >
        {activeLabel ?? "More"} <ChevronDown size={14} aria-hidden="true" />
      </button>
      {open ? (
        <ul
          className="absolute left-0 top-full mt-1.5 z-20 min-w-[11rem] rounded-xl border p-1 shadow-xl"
          style={{ background: "var(--color-svc-surface)", borderColor: "var(--color-svc-border)" }}
        >
          {MORE_FILTERS.map((f) => (
            <li key={f.key}>
              <button
                type="button"
                onClick={() => { onChange(f.key); setOpen(false); }}
                className="w-full text-left px-3 min-h-11 rounded-lg text-[13px] hover:bg-white/[0.06] focus-visible:outline-2 focus-visible:outline-[var(--color-svc-accent)]"
                style={{ color: f.key === value ? TONE_TEXT.azure : "var(--color-svc-text)" }}
              >
                {f.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function GroupHeading({ label, count, danger, as: As = "div" }: { label: string; count: number; danger?: boolean; as?: "div" | "span" }) {
  return (
    <As className="flex items-baseline gap-2">
      <span className="text-[13px] font-medium" style={{ color: danger ? "var(--color-svc-warn)" : "var(--color-svc-text)" }}>{label}</span>
      <span className="text-[12px] tnum" style={{ color: "var(--color-svc-text-dim)" }}>{count}</span>
    </As>
  );
}

export default function JobsClient({
  jobs,
  customers,
  showroomPianos,
  technicians,
  initialNew,
  initialFilter = "open",
}: {
  initialFilter?: string;
  jobs: JobRow[];
  customers: { id: string; name: string; isBatch?: boolean }[];
  showroomPianos: ShowroomPiano[];
  technicians: { id: string; name: string; color: string }[];
  initialNew: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState(() => (ALL_FILTER_KEYS.has(initialFilter) ? initialFilter : "open"));
  const [nowMs] = useState(() => Date.now());
  const [type, setType] = useState("all");
  const [tech, setTech] = useState("all");
  const [query, setQuery] = useState("");
  const [newOpen, setNewOpen] = useState(initialNew);
  const router = useRouter();
  const now = useMemo(() => new Date(nowMs), [nowMs]);
  // One technician means the crew column and filter would repeat the same name on every row.
  const showCrew = technicians.length > 1;
  const hasExtraFilters = query.trim() !== "" || type !== "all" || (showCrew && tech !== "all");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return jobs.filter((j) => {
      if (status === "open" && !OPEN_SET.has(j.status)) return false;
      if (status === "closing" && !needsClosing(j, now)) return false;
      if (status !== "open" && status !== "all" && status !== "closing" && j.status !== status) return false;
      if (type !== "all" && j.serviceType !== type) return false;
      if (showCrew && tech !== "all" && j.technicianId !== tech) return false;
      if (q && ![j.title, j.customerName, j.addressLine ?? "", j.area ?? ""].join(" ").toLowerCase().includes(q))
        return false;
      return true;
    });
  }, [jobs, status, type, tech, query, now, showCrew]);

  const groups = useMemo(() => groupJobs(filtered, now), [filtered, now]);
  const counts = useMemo(() => quickFilterCounts(jobs), [jobs]);

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (res && !res.ok) setError(res.error ?? "Something went wrong.");
    });
  };

  const clearFilters = () => { setQuery(""); setType("all"); setTech("all"); };
  const totalQuoted = filtered.reduce((s, j) => s + j.quotedCents, 0);
  const statusLabel =
    [...PRIMARY_FILTERS, ...MORE_FILTERS].find((f) => f.key === status)?.label ?? "Open";
  const colCount = showCrew ? 7 : 6;

  const emptyHint = hasExtraFilters
    ? `Nothing in "${statusLabel}" matches your ${[
        query.trim() ? `search "${query.trim()}"` : null,
        type !== "all" ? "job type" : null,
        showCrew && tech !== "all" ? "crew" : null,
      ].filter(Boolean).join(", ")}.`
    : status === "all"
      ? "There are no jobs yet. Create the first one."
      : `There are no jobs under "${statusLabel}". Try All to see every job.`;

  const emptyActions = (
    <div className="flex flex-wrap items-center justify-center gap-2">
      {hasExtraFilters ? <GhostButton onClick={clearFilters}>Clear filters</GhostButton> : null}
      {!hasExtraFilters && status !== "all" ? <GhostButton onClick={() => setStatus("all")}>Show all jobs</GhostButton> : null}
      <PrimaryButton onClick={() => setNewOpen(true)}>
        <Plus size={15} /> New job
      </PrimaryButton>
    </div>
  );

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-6 lg:py-8 max-w-[1400px] mx-auto space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[12px] uppercase tracking-[0.2em]" style={{ color: "var(--color-svc-text-faint)" }}>
            Home Service
          </p>
          <h1 className="font-serif text-3xl mt-1" style={{ color: "var(--color-svc-text)" }}>
            Jobs
          </h1>
          <p className="text-[13px] mt-1" style={{ color: "var(--color-svc-text-dim)" }}>
            {filtered.length} shown · <Money cents={totalQuoted} /> quoted
            {hasExtraFilters ? (
              <>
                {" · "}
                <button
                  type="button"
                  onClick={clearFilters}
                  className="underline underline-offset-2 rounded focus-visible:outline-2 focus-visible:outline-[var(--color-svc-accent)]"
                  style={{ color: TONE_TEXT.azure }}
                >
                  Clear filters
                </button>
              </>
            ) : null}
          </p>
        </div>
        <PrimaryButton onClick={() => setNewOpen(true)}>
          <Plus size={15} /> New job
        </PrimaryButton>
      </header>

      <ErrorLine>{error}</ErrorLine>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter by status">
          {PRIMARY_FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              aria-pressed={status === f.key}
              onClick={() => setStatus(f.key)}
              className={PILL_CLASS}
              style={pillStyle(status === f.key)}
            >
              {f.label} <span className="tnum opacity-90">{counts[f.key]}</span>
            </button>
          ))}
          <MorePill value={status} onChange={setStatus} />
        </div>
        <div className="hidden sm:block flex-1" />
        <div className="relative w-full sm:w-auto">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--color-svc-text-faint)" }} aria-hidden="true" />
          <TextInput
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search customer, address…"
            aria-label="Search jobs"
            className="!pl-9 sm:w-56"
          />
        </div>
        <Select value={type} onChange={(e) => setType(e.target.value)} aria-label="Filter by job type" className="sm:!w-auto flex-1 sm:flex-none">
          <option value="all">All types</option>
          {SERVICE_TYPES.map((s) => (
            <option key={s.key} value={s.key}>{s.label}</option>
          ))}
        </Select>
        {showCrew ? (
          <Select value={tech} onChange={(e) => setTech(e.target.value)} aria-label="Filter by crew" className="sm:!w-auto flex-1 sm:flex-none">
            <option value="all">All crew</option>
            {technicians.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </Select>
        ) : null}
      </div>

      <SectionCard>
        {filtered.length === 0 ? (
          <EmptyState
            icon={<ClipboardList size={19} strokeWidth={1.7} />}
            title="No jobs match"
            hint={emptyHint}
            action={emptyActions}
          />
        ) : (
          <>
          {/* Phone: one card per job, grouped, no sideways scrolling */}
          <div className="md:hidden">
            {groups.map((g) => (
              <section key={g.key} aria-label={`${g.label}, ${g.count}`}>
                <h2 className="px-4 py-2 border-y first:border-t-0" style={{ background: "var(--color-svc-surface-2)", borderColor: "var(--color-svc-border)" }}>
                  <GroupHeading label={g.label} count={g.count} danger={g.kind === "closing"} as="span" />
                </h2>
                <ul className="svc-divide">
                  {g.items.map((job) => {
                    const h = jobHeading(job.title, job.serviceType);
                    const closing = needsClosing(job, now);
                    return (
                      <li key={job.id} className="px-4 py-3.5">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <Link href={`/service/jobs/${job.id}`} className="block text-[15px] font-medium leading-snug" style={{ color: "var(--color-svc-text)" }}>
                              {h.heading}
                            </Link>
                            <p className="text-[13px] mt-0.5" style={{ color: "var(--color-svc-text-dim)" }}>
                              {job.customerName}{job.area ? ` · ${job.area}` : ""}
                            </p>
                          </div>
                          <Link
                            href={`/service/jobs/${job.id}`}
                            className="inline-grid place-items-center h-11 w-11 -mr-2 -mt-2 shrink-0 rounded-lg hover:bg-white/[0.06] focus-visible:outline-2 focus-visible:outline-[var(--color-svc-accent)]"
                            style={{ color: TONE_TEXT.azure }}
                            aria-label={`Open ${h.heading} for ${job.customerName}`}
                          >
                            <ArrowUpRight size={16} aria-hidden="true" />
                          </Link>
                        </div>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 mt-2 text-[13px]" style={{ color: "var(--color-svc-text-dim)" }}>
                          <span className="tnum" style={{ color: job.scheduledStart ? "var(--color-svc-text)" : "var(--color-svc-text-faint)" }}>
                            {job.scheduledStart ? `${relativeDayLabel(job.scheduledStart, now)} · ${fmtTime(new Date(job.scheduledStart))}` : "Unscheduled"}
                          </span>
                          <Chip tone={JOB_STATUS_TONE[job.status] ?? "slate"}>{JOB_STATUS_LABEL[job.status] ?? job.status}</Chip>
                          {closing ? <Chip tone="warn">Needs closing</Chip> : null}
                          {job.runningLog ? <span style={{ color: "var(--color-svc-warn)" }}>● live</span> : null}
                          {showCrew && job.technicianName ? (
                            <span className="inline-flex items-center gap-1.5"><Dot color={job.technicianColor ?? "#64748b"} /> {job.technicianName}</span>
                          ) : null}
                          {hasQuote(job.quotedCents) ? <Money cents={job.quotedCents} className="ml-auto" /> : null}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>

          {/* Desktop: one table, a heading row per group. The page scrolls, not the card. */}
          <div className="hidden md:block svc-table-wrap thin-scroll" style={{ maxHeight: "none", overflowY: "visible" }}>
            <table className="svc-table w-full text-left">
              <thead>
                <tr style={{ color: "var(--color-svc-text-faint)" }}>
                  {["When", "Customer / job", ...(showCrew ? ["Crew"] : []), "Type", "Status", "Quote", ""].map((h, i) => (
                    <th
                      key={`${h}-${i}`}
                      className="px-5 py-2.5 text-[12px] uppercase tracking-[0.08em] font-normal whitespace-nowrap"
                    >
                      {h || <span className="sr-only">Actions</span>}
                    </th>
                  ))}
                </tr>
              </thead>
              {groups.map((g) => (
                <tbody key={g.key} className="svc-divide">
                  <tr>
                    <th
                      colSpan={colCount}
                      scope="colgroup"
                      className="px-5 py-2 text-left font-normal border-y"
                      style={{ background: "var(--color-svc-surface)", borderColor: "var(--color-svc-border)", position: "static" }}
                    >
                      <GroupHeading label={g.label} count={g.count} danger={g.kind === "closing"} />
                    </th>
                  </tr>
                  {g.items.map((job) => {
                    const h = jobHeading(job.title, job.serviceType);
                    const closing = needsClosing(job, now);
                    return (
                      <tr
                        key={job.id}
                        onClick={(e) => { if (!(e.target as HTMLElement).closest("a,button,select,input")) router.push(`/service/jobs/${job.id}`); }}
                        className="group transition hover:bg-white/[0.04] cursor-pointer"
                      >
                        <td className="px-5 py-3 whitespace-nowrap">
                          {job.scheduledStart ? (
                            <>
                              <p className="text-[13px] tnum" style={{ color: "var(--color-svc-text)" }}>
                                {relativeDayLabel(job.scheduledStart, now)}
                              </p>
                              <p className="text-[12px] tnum" style={{ color: "var(--color-svc-text-dim)" }}>
                                {fmtTime(new Date(job.scheduledStart))}
                              </p>
                            </>
                          ) : (
                            <span className="text-[12px]" style={{ color: "var(--color-svc-text-faint)" }}>
                              Unscheduled
                            </span>
                          )}
                        </td>
                        <td className="px-5 py-3 max-w-[320px]">
                          <Link href={`/service/jobs/${job.id}`} className="text-[14px] hover:underline" style={{ color: "var(--color-svc-text)" }}>
                            {h.heading}
                          </Link>
                          <p className="text-[12px] truncate" style={{ color: "var(--color-svc-text-dim)" }} title={h.sub ? `${h.sub} — ${job.customerName}` : undefined}>
                            {job.customerName}
                            {job.area ? ` · ${job.area}` : ""}
                            {h.sub ? <span style={{ color: "var(--color-svc-text-faint)" }}> · “{h.sub}”</span> : null}
                          </p>
                        </td>
                        {showCrew ? (
                          <td className="px-5 py-3 whitespace-nowrap">
                            {job.technicianName ? (
                              <span className="inline-flex items-center gap-1.5 text-[12px]" style={{ color: "var(--color-svc-text-dim)" }}>
                                <Dot color={job.technicianColor ?? "#64748b"} /> {job.technicianName}
                              </span>
                            ) : (
                              <span className="text-[12px]" style={{ color: "var(--color-svc-text-faint)" }}>Unassigned</span>
                            )}
                          </td>
                        ) : null}
                        <td className="px-5 py-3 whitespace-nowrap text-[12px]" style={{ color: "var(--color-svc-text-dim)" }}>
                          {job.jobType === "sale" ? "Piano sale" : SERVICE_TYPE_LABEL[job.serviceType] ?? job.serviceType}
                        </td>
                        <td className="px-5 py-3 whitespace-nowrap">
                          <Chip tone={JOB_STATUS_TONE[job.status] ?? "slate"}>
                            {JOB_STATUS_LABEL[job.status] ?? job.status}
                          </Chip>
                          {closing ? <span className="ml-1.5 align-middle"><Chip tone="warn">Needs closing</Chip></span> : null}
                          {job.runningLog ? (
                            <span className="ml-1.5 text-[12px]" style={{ color: "var(--color-svc-warn)" }}>
                              ● live
                            </span>
                          ) : null}
                        </td>
                        <td className="px-5 py-3 whitespace-nowrap">
                          {hasQuote(job.quotedCents)
                            ? <Money cents={job.quotedCents} className="text-[14px]" />
                            : <span className="text-[13px]" style={{ color: "var(--color-svc-text-dim)" }} aria-label="No quote">—</span>}
                        </td>
                        <td className="px-5 py-3 text-right whitespace-nowrap">
                          <Link
                            href={`/service/jobs/${job.id}`}
                            className="inline-grid place-items-center h-11 w-11 rounded-lg hover:bg-white/[0.06] focus-visible:outline-2 focus-visible:outline-[var(--color-svc-accent)]"
                            style={{ color: TONE_TEXT.azure }}
                            aria-label={`Open ${h.heading} for ${job.customerName}`}
                          >
                            <ArrowUpRight size={14} />
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              ))}
            </table>
          </div>
          </>
        )}
      </SectionCard>

      <JobFormModal
        open={newOpen}
        mode="new"
        onClose={() => setNewOpen(false)}
        customers={customers}
        showroomPianos={showroomPianos}
        technicians={technicians}
        pending={pending}
        onSubmit={(values) => run(() => createJob(values))}
      />

    </div>
  );
}
