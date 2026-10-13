import Link from "next/link";
import { CalendarClock, Check, Info, Wrench } from "lucide-react";
import { fmtDate } from "@/lib/format";
import { EmptyState, Chip, PianoInfoBadge, SectionCard, StatCard } from "@/components/service-ui";
import type { MaintenanceRow, MaintenanceOverview } from "@/server/maintenance-data";
import type { MaintenanceChannel, MaintenanceStage, MaintenanceTiming } from "@/lib/maintenance-policy";

const STAGE_LABEL: Record<MaintenanceStage, string> = { d30: "30 days before", d7: "7 days before", due: "Due day" };
const CHANNEL_LABEL: Record<MaintenanceChannel, string> = { manual: "Manual", email: "E-mail", sms: "SMS" };
const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-svc-accent)]";
const DIM = { color: "var(--color-svc-text-dim)" } as const;
const FAINT = { color: "var(--color-svc-text-faint)" } as const;

/** Past dates are never red here: a recall whose day has passed is just "Due date passed" (amber), like the waitlist. */
function DueChip({ row }: { row: MaintenanceRow }) {
  if (row.timing === "past") return <Chip tone="warn">Due date passed</Chip>;
  if (row.timing === "today") return <Chip tone="azure">Due today</Chip>;
  return <Chip tone="slate">In {row.daysToDue} day{row.daysToDue === 1 ? "" : "s"}</Chip>;
}

const stageWord = (t: MaintenanceTiming) => (t === "past" ? "date passed" : t === "today" ? "today" : "upcoming");

function Row({ row }: { row: MaintenanceRow }) {
  return (
    <li className="px-4 sm:px-5 py-4 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <Link href={`/service/customers/${row.customerId}`} className={`inline-flex items-center min-h-11 text-[16px] font-semibold break-words hover:underline rounded-sm ${FOCUS}`} style={{ color: "var(--color-svc-text)" }}>
            {row.customerName}
          </Link>
          <p className="text-[14px] flex flex-wrap items-center gap-2" style={DIM}>
            {row.pianoLabel} <PianoInfoBadge piano={row.pianoBrandModel} />
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="svc-num text-[14px]" style={DIM}>{fmtDate(row.dueAt)}</span>
          <DueChip row={row} />
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <p className="text-[12px] uppercase tracking-[0.1em] mb-1.5" style={FAINT}>Planned reminders</p>
          <ul className="space-y-1">
            {row.stages.map((s) => (
              <li key={s.stage} className="text-[13px] flex flex-wrap items-baseline gap-x-2" style={DIM}>
                <span style={{ color: "var(--color-svc-text)" }}>{STAGE_LABEL[s.stage]}</span>
                <span className="svc-num">{fmtDate(s.scheduledAt)}</span>
                <span style={FAINT}>· {stageWord(s.timing)}</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="text-[12px] uppercase tracking-[0.1em] mb-1.5" style={FAINT}>Could be prepared by</p>
          <ul className="space-y-1">
            {(Object.keys(CHANNEL_LABEL) as MaintenanceChannel[]).map((ch) => {
              const st = row.channels[ch];
              return (
                <li key={ch} className="text-[13px] flex flex-wrap items-center gap-x-2" style={DIM}>
                  <span className="inline-flex items-center gap-1.5 min-w-[4.5rem]" style={{ color: "var(--color-svc-text)" }}>
                    {st.ready ? <Check size={13} aria-hidden="true" style={{ color: "var(--color-svc-success)" }} /> : <span className="w-[13px]" aria-hidden="true">–</span>}
                    {CHANNEL_LABEL[ch]}
                  </span>
                  <span>{st.ready ? "Ready" : st.reason}</span>
                </li>
              );
            })}
          </ul>
        </div>
      </div>

      <p className="text-[13px]" style={FAINT}>
        {row.entryId
          ? <>On the waitlist as {row.booked ? "booked" : row.entryStatus} · <Link href="/service/waitlist" className={`inline-flex items-center min-h-11 hover:underline rounded-sm ${FOCUS}`} style={{ color: "var(--color-svc-accent-text, var(--color-svc-accent))" }}>Open waitlist</Link></>
          : "No recall entry on the waitlist yet"}
      </p>
    </li>
  );
}

/** Maintenance (Phase 1): a read-only preview. It adds the reminder plan and channel eligibility; the recall list itself lives on Today / Waitlist. */
export default function MaintenanceView({ overview }: { overview: MaintenanceOverview }) {
  const { rows } = overview;
  return (
    <div className="px-4 sm:px-6 lg:px-8 py-6 lg:py-8 app-page app-page-narrow [--page-w:1000px] space-y-5">
      <header>
        <p className="text-[12px] uppercase tracking-[0.2em]" style={FAINT}>Home Service</p>
        <h1 className="font-serif text-3xl mt-1" style={{ color: "var(--color-svc-text)" }}>Maintenance</h1>
        <p className="text-[13px] mt-1" style={DIM}>Read-only preview. Nothing is sent from here; this shows which reminders would apply to each piano coming due.</p>
      </header>

      <div className="card-svc p-4 flex items-start gap-3" role="note">
        <Info size={16} aria-hidden="true" className="mt-0.5 shrink-0" style={{ color: "var(--color-svc-accent-text, var(--color-svc-accent))" }} />
        <p className="text-[13px]" style={DIM}>
          E-mail and SMS need recorded consent and an address; without consent only manual follow-up is ready. The pianos are the same recalls as on Today and the Waitlist (due within 30 days, or already past).
          {!overview.preferencesAvailable ? " The consent table is not set up yet (drizzle/manual/12_maintenance_notifications.sql), so everyone reads as no consent recorded." : ""}
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <StatCard label="In the next 30 days" value={overview.upcoming} sub="due today or ahead" icon={<CalendarClock size={16} aria-hidden="true" />} />
        <StatCard label="Due date passed" value={overview.datePassed} sub="ready for follow-up" tone="warn" />
        <StatCard label="E-mail / SMS ready" value={overview.electronicReady} sub="needs consent + address" />
      </div>

      {rows.length === 0 ? (
        <SectionCard>
          <EmptyState
            icon={<Wrench size={19} strokeWidth={1.7} />}
            title="No pianos due in the next 30 days"
            hint="When a tuning is completed or paid, the piano's next service date is set and it shows up here as it comes due."
          />
        </SectionCard>
      ) : (
        <SectionCard title={`Pianos coming due · ${rows.length}`}>
          <ul className="svc-divide">{rows.map((r) => <Row key={r.pianoId} row={r} />)}</ul>
          {overview.truncated ? <p className="px-5 py-3 text-[12px]" style={FAINT}>Showing the first 200.</p> : null}
        </SectionCard>
      )}
    </div>
  );
}
