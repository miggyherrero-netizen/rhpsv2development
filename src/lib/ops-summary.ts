/**
 * Daily Operations Summary — pure shaping + priority rules. No DB, no React, no AI.
 * The loader (src/server/ops-summary-data.ts) feeds it rows from the EXISTING reads; money is passed
 * through exactly as those reads return it (integer centavos) and is never recomputed here.
 * Rules: waitlist / recall rows are never "overdue" (no day counts, no red wording); invoices may be.
 */
import { startOfManilaDayUTC } from "@/lib/dates";

const DAY_MS = 86_400_000;

export type OpsJob = { id: string; title: string; serviceType: string; status: string; scheduledStart: Date | null; customerName: string; area: string | null; pianoLabel: string | null };
export type OpsReminder = { id: string; customerName: string; note: string | null; dueAt: Date };
export type OpsRecall = { pianoId: string; pianoLabel: string | null; customerName: string; nextServiceDueAt: Date; pianoInfoMissing?: boolean };
export type OpsInvoice = { id: string; code: string; customerName: string; balanceCents: number; dueDate: Date | null; daysOverdue: number; status: string };
export type OpsTask = { id: string; title: string; status: string; priority: string; dueDate: Date | null; waitingParts: boolean; assigneeNames: string[]; projectName: string | null };
export type OpsProject = { id: string; clientName: string; pianoName: string; status: string; progress: number; dueDate: Date | null; workerName: string | null; openTasks: number };

export type OpsSummaryInput = {
  now: Date;
  jobsToday: OpsJob[];
  unfinishedJobs: OpsJob[];
  next7Count: number;
  reminders: OpsReminder[];
  recalls: OpsRecall[];
  unpaid: OpsInvoice[];
  draftInvoices: { count: number; totalCents: number };
  outstandingCents: number;
  overdueCents: number;
  tasks: OpsTask[];
  projects: OpsProject[];
};

export type Priority = { key: string; label: string; severity: "high" | "medium" | "info"; count: number; amountCents?: number };

export type OpsSummary = {
  generatedAt: string;
  dateManila: string;
  appointments: { count: number; items: { id: string; time: string; serviceType: string; status: string; customerName: string; area: string | null; piano: string; title: string }[] };
  closeOut: { count: number; items: { id: string; title: string; customerName: string; status: string }[] };
  followUps: { count: number; items: { id: string; customerName: string; note: string | null; state: "overdue" | "today" }[] };
  workshop: {
    openProjects: number;
    openTasks: number;
    unassignedTasks: number;
    waitingPartsTasks: number;
    overdueTasks: number;
    items: { id: string; title: string; status: string; priority: string; assignees: string[]; project: string | null; overdue: boolean }[];
    projects: { id: string; client: string; piano: string; status: string; progress: number; worker: string | null; openTasks: number }[];
  };
  financial: {
    outstandingCents: number;
    overdueCents: number;
    draftCount: number;
    draftCents: number;
    items: { id: string; code: string; customerName: string; balanceCents: number; daysOverdue: number; status: string }[];
  };
  maintenance: { count: number; items: { pianoId: string; piano: string; customerName: string; timing: "date passed" | "today" | "upcoming"; dueDate: string }[] };
  priorities: Priority[];
  missing: string[];
};

const manilaDate = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const manilaTime = (d: Date | null) => (d ? new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Manila", hour: "numeric", minute: "2-digit", hour12: true }).format(d) : "time not set");

const titleOr = (s: string | null | undefined, fallback: string) => (s && s.trim() ? s.trim() : fallback);

export const DONE_TASK_STATUSES = ["done"];
const PRIORITY_RANK: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

export function buildOpsSummary(input: OpsSummaryInput): OpsSummary {
  const dayStart = startOfManilaDayUTC(input.now);
  const dayEnd = new Date(dayStart.getTime() + DAY_MS);

  const jobsToday = [...input.jobsToday].sort((a, b) => (a.scheduledStart?.getTime() ?? Infinity) - (b.scheduledStart?.getTime() ?? Infinity));
  const appointments = {
    count: jobsToday.length,
    items: jobsToday.map((j) => ({
      id: j.id, time: manilaTime(j.scheduledStart), serviceType: j.serviceType, status: j.status,
      customerName: j.customerName, area: j.area, piano: titleOr(j.pianoLabel, "Piano (info needed)"), title: j.title,
    })),
  };

  const closeOut = { count: input.unfinishedJobs.length, items: input.unfinishedJobs.map((j) => ({ id: j.id, title: j.title, customerName: j.customerName, status: j.status })) };

  // Manual reminders only: these are the one follow-up kind that may be called overdue (existing reminderState rule).
  const followUpItems = input.reminders
    .filter((r) => r.dueAt.getTime() < dayEnd.getTime())
    .sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime())
    .map((r) => ({ id: r.id, customerName: r.customerName, note: r.note, state: (r.dueAt.getTime() < dayStart.getTime() ? "overdue" : "today") as "overdue" | "today" }));
  const followUps = { count: followUpItems.length, items: followUpItems };

  const openTasks = input.tasks.filter((t) => !DONE_TASK_STATUSES.includes(t.status));
  const taskItems = openTasks
    .map((t) => ({
      id: t.id, title: t.title, status: t.status, priority: t.priority, assignees: t.assigneeNames, project: t.projectName,
      overdue: !!t.dueDate && t.dueDate.getTime() < dayStart.getTime(),
      rank: PRIORITY_RANK[t.priority] ?? 2,
    }))
    .sort((a, b) => Number(b.overdue) - Number(a.overdue) || a.rank - b.rank)
    .map(({ rank: _rank, ...rest }) => rest);
  const openProjects = input.projects.filter((p) => p.status !== "completed" && p.status !== "delivered" && p.progress < 100);
  const workshop = {
    openProjects: openProjects.length,
    openTasks: openTasks.length,
    unassignedTasks: openTasks.filter((t) => t.assigneeNames.length === 0).length,
    waitingPartsTasks: openTasks.filter((t) => t.waitingParts).length,
    overdueTasks: taskItems.filter((t) => t.overdue).length,
    items: taskItems.slice(0, 25),
    projects: openProjects.slice(0, 15).map((p) => ({ id: p.id, client: p.clientName, piano: p.pianoName, status: p.status, progress: p.progress, worker: p.workerName, openTasks: p.openTasks })),
  };

  const unpaid = input.unpaid.filter((i) => i.balanceCents > 0).sort((a, b) => b.daysOverdue - a.daysOverdue || b.balanceCents - a.balanceCents);
  const financial = {
    outstandingCents: input.outstandingCents,
    overdueCents: input.overdueCents,
    draftCount: input.draftInvoices.count,
    draftCents: input.draftInvoices.totalCents,
    items: unpaid.slice(0, 15).map((i) => ({ id: i.id, code: i.code, customerName: i.customerName, balanceCents: i.balanceCents, daysOverdue: i.daysOverdue, status: i.status })),
  };

  // Recalls: neutral wording only — never "overdue", never a day count.
  const maintItems = [...input.recalls]
    .sort((a, b) => a.nextServiceDueAt.getTime() - b.nextServiceDueAt.getTime())
    .map((r) => {
      const due = r.nextServiceDueAt.getTime();
      const timing: "date passed" | "today" | "upcoming" = due < dayStart.getTime() ? "date passed" : due < dayEnd.getTime() ? "today" : "upcoming";
      return { pianoId: r.pianoId, piano: titleOr(r.pianoLabel, "Piano (info needed)"), customerName: r.customerName, timing, dueDate: manilaDate(r.nextServiceDueAt) };
    });
  const maintenance = { count: maintItems.length, items: maintItems.slice(0, 15) };

  const overdueInvoices = unpaid.filter((i) => i.daysOverdue > 0);
  const overdueTotal = overdueInvoices.reduce((n, i) => n + i.balanceCents, 0);
  const priorities: Priority[] = [];
  if (closeOut.count) priorities.push({ key: "closeout", label: "Visits past their date still open: close them out", severity: "high", count: closeOut.count });
  if (overdueInvoices.length) priorities.push({ key: "overdue-invoices", label: "Overdue invoices to chase", severity: "high", count: overdueInvoices.length, amountCents: overdueTotal });
  if (appointments.count) priorities.push({ key: "appointments", label: "Visits scheduled today", severity: "medium", count: appointments.count });
  if (followUps.count) priorities.push({ key: "followups", label: "Client follow-ups due", severity: "medium", count: followUps.count });
  if (workshop.overdueTasks) priorities.push({ key: "workshop-overdue", label: "Workshop tasks past their due date", severity: "medium", count: workshop.overdueTasks });
  if (workshop.unassignedTasks) priorities.push({ key: "workshop-unassigned", label: "Open workshop tasks with nobody assigned", severity: "medium", count: workshop.unassignedTasks });
  if (financial.draftCount) priorities.push({ key: "drafts", label: "Draft invoices not sent yet", severity: "medium", count: financial.draftCount, amountCents: financial.draftCents });
  if (maintenance.count) priorities.push({ key: "recalls", label: "Pianos due for their next tuning", severity: "info", count: maintenance.count });
  const rank = { high: 0, medium: 1, info: 2 } as const;
  priorities.sort((a, b) => rank[a.severity] - rank[b.severity]);

  const missing: string[] = [];
  if (jobsToday.some((j) => !j.scheduledStart)) missing.push("Some visits today have no start time.");
  if (input.recalls.some((r) => !r.pianoLabel || r.pianoInfoMissing)) missing.push("Some pianos have no brand/model recorded.");
  if (!input.tasks.length && !input.projects.length) missing.push("No workshop projects or tasks were found.");

  return {
    generatedAt: input.now.toISOString(),
    dateManila: manilaDate(input.now),
    appointments, closeOut, followUps, workshop, financial, maintenance, priorities: priorities.slice(0, 8), missing,
  };
}

export const isEmptyDay = (s: OpsSummary) => s.priorities.length === 0;

export const pesos = (cents: number) =>
  `₱${(cents / 100).toLocaleString("en-PH", { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;

/** Plain-text version of the facts, used for "Copy" and as the AI-free fallback report. */
export function summaryToText(s: OpsSummary): string {
  const out: string[] = [`RHPS Daily Operations Summary — ${s.dateManila}`, ""];
  out.push(`Today's visits (${s.appointments.count})`);
  s.appointments.items.forEach((a) => out.push(`- ${a.time} · ${a.serviceType} · ${a.customerName} · ${a.piano} [${a.status}]`));
  if (s.closeOut.count) { out.push("", `Past-date visits still open (${s.closeOut.count})`); s.closeOut.items.forEach((j) => out.push(`- ${j.title} · ${j.customerName} [${j.status}]`)); }
  out.push("", `Client follow-ups due (${s.followUps.count})`);
  s.followUps.items.forEach((f) => out.push(`- ${f.customerName} (${f.state})${f.note ? ` — ${f.note}` : ""}`));
  out.push("", `Workshop: ${s.workshop.openProjects} open projects, ${s.workshop.openTasks} open tasks, ${s.workshop.unassignedTasks} unassigned, ${s.workshop.overdueTasks} past due`);
  out.push("", `Money: outstanding ${pesos(s.financial.outstandingCents)}, overdue ${pesos(s.financial.overdueCents)}, ${s.financial.draftCount} drafts (${pesos(s.financial.draftCents)})`);
  s.financial.items.forEach((i) => out.push(`- ${i.code} · ${i.customerName} · ${pesos(i.balanceCents)}${i.daysOverdue > 0 ? ` · ${i.daysOverdue} days overdue` : ""}`));
  out.push("", `Piano maintenance (${s.maintenance.count})`);
  s.maintenance.items.forEach((m) => out.push(`- ${m.piano} · ${m.customerName} · ${m.timing} (${m.dueDate})`));
  out.push("", "Priorities");
  if (!s.priorities.length) out.push("- Nothing needs attention right now.");
  s.priorities.forEach((p, i) => out.push(`${i + 1}. ${p.label} (${p.count}${p.amountCents != null ? `, ${pesos(p.amountCents)}` : ""})`));
  if (s.missing.length) { out.push("", "Missing information"); s.missing.forEach((m) => out.push(`- ${m}`)); }
  return out.join("\n");
}
