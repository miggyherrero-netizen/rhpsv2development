/**
 * Home-service **reads**. Every query lives here so pages stay thin and Server Actions
 * stay write-only. Amounts are integer centavos; dates are UTC instants rendered in
 * Asia/Manila by the format helpers.
 */

import { db } from "@/db";
import {
  serviceTechnicians, serviceCustomers, serviceLocations, servicePianos, serviceCatalog,
  serviceJobs, serviceJobItems, serviceJobEvents, serviceTimeLogs, serviceInvoices,
  serviceInvoiceItems, servicePayments, serviceExpenses, serviceSettings, pianos,
  type ServiceTechnician, type ServiceCustomer, type ServiceLocation, type ServicePiano,
  type ServiceCatalogItem, type ServiceJob, type ServiceJobItem, type ServiceJobEvent,
  type ServiceTimeLog, type ServiceInvoice, type ServiceInvoiceItem, type ServicePayment,
  type ServiceExpense, type ServiceSetting,
} from "@/db/schema";
import { and, asc, desc, eq, gte, lt, isNull, isNotNull, or, ne, sql, inArray, type SQL } from "drizzle-orm";
import { SERVED_STATUSES, lastServiceDate } from "@/lib/service-last-service";
import { startOfManilaDayUTC, addDays, expandRecurrence } from "@/lib/dates";
import { addManilaDays, daysSince, isStaleQuote, manilaWeekBounds } from "@/lib/service-today";
import { messengerHandle } from "@/lib/service-flow";
import { effectiveKind, financeSplit, type FinanceSplit, type SaleLine } from "@/lib/service-finance-split";
import { saleBalanceCents, salePianoProfit } from "@/lib/service-sale";
import {
  avgInvoiceCents, balanceCents, computeTotals, daysOverdue, invoiceCode, invoiceStatus, jobCode,
  jobMargin, DEFAULT_WORKING_HOURS, COMPLETED_JOB_STATUSES,
  type AgingSummary, type AvgInvoiceBasis, type WorkingHours,
} from "@/lib/service";
import {
  titleCaseName, isBatchCustomer, billedCents, countable, draftSummary, financeRollup, inRange, isCountable, needsClosing, needsFollowUp, receivables,
  resolveRange, type RangeKey, type ResolvedRange, type SeriesPoint,
} from "@/lib/service-reports";

/* ============================================================
 * Settings, crew, price book
 * ============================================================ */

export type ServiceSettings = ServiceSetting & { workingHours: WorkingHours; avgInvoiceBasis: AvgInvoiceBasis };

/** Settings row is created on first access so pages can rely on it existing. */
export async function getServiceSettings(ownerId: string): Promise<ServiceSettings> {
  const [row] = await db.select().from(serviceSettings).where(eq(serviceSettings.ownerId, ownerId)).limit(1);
  if (row) return row as ServiceSettings;
  const [created] = await db
    .insert(serviceSettings)
    .values({ ownerId, workingHours: DEFAULT_WORKING_HOURS })
    .onConflictDoNothing()
    .returning();
  if (created) return created as ServiceSettings;
  const [existing] = await db.select().from(serviceSettings).where(eq(serviceSettings.ownerId, ownerId)).limit(1);
  return existing as ServiceSettings;
}

export async function getTechnicians(activeOnly = false): Promise<ServiceTechnician[]> {
  return db
    .select()
    .from(serviceTechnicians)
    .where(activeOnly ? eq(serviceTechnicians.active, true) : undefined)
    .orderBy(asc(serviceTechnicians.name));
}

export async function getCatalog(activeOnly = false): Promise<ServiceCatalogItem[]> {
  return db
    .select()
    .from(serviceCatalog)
    .where(activeOnly ? eq(serviceCatalog.active, true) : undefined)
    .orderBy(asc(serviceCatalog.position), asc(serviceCatalog.name));
}

/* ============================================================
 * Customers, locations, pianos
 * ============================================================ */

export type CustomerLocation = ServiceLocation;
export type CustomerPiano = ServicePiano & { locationLabel: string | null };

export type CustomerCard = ServiceCustomer & {
  locations: CustomerLocation[];
  pianos: CustomerPiano[];
  jobCount: number;
  openJobCount: number;
  lastServiceAt: Date | null;
  billedCents: number;
  paidCents: number;
  outstandingCents: number;
  /** Invoices created but never sent — reported apart from billed / outstanding. */
  draftCount: number;
  draftCents: number;
};

export async function getCustomersBundle(includeArchived = false): Promise<CustomerCard[]> {
  const [customers, locations, pianos] = await Promise.all([
    db.select().from(serviceCustomers)
      .where(includeArchived ? undefined : isNull(serviceCustomers.archivedAt))
      .orderBy(asc(serviceCustomers.name)),
    db.select().from(serviceLocations).orderBy(asc(serviceLocations.label)),
    db.select().from(servicePianos).orderBy(asc(servicePianos.brand)),
  ]);

  const jobStats = await db
    .select({
      customerId: serviceJobs.customerId,
      total: sql<number>`count(*)::int`,
      open: sql<number>`count(*) filter (where ${serviceJobs.status} in ('lead','quoted','scheduled','en_route','in_progress','on_hold'))::int`,
    })
    .from(serviceJobs)
    .groupBy(serviceJobs.customerId);

  // Finished visits only (any status that means the work happened) — dated per `lastServiceDate`.
  const servedJobs = await db
    .select({
      customerId: serviceJobs.customerId, status: serviceJobs.status, jobType: serviceJobs.jobType,
      completedAt: serviceJobs.completedAt, startedAt: serviceJobs.startedAt,
      scheduledStart: serviceJobs.scheduledStart, invoicedAt: serviceJobs.invoicedAt,
    })
    .from(serviceJobs)
    .where(inArray(serviceJobs.status, [...SERVED_STATUSES]));
  const servedByCustomer = new Map<string, typeof servedJobs>();
  for (const j of servedJobs) servedByCustomer.set(j.customerId, [...(servedByCustomer.get(j.customerId) ?? []), j]);

  // Drafts and voids are not receivables: only sent / part-paid / paid invoices count as billed.
  const invoiceRows = await db
    .select({
      customerId: serviceInvoices.customerId, status: serviceInvoices.status,
      totalCents: serviceInvoices.totalCents, amountPaidCents: serviceInvoices.amountPaidCents,
      dueDate: serviceInvoices.dueDate, sentAt: serviceInvoices.sentAt, voidedAt: serviceInvoices.voidedAt,
    })
    .from(serviceInvoices);
  const now = new Date();
  const moneyStats = new Map<string, { billed: number; paid: number; outstanding: number; draftCount: number; draftCents: number }>();
  for (const inv of invoiceRows) {
    const m = moneyStats.get(inv.customerId) ?? { billed: 0, paid: 0, outstanding: 0, draftCount: 0, draftCents: 0 };
    if (isCountable(inv, now)) {
      m.billed += inv.totalCents;
      m.paid += inv.amountPaidCents;
      m.outstanding += balanceCents(inv);
    } else if (invoiceStatus(inv, now) === "draft") {
      m.draftCount += 1;
      m.draftCents += inv.totalCents;
    }
    moneyStats.set(inv.customerId, m);
  }

  const jobMap = new Map(jobStats.map((j) => [j.customerId, j]));
  const locationMap = new Map(locations.map((l) => [l.id, l]));

  return customers.map((c) => {
    const jobs = jobMap.get(c.id);
    const money = moneyStats.get(c.id);
    return {
      ...c,
      name: titleCaseName(c.name),
      locations: locations.filter((l) => l.customerId === c.id),
      pianos: pianos
        .filter((p) => p.customerId === c.id)
        .map((p) => ({ ...p, locationLabel: p.locationId ? locationMap.get(p.locationId)?.label ?? null : null })),
      jobCount: jobs?.total ?? 0,
      openJobCount: jobs?.open ?? 0,
      lastServiceAt: lastServiceDate(
        servedByCustomer.get(c.id) ?? [],
        pianos.filter((p) => p.customerId === c.id),
      ),
      billedCents: money?.billed ?? 0,
      paidCents: money?.paid ?? 0,
      outstandingCents: money?.outstanding ?? 0,
      draftCount: money?.draftCount ?? 0,
      draftCents: money?.draftCents ?? 0,
    };
  });
}

export type RecallRow = {
  pianoId: string;
  pianoLabel: string;
  customerId: string;
  customerName: string;
  phone: string | null;
  area: string | null;
  addressLine: string | null;
  nextServiceDueAt: Date;
  daysUntilDue: number;
  lastServiceAt: Date | null;
};

/** Pianos due (or overdue) for their next tuning — the single best source of repeat work. */
export async function getRecalls(now: Date = new Date(), leadDays = 30): Promise<RecallRow[]> {
  const horizon = addDays(now, leadDays);
  const rows = await db
    .select({ piano: servicePianos, customer: serviceCustomers, location: serviceLocations })
    .from(servicePianos)
    .innerJoin(serviceCustomers, eq(serviceCustomers.id, servicePianos.customerId))
    .leftJoin(serviceLocations, eq(serviceLocations.id, servicePianos.locationId))
    .where(and(isNotNull(servicePianos.nextServiceDueAt), lt(servicePianos.nextServiceDueAt, horizon)))
    .orderBy(asc(servicePianos.nextServiceDueAt));

  const dayMs = 86_400_000;
  return rows.map(({ piano, customer, location }) => ({
    pianoId: piano.id,
    pianoLabel: [piano.brand, piano.model].filter(Boolean).join(" ") || piano.type,
    customerId: customer.id,
    customerName: titleCaseName(customer.name),
    phone: customer.phone,
    area: location?.area ?? null,
    addressLine: location?.addressLine ?? null,
    nextServiceDueAt: piano.nextServiceDueAt!,
    daysUntilDue: Math.round((piano.nextServiceDueAt!.getTime() - now.getTime()) / dayMs),
    lastServiceAt: piano.lastServiceAt,
  }));
}

/* ============================================================
 * Jobs
 * ============================================================ */

export type JobRow = ServiceJob & {
  customerName: string;
  customerPhone: string | null;
  locationLabel: string | null;
  addressLine: string | null;
  area: string | null;
  technicianName: string | null;
  technicianColor: string | null;
  pianoLabel: string | null;
  itemCount: number;
  /** Running time log, if a technician is currently on the clock for this job. */
  runningLog: { id: string; kind: string; startedAt: Date; technicianId: string | null } | null;
};

const jobSelect = {
  job: serviceJobs,
  customerName: serviceCustomers.name,
  customerPhone: serviceCustomers.phone,
  locationLabel: serviceLocations.label,
  addressLine: serviceLocations.addressLine,
  area: serviceLocations.area,
  technicianName: serviceTechnicians.name,
  technicianColor: serviceTechnicians.color,
  pianoBrand: servicePianos.brand,
  pianoModel: servicePianos.model,
  pianoType: servicePianos.type,
};

function toJobRow(r: {
  job: ServiceJob; customerName: string; customerPhone: string | null; locationLabel: string | null;
  addressLine: string | null; area: string | null; technicianName: string | null;
  technicianColor: string | null; pianoBrand: string | null; pianoModel: string | null;
  pianoType: string | null;
}, running: Map<string, { id: string; kind: string; startedAt: Date; technicianId: string | null }>): JobRow {
  return {
    ...r.job,
    customerName: titleCaseName(r.customerName),
    customerPhone: r.customerPhone,
    locationLabel: r.locationLabel,
    addressLine: r.addressLine,
    area: r.area,
    technicianName: r.technicianName,
    technicianColor: r.technicianColor,
    pianoLabel: r.pianoBrand ? [r.pianoBrand, r.pianoModel].filter(Boolean).join(" ") : null,
    itemCount: 0,
    runningLog: running.get(r.job.id) ?? null,
  };
}

export type JobFilter = {
  statuses?: string[];
  serviceType?: string;
  technicianId?: string;
  customerId?: string;
  from?: Date;
  to?: Date;
  search?: string;
  limit?: number;
};

export async function getJobs(filter: JobFilter = {}): Promise<JobRow[]> {
  const clauses: (SQL | undefined)[] = [];
  if (filter.statuses?.length) clauses.push(inArray(serviceJobs.status, filter.statuses));
  if (filter.serviceType) clauses.push(eq(serviceJobs.serviceType, filter.serviceType));
  if (filter.technicianId) clauses.push(eq(serviceJobs.technicianId, filter.technicianId));
  if (filter.customerId) clauses.push(eq(serviceJobs.customerId, filter.customerId));
  if (filter.from) clauses.push(gte(serviceJobs.scheduledStart, filter.from));
  if (filter.to) clauses.push(lt(serviceJobs.scheduledStart, filter.to));
  if (filter.search) {
    const q = `%${filter.search.toLowerCase()}%`;
    clauses.push(
      or(
        sql`lower(${serviceCustomers.name}) like ${q}`,
        sql`lower(${serviceJobs.title}) like ${q}`,
        sql`lower(coalesce(${serviceLocations.addressLine}, '')) like ${q}`,
      ),
    );
  }
  const where = clauses.length ? and(...clauses) : undefined;

  const rows = await db
    .select(jobSelect)
    .from(serviceJobs)
    .innerJoin(serviceCustomers, eq(serviceCustomers.id, serviceJobs.customerId))
    .leftJoin(serviceLocations, eq(serviceLocations.id, serviceJobs.locationId))
    .leftJoin(serviceTechnicians, eq(serviceTechnicians.id, serviceJobs.technicianId))
    .leftJoin(servicePianos, eq(servicePianos.id, serviceJobs.pianoId))
    .where(where)
    .orderBy(asc(serviceJobs.scheduledStart), desc(serviceJobs.createdAt))
    .limit(filter.limit ?? 200);

  const running = await runningTimersByJob();
  return rows.map((r) => toJobRow(r, running));
}

async function runningTimersByJob() {
  const logs = await db
    .select()
    .from(serviceTimeLogs)
    .where(isNull(serviceTimeLogs.endedAt))
    .orderBy(asc(serviceTimeLogs.startedAt));
  return new Map(
    logs.map((l) => [l.jobId, { id: l.id, kind: l.kind, startedAt: l.startedAt, technicianId: l.technicianId }]),
  );
}

export type JobDetail = {
  job: JobRow;
  customer: ServiceCustomer;
  location: ServiceLocation | null;
  piano: ServicePiano | null;
  technician: ServiceTechnician | null;
  items: ServiceJobItem[];
  events: ServiceJobEvent[];
  timeLogs: (ServiceTimeLog & { technicianName: string | null })[];
  invoices: (ServiceInvoice & { amountPaidCents: number })[];
  expenses: ServiceExpense[];
  catalog: ServiceCatalogItem[];
  customers: { id: string; name: string; isBatch: boolean }[];
  /** The customer's instruments, so a job with no piano can offer "Link piano". */
  customerPianos: ServicePiano[];
  technicians: ServiceTechnician[];
  totals: { subtotalCents: number; taxCents: number; totalCents: number; quotedCents: number };
  /** Set only for piano-sale jobs. */
  sale: {
    pianoLabel: string | null;
    stockExpensesCents: number;
    balanceCents: number;
    profit: { revenueCents: number; costOfGoodsCents: number; profitCents: number; marginPct: number };
  } | null;
};

/** The tax inputs a quote preview needs; comes from the owner's service settings. */
export type QuoteTaxSettings = Pick<ServiceSettings, "taxRateBps" | "vatEnabled">;

export async function getJobDetail(id: string, tax: QuoteTaxSettings): Promise<JobDetail | null> {
  const [row] = await db
    .select(jobSelect)
    .from(serviceJobs)
    .innerJoin(serviceCustomers, eq(serviceCustomers.id, serviceJobs.customerId))
    .leftJoin(serviceLocations, eq(serviceLocations.id, serviceJobs.locationId))
    .leftJoin(serviceTechnicians, eq(serviceTechnicians.id, serviceJobs.technicianId))
    .leftJoin(servicePianos, eq(servicePianos.id, serviceJobs.pianoId))
    .where(eq(serviceJobs.id, id))
    .limit(1);
  if (!row) return null;

  const running = await runningTimersByJob();
  const [customer, items, events, logs, invoices, expenses, catalog, customers, technicians, location, piano, technician, customerPianos] =
    await Promise.all([
      db.select().from(serviceCustomers).where(eq(serviceCustomers.id, row.job.customerId)).limit(1).then((r) => r[0]!),
      db.select().from(serviceJobItems).where(eq(serviceJobItems.jobId, id)).orderBy(asc(serviceJobItems.position), asc(serviceJobItems.id)),
      db.select().from(serviceJobEvents).where(eq(serviceJobEvents.jobId, id)).orderBy(desc(serviceJobEvents.at)).limit(60),
      db
        .select({ log: serviceTimeLogs, technicianName: serviceTechnicians.name })
        .from(serviceTimeLogs)
        .leftJoin(serviceTechnicians, eq(serviceTechnicians.id, serviceTimeLogs.technicianId))
        .where(eq(serviceTimeLogs.jobId, id))
        .orderBy(asc(serviceTimeLogs.startedAt)),
      db.select().from(serviceInvoices).where(eq(serviceInvoices.jobId, id)).orderBy(desc(serviceInvoices.issueDate)),
      db.select().from(serviceExpenses).where(eq(serviceExpenses.jobId, id)).orderBy(desc(serviceExpenses.spentAt)),
      getCatalog(true),
      db.select({ id: serviceCustomers.id, name: serviceCustomers.name, tags: serviceCustomers.tags }).from(serviceCustomers)
        .where(isNull(serviceCustomers.archivedAt)).orderBy(asc(serviceCustomers.name)),
      getTechnicians(true),
      row.job.locationId
        ? db.select().from(serviceLocations).where(eq(serviceLocations.id, row.job.locationId)).limit(1).then((r) => r[0] ?? null)
        : Promise.resolve(null),
      row.job.pianoId
        ? db.select().from(servicePianos).where(eq(servicePianos.id, row.job.pianoId)).limit(1).then((r) => r[0] ?? null)
        : Promise.resolve(null),
      row.job.technicianId
        ? db.select().from(serviceTechnicians).where(eq(serviceTechnicians.id, row.job.technicianId)).limit(1).then((r) => r[0] ?? null)
        : Promise.resolve(null),
      db.select().from(servicePianos).where(eq(servicePianos.customerId, row.job.customerId)).orderBy(asc(servicePianos.brand)),
    ]);

  // Quote preview uses the owner's current effective VAT setting via the shared calculator.
  const quote = computeTotals(items, { taxRateBps: tax.taxRateBps, vatEnabled: tax.vatEnabled });

  let sale: JobDetail["sale"] = null;
  if (row.job.jobType === "sale") {
    const [pianoRow, stock] = await Promise.all([
      row.job.salePianoId ? db.select({ brand: pianos.brand, model: pianos.model }).from(pianos).where(eq(pianos.id, row.job.salePianoId)).limit(1).then((r) => r[0] ?? null) : Promise.resolve(null),
      row.job.salePianoId
        ? db.select({ cents: sql<number>`coalesce(sum(${serviceExpenses.amountCents}), 0)::int` }).from(serviceExpenses)
            .where(and(eq(serviceExpenses.kind, "stock"), eq(serviceExpenses.pianoId, row.job.salePianoId))).then((r) => r[0]?.cents ?? 0)
        : Promise.resolve(0),
    ]);
    const done = ["completed", "invoiced", "paid"].includes(row.job.status);
    sale = {
      pianoLabel: pianoRow ? `${pianoRow.brand} ${pianoRow.model}` : null,
      stockExpensesCents: stock,
      balanceCents: saleBalanceCents(row.job, done),
      profit: salePianoProfit({ salePriceCents: row.job.salePriceCents, depositCents: row.job.depositCents, buyCostCents: row.job.buyCostCents, prepCostCents: row.job.prepCostCents, stockExpensesCents: stock }),
    };
  }

  return {
    job: toJobRow(row, running),
    customer: { ...customer, name: titleCaseName(customer.name) },
    location,
    piano,
    technician,
    items,
    events,
    timeLogs: logs.map((l) => ({ ...l.log, technicianName: l.technicianName })),
    invoices,
    expenses,
    catalog,
    customers: customers.map((c) => ({ id: c.id, name: titleCaseName(c.name), isBatch: isBatchCustomer(c.tags, c.name) })),
    customerPianos,
    technicians,
    totals: { subtotalCents: quote.subtotalCents, taxCents: quote.taxCents, totalCents: quote.totalCents, quotedCents: row.job.quotedCents },
    sale,
  };
}

/* ============================================================
 * Schedule + today
 * ============================================================ */

export type ScheduleBoard = {
  from: Date;
  to: Date;
  scheduled: JobRow[];
  unscheduled: JobRow[];
  technicians: ServiceTechnician[];
};

export async function getScheduleBoard(from: Date, to: Date): Promise<ScheduleBoard> {
  const [scheduled, unscheduled, technicians] = await Promise.all([
    getJobs({ from, to, limit: 400 }),
    db
      .select(jobSelect)
      .from(serviceJobs)
      .innerJoin(serviceCustomers, eq(serviceCustomers.id, serviceJobs.customerId))
      .leftJoin(serviceLocations, eq(serviceLocations.id, serviceJobs.locationId))
      .leftJoin(serviceTechnicians, eq(serviceTechnicians.id, serviceJobs.technicianId))
      .leftJoin(servicePianos, eq(servicePianos.id, serviceJobs.pianoId))
      .where(
        and(
          isNull(serviceJobs.scheduledStart),
          inArray(serviceJobs.status, ["lead", "quoted", "scheduled", "on_hold"]),
        ),
      )
      .orderBy(desc(serviceJobs.priority), asc(serviceJobs.createdAt))
      .limit(200)
      .then((rows) => runningTimersByJob().then((running) => rows.map((r) => toJobRow(r, running)))),
    getTechnicians(),
  ]);
  return { from, to, scheduled, unscheduled, technicians };
}

/** A money figure split between home service and piano sales (sales stay 0 until piano-sale jobs exist). */
export type Split = { service: number; sales: number };

export type TodayBoard = {
  date: Date;
  businessName: string;
  /** Per today's job: whether it already has a live (non-void) invoice — drives the next-step button. */
  invoiceByJob: Record<string, string>;
  /** Draft invoices waiting to be sent. */
  draftInvoices: (InvoiceRow & { code: string })[];
  /** Sent, unpaid invoices to chase, with the customer's Messenger handle when saved. */
  unpaid: (InvoiceRow & { code: string; messenger: string | null })[];
  /** Quotes sent more than 3 days ago with no answer. */
  staleQuotes: { id: string; title: string; customerName: string; customerPhone: string | null; quotedCents: number; days: number }[];
  /** Visits from tomorrow through the next 7 days. */
  next7: JobRow[];
  /** Sale jobs with a delivery coming up (or overdue) and money still to collect on delivery. */
  deliveryBalances: { jobId: string; title: string; customerName: string; customerPhone: string | null; deliveryAt: Date; balanceCents: number }[];
  week: { from: Date; to: Date; booked: Split; collected: Split; spent: Split; profit: Split; overheadCents: number };
  jobs: JobRow[];
  running: (ServiceTimeLog & { jobTitle: string; customerName: string; technicianName: string | null })[];
  technicians: ServiceTechnician[];
  recalls: RecallRow[];
  /** Past-due visits still marked scheduled / en route / on site — need closing out. */
  unfinished: JobRow[];
  /** Sent, unpaid invoices (oldest due first) — who to chase. */
  followUps: InvoiceRow[];
  stats: {
    jobsToday: number;
    completedToday: number;
    minutesWorked: number;
    minutesTravel: number;
    collectedTodayCents: number;
    /** Sent, unpaid balance as of today. Drafts and voids are excluded. */
    outstandingCents: number;
    overdueCents: number;
    outstandingCount: number;
    draftCount: number;
    draftCents: number;
    openQuotesCents: number;
  };
};

export async function getTodayBoard(ownerId: string, now: Date = new Date()): Promise<TodayBoard> {
  const dayStart = startOfManilaDayUTC(now);
  // Manila has no DST: a day is exactly 24h (addDays would use the server's timezone and end the day at 8am Manila).
  const dayEnd = addManilaDays(dayStart, 1);
  const week = manilaWeekBounds(now);

  const [jobs, technicians, recalls, running, moneyToday, timeToday, pastDue, snapshot] = await Promise.all([
    getJobs({ from: dayStart, to: dayEnd, limit: 200 }),
    getTechnicians(),
    getRecalls(now),
    db
      .select({ log: serviceTimeLogs, jobTitle: serviceJobs.title, customerName: serviceCustomers.name, technicianName: serviceTechnicians.name })
      .from(serviceTimeLogs)
      .innerJoin(serviceJobs, eq(serviceJobs.id, serviceTimeLogs.jobId))
      .innerJoin(serviceCustomers, eq(serviceCustomers.id, serviceJobs.customerId))
      .leftJoin(serviceTechnicians, eq(serviceTechnicians.id, serviceTimeLogs.technicianId))
      .where(isNull(serviceTimeLogs.endedAt))
      .orderBy(asc(serviceTimeLogs.startedAt)),
    db
      .select({ collected: sql<number>`coalesce(sum(${servicePayments.amountCents}), 0)::int` })
      .from(servicePayments)
      .where(and(gte(servicePayments.receivedAt, dayStart), lt(servicePayments.receivedAt, dayEnd))),
    db
      .select({
        kind: serviceTimeLogs.kind,
        minutes: sql<number>`coalesce(sum(${serviceTimeLogs.minutes}), 0)::int`,
      })
      .from(serviceTimeLogs)
      .where(and(isNotNull(serviceTimeLogs.endedAt), gte(serviceTimeLogs.startedAt, dayStart), lt(serviceTimeLogs.startedAt, dayEnd)))
      .groupBy(serviceTimeLogs.kind),
    getJobs({ statuses: ["scheduled", "en_route", "in_progress"], to: dayStart, limit: 200 }),
    getReceivablesSnapshot(now),
  ]);
  const followUps = snapshot.followUpIds.length
    ? await getInvoices({ ids: snapshot.followUpIds }, now).then((rows) => {
        const order = new Map(snapshot.followUpIds.map((id, i) => [id, i]));
        return rows.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
      })
    : [];

  const [settings, next7, draftRows, quotedRows, jobInvoices, weekBooked, weekCollected, weekExpenses, weekSold, deliveryRows, stockRows] = await Promise.all([
    getServiceSettings(ownerId),
    getJobs({ from: dayEnd, to: addManilaDays(dayStart, 8), statuses: ["lead", "quoted", "scheduled", "en_route", "in_progress", "on_hold"], limit: 100 }),
    getInvoices({ statuses: ["draft"], limit: 20 }, now),
    db
      .select({
        job: serviceJobs, customerName: serviceCustomers.name, customerPhone: serviceCustomers.phone,
        lastQuoted: sql<Date | null>`(select max(${serviceJobEvents.at}) from ${serviceJobEvents} where ${serviceJobEvents.jobId} = ${serviceJobs.id} and ${serviceJobEvents.type} = 'quoted')`,
      })
      .from(serviceJobs)
      .innerJoin(serviceCustomers, eq(serviceCustomers.id, serviceJobs.customerId))
      .where(eq(serviceJobs.status, "quoted")),
    jobs.length
      ? db.select({ jobId: serviceInvoices.jobId, id: serviceInvoices.id }).from(serviceInvoices)
          .where(and(inArray(serviceInvoices.jobId, jobs.map((j) => j.id)), isNull(serviceInvoices.voidedAt)))
      : Promise.resolve([] as { jobId: string | null; id: string }[]),
    db.select({
      jobType: serviceJobs.jobType,
      cents: sql<number>`coalesce(sum(case when ${serviceJobs.jobType} = 'sale' then ${serviceJobs.salePriceCents} else ${serviceJobs.quotedCents} end), 0)::int`,
    }).from(serviceJobs)
      .where(and(gte(serviceJobs.scheduledStart, week.from), lt(serviceJobs.scheduledStart, week.to), ne(serviceJobs.status, "cancelled")))
      .groupBy(serviceJobs.jobType),
    db.select({ cents: sql<number>`coalesce(sum(${servicePayments.amountCents}), 0)::int` }).from(servicePayments)
      .where(and(gte(servicePayments.receivedAt, week.from), lt(servicePayments.receivedAt, week.to))),
    db.select({ amountCents: serviceExpenses.amountCents, category: serviceExpenses.category, kind: serviceExpenses.kind, jobId: serviceExpenses.jobId })
      .from(serviceExpenses).where(and(gte(serviceExpenses.spentAt, week.from), lt(serviceExpenses.spentAt, week.to))),
    // Piano sales closed this week: price is recognised on completion (the balance is collected at delivery).
    db.select({
      pianoId: serviceJobs.salePianoId, salePriceCents: serviceJobs.salePriceCents, buyCostCents: serviceJobs.buyCostCents, prepCostCents: serviceJobs.prepCostCents,
    }).from(serviceJobs).where(and(
      eq(serviceJobs.jobType, "sale"), inArray(serviceJobs.status, COMPLETED_JOB_STATUSES),
      gte(sql`coalesce(${serviceJobs.completedAt}, ${serviceJobs.updatedAt})`, week.from), lt(sql`coalesce(${serviceJobs.completedAt}, ${serviceJobs.updatedAt})`, week.to),
    )),
    db.select({
      id: serviceJobs.id, title: serviceJobs.title, scheduledStart: serviceJobs.scheduledStart, salePriceCents: serviceJobs.salePriceCents,
      depositCents: serviceJobs.depositCents, customerName: serviceCustomers.name, customerPhone: serviceCustomers.phone,
    }).from(serviceJobs).innerJoin(serviceCustomers, eq(serviceCustomers.id, serviceJobs.customerId)).where(and(
      eq(serviceJobs.jobType, "sale"), inArray(serviceJobs.status, ["lead", "quoted", "scheduled", "en_route", "in_progress", "on_hold"]),
      isNotNull(serviceJobs.scheduledStart), lt(serviceJobs.scheduledStart, addManilaDays(dayStart, 8)),
    )).orderBy(asc(serviceJobs.scheduledStart)),
    db.select({ pianoId: serviceExpenses.pianoId, cents: sql<number>`coalesce(sum(${serviceExpenses.amountCents}), 0)::int` })
      .from(serviceExpenses).where(and(eq(serviceExpenses.kind, "stock"), isNotNull(serviceExpenses.pianoId))).groupBy(serviceExpenses.pianoId),
  ]);

  const invPrefix = settings.invoicePrefix;
  const withCode = <T extends InvoiceRow>(i: T) => ({ ...i, code: invoiceCode(invPrefix, i.invoiceNumber, i.issueDate) });
  const chaseCustomerIds = [...new Set(followUps.map((f) => f.customerId))];
  const tagRows = chaseCustomerIds.length
    ? await db.select({ id: serviceCustomers.id, tags: serviceCustomers.tags }).from(serviceCustomers).where(inArray(serviceCustomers.id, chaseCustomerIds))
    : [];
  const handles = new Map(tagRows.map((r) => [r.id, messengerHandle(r.tags)]));

  const staleQuotes = quotedRows
    .map((r) => ({ r, sentAt: r.lastQuoted ? new Date(r.lastQuoted) : r.job.updatedAt }))
    .filter(({ sentAt }) => isStaleQuote(sentAt, now))
    .sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime())
    .map(({ r, sentAt }) => ({
      id: r.job.id, title: r.job.title, customerName: titleCaseName(r.customerName), customerPhone: r.customerPhone,
      quotedCents: r.job.quotedCents, days: daysSince(sentAt, now),
    }));

  const unfinished = pastDue.filter((j) => needsClosing(j, now));
  const rec = snapshot.aging;
  const drafts = snapshot.drafts;

  const openQuotes = await db
    .select({ total: sql<number>`coalesce(sum(${serviceJobs.quotedCents}), 0)::int` })
    .from(serviceJobs)
    .where(inArray(serviceJobs.status, ["lead", "quoted"]));

  const minutesWorked = timeToday.find((t) => t.kind === "work")?.minutes ?? 0;
  const minutesTravel = timeToday.find((t) => t.kind === "travel")?.minutes ?? 0;

  const stockBy = new Map(stockRows.map((r) => [r.pianoId!, r.cents]));
  const weekSplit = financeSplit({
    serviceCollectedCents: weekCollected[0]?.cents ?? 0,
    periodExpenses: weekExpenses,
    sales: weekSold.map((j) => ({ pianoId: j.pianoId, salePriceCents: j.salePriceCents, buyCostCents: j.buyCostCents, prepCostCents: j.prepCostCents, stockExpensesCents: j.pianoId ? stockBy.get(j.pianoId) ?? 0 : 0 })),
    allStockExpenses: [], pianosWithSale: new Set<string>(),
  });
  const bookedBy = (t: string) => weekBooked.find((b) => b.jobType === t)?.cents ?? 0;
  return {
    date: dayStart,
    businessName: settings.businessName,
    invoiceByJob: Object.fromEntries(jobInvoices.filter((i) => i.jobId).map((i) => [i.jobId!, i.id])),
    draftInvoices: draftRows.map(withCode),
    unpaid: followUps.map((f) => ({ ...withCode(f), messenger: handles.get(f.customerId) ?? null })),
    staleQuotes,
    next7,
    deliveryBalances: deliveryRows
      .map((r) => ({ jobId: r.id, title: r.title, customerName: titleCaseName(r.customerName), customerPhone: r.customerPhone, deliveryAt: r.scheduledStart!, balanceCents: saleBalanceCents(r, false) }))
      .filter((r) => r.balanceCents > 0),
    week: {
      ...week,
      booked: { service: bookedBy("service"), sales: bookedBy("sale") },
      collected: { service: weekSplit.service.collectedCents, sales: weekSplit.sales.revenueCents },
      spent: { service: weekSplit.service.jobCostCents, sales: weekSplit.sales.costOfGoodsCents },
      profit: { service: weekSplit.service.profitCents, sales: weekSplit.sales.profitCents },
      overheadCents: weekSplit.overhead.cents,
    },
    jobs,
    running: running.map((r) => ({ ...r.log, jobTitle: r.jobTitle, customerName: titleCaseName(r.customerName), technicianName: r.technicianName })),
    technicians,
    recalls: recalls.slice(0, 8),
    unfinished,
    followUps,
    stats: {
      jobsToday: jobs.length,
      completedToday: jobs.filter((j) => j.status === "completed" || j.status === "invoiced" || j.status === "paid").length,
      minutesWorked,
      minutesTravel,
      collectedTodayCents: moneyToday[0]?.collected ?? 0,
      outstandingCents: rec.totalOutstandingCents,
      overdueCents: rec.overdueCents,
      outstandingCount: rec.buckets.reduce((n, b) => n + b.count, 0),
      draftCount: drafts.count,
      draftCents: drafts.totalCents,
      openQuotesCents: openQuotes[0]?.total ?? 0,
    },
  };
}

/* ============================================================
 * Invoices
 * ============================================================ */

export type InvoiceRow = ServiceInvoice & {
  customerName: string;
  customerPhone: string | null;
  jobCode: string | null;
  jobTitle: string | null;
  status: string;
  balanceCents: number;
  daysOverdue: number;
};

export type InvoiceFilter = { statuses?: string[]; ids?: string[]; customerId?: string; from?: Date; to?: Date; limit?: number };

export async function getInvoices(filter: InvoiceFilter = {}, now: Date = new Date()): Promise<InvoiceRow[]> {
  const clauses: (SQL | undefined)[] = [];
  if (filter.statuses?.length) clauses.push(inArray(serviceInvoices.status, filter.statuses));
  if (filter.ids) clauses.push(filter.ids.length ? inArray(serviceInvoices.id, filter.ids) : sql`false`);
  if (filter.customerId) clauses.push(eq(serviceInvoices.customerId, filter.customerId));
  if (filter.from) clauses.push(gte(serviceInvoices.issueDate, filter.from));
  if (filter.to) clauses.push(lt(serviceInvoices.issueDate, filter.to));
  const where = clauses.length ? and(...clauses) : undefined;

  const rows = await db
    .select({
      invoice: serviceInvoices,
      customerName: serviceCustomers.name,
      customerPhone: serviceCustomers.phone,
      jobNumber: serviceJobs.jobNumber,
      jobTitle: serviceJobs.title,
      jobCreatedAt: serviceJobs.createdAt,
    })
    .from(serviceInvoices)
    .innerJoin(serviceCustomers, eq(serviceCustomers.id, serviceInvoices.customerId))
    .leftJoin(serviceJobs, eq(serviceJobs.id, serviceInvoices.jobId))
    .where(where)
    .orderBy(desc(serviceInvoices.issueDate), desc(serviceInvoices.invoiceNumber))
    .limit(filter.limit ?? 300);

  return rows.map((r) => {
    const derived = invoiceStatus(r.invoice, now);
    return {
      ...r.invoice,
      status: derived,
      customerName: titleCaseName(r.customerName),
      customerPhone: r.customerPhone,
      jobCode: r.jobNumber ? jobCode("WO", r.jobNumber, r.jobCreatedAt) : null,
      jobTitle: r.jobTitle,
      balanceCents: balanceCents(r.invoice),
      daysOverdue: daysOverdue(r.invoice, now),
    };
  });
}

/**
 * Receivables as of today, computed over EVERY invoice (a slim select) — never over a
 * paginated list, so old unpaid invoices can't silently drop out of Outstanding / Overdue.
 */
export async function getReceivablesSnapshot(now: Date = new Date()) {
  const rows = await db
    .select({
      id: serviceInvoices.id, status: serviceInvoices.status, totalCents: serviceInvoices.totalCents,
      amountPaidCents: serviceInvoices.amountPaidCents, dueDate: serviceInvoices.dueDate,
      sentAt: serviceInvoices.sentAt, voidedAt: serviceInvoices.voidedAt,
    })
    .from(serviceInvoices);
  const live = countable(rows, now);
  return {
    aging: receivables(rows, now),
    drafts: draftSummary(rows, now),
    billedCents: billedCents(rows, now),
    collectedCents: live.reduce((s, i) => s + i.amountPaidCents, 0),
    followUpIds: needsFollowUp(rows, now).slice(0, 8).map((i) => i.id),
  };
}

export type InvoiceDetail = {
  invoice: InvoiceRow;
  items: ServiceInvoiceItem[];
  payments: ServicePayment[];
  customer: ServiceCustomer;
  job: ServiceJob | null;
  settings: ServiceSettings;
  catalog: ServiceCatalogItem[];
};

export async function getInvoiceDetail(id: string, ownerId: string, now: Date = new Date()): Promise<InvoiceDetail | null> {
  const [row] = await db
    .select({
      invoice: serviceInvoices,
      customer: serviceCustomers,
      job: serviceJobs,
      jobCreatedAt: serviceJobs.createdAt,
    })
    .from(serviceInvoices)
    .innerJoin(serviceCustomers, eq(serviceCustomers.id, serviceInvoices.customerId))
    .leftJoin(serviceJobs, eq(serviceJobs.id, serviceInvoices.jobId))
    .where(eq(serviceInvoices.id, id))
    .limit(1);
  if (!row) return null;

  const [items, payments, settings, catalog] = await Promise.all([
    db.select().from(serviceInvoiceItems).where(eq(serviceInvoiceItems.invoiceId, id))
      .orderBy(asc(serviceInvoiceItems.position), asc(serviceInvoiceItems.id)),
    db.select().from(servicePayments).where(eq(servicePayments.invoiceId, id)).orderBy(desc(servicePayments.receivedAt)),
    getServiceSettings(ownerId),
    getCatalog(true),
  ]);

  const derived = invoiceStatus(row.invoice, now);
  return {
    invoice: {
      ...row.invoice,
      status: derived,
      customerName: titleCaseName(row.customer.name),
      customerPhone: row.customer.phone,
      jobCode: row.job ? jobCode("WO", row.job.jobNumber, row.jobCreatedAt) : null,
      jobTitle: row.job?.title ?? null,
      balanceCents: balanceCents(row.invoice),
      daysOverdue: daysOverdue(row.invoice, now),
    },
    items,
    payments,
    customer: row.customer,
    job: row.job,
    settings,
    catalog,
  };
}

/* ============================================================
 * Expenses + time
 * ============================================================ */

/** Receipt images are data URLs (~MBs): lists carry only `hasReceipt`; the viewer fetches one on demand. */
export type ExpenseRow = Omit<ServiceExpense, "receiptUrl"> & { hasReceipt: boolean; jobCode: string | null; jobTitle: string | null; pianoLabel: string | null };

/** Showroom pianos a "stock" expense or a sale job can point at. Read-only use of the Piano Management inventory. */
export type PianoOption = { id: string; label: string; status: string; listPriceCents: number | null; stockCents: number };

export async function getPianoOptions(): Promise<PianoOption[]> {
  const [rows, stock] = await Promise.all([
    db.select({ id: pianos.id, brand: pianos.brand, model: pianos.model, year: pianos.year, status: pianos.status, price: pianos.priceCents })
      .from(pianos).orderBy(desc(pianos.createdAt)),
    db.select({ pianoId: serviceExpenses.pianoId, cents: sql<number>`coalesce(sum(${serviceExpenses.amountCents}), 0)::int` })
      .from(serviceExpenses).where(and(eq(serviceExpenses.kind, "stock"), isNotNull(serviceExpenses.pianoId))).groupBy(serviceExpenses.pianoId),
  ]);
  const stockBy = new Map(stock.map((r) => [r.pianoId!, r.cents]));
  return rows.map((r) => ({
    id: r.id, label: `${r.brand} ${r.model}${r.year ? ` (${r.year})` : ""}`, status: r.status,
    listPriceCents: r.price, stockCents: stockBy.get(r.id) ?? 0,
  }));
}

export async function getExpenses(from?: Date, to?: Date, limit = 300): Promise<ExpenseRow[]> {
  const clauses: (SQL | undefined)[] = [];
  if (from) clauses.push(gte(serviceExpenses.spentAt, from));
  if (to) clauses.push(lt(serviceExpenses.spentAt, to));
  const rows = await db
    .select({
      expense: serviceExpenses, hasReceipt: sql<boolean>`${serviceExpenses.receiptUrl} is not null`,
      jobNumber: serviceJobs.jobNumber, jobTitle: serviceJobs.title, jobCreatedAt: serviceJobs.createdAt,
      pianoBrand: pianos.brand, pianoModel: pianos.model,
    })
    .from(serviceExpenses)
    .leftJoin(serviceJobs, eq(serviceJobs.id, serviceExpenses.jobId))
    .leftJoin(pianos, eq(pianos.id, serviceExpenses.pianoId))
    .where(clauses.length ? and(...clauses) : undefined)
    .orderBy(desc(serviceExpenses.spentAt))
    .limit(limit);
  return rows.map(({ expense: { receiptUrl: _receipt, ...expense }, ...r }) => ({
    ...expense,
    hasReceipt: !!r.hasReceipt,
    jobCode: r.jobNumber ? jobCode("WO", r.jobNumber, r.jobCreatedAt) : null,
    jobTitle: r.jobTitle,
    pianoLabel: r.pianoBrand ? `${r.pianoBrand} ${r.pianoModel ?? ""}`.trim() : null,
  }));
}

/** Expenses (any date) with no kind saved yet. */
export async function countUnreviewedExpenses(): Promise<number> {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(serviceExpenses).where(isNull(serviceExpenses.kind));
  return row?.n ?? 0;
}

export async function getUnreviewedExpenses(limit = 500): Promise<ExpenseRow[]> {
  const rows = await db
    .select({ expense: serviceExpenses, jobNumber: serviceJobs.jobNumber, jobTitle: serviceJobs.title, jobCreatedAt: serviceJobs.createdAt })
    .from(serviceExpenses)
    .leftJoin(serviceJobs, eq(serviceJobs.id, serviceExpenses.jobId))
    .where(isNull(serviceExpenses.kind))
    .orderBy(desc(serviceExpenses.spentAt))
    .limit(limit);
  return rows.map(({ expense: { receiptUrl: _r, ...expense }, ...r }) => ({
    ...expense, hasReceipt: false,
    jobCode: r.jobNumber ? jobCode("WO", r.jobNumber, r.jobCreatedAt) : null, jobTitle: r.jobTitle, pianoLabel: null,
  }));
}

export async function getExpenseTotalsByCategory(from: Date, to: Date) {
  return db
    .select({
      category: serviceExpenses.category,
      amountCents: sql<number>`coalesce(sum(${serviceExpenses.amountCents}), 0)::int`,
      count: sql<number>`count(*)::int`,
    })
    .from(serviceExpenses)
    .where(and(gte(serviceExpenses.spentAt, from), lt(serviceExpenses.spentAt, to)))
    .groupBy(serviceExpenses.category)
    .orderBy(desc(sql`sum(${serviceExpenses.amountCents})`));
}

export type TimeLogRow = ServiceTimeLog & {
  jobTitle: string;
  customerName: string;
  technicianName: string | null;
  technicianColor: string | null;
  jobNumber: number;
  jobCreatedAt: Date;
};

export async function getTimeLogs(from: Date, to: Date, technicianId?: string): Promise<TimeLogRow[]> {
  const clauses: (SQL | undefined)[] = [
    gte(serviceTimeLogs.startedAt, from),
    lt(serviceTimeLogs.startedAt, to),
  ];
  if (technicianId) clauses.push(eq(serviceTimeLogs.technicianId, technicianId));
  const rows = await db
    .select({
      log: serviceTimeLogs,
      jobTitle: serviceJobs.title,
      jobNumber: serviceJobs.jobNumber,
      jobCreatedAt: serviceJobs.createdAt,
      customerName: serviceCustomers.name,
      technicianName: serviceTechnicians.name,
      technicianColor: serviceTechnicians.color,
    })
    .from(serviceTimeLogs)
    .innerJoin(serviceJobs, eq(serviceJobs.id, serviceTimeLogs.jobId))
    .innerJoin(serviceCustomers, eq(serviceCustomers.id, serviceJobs.customerId))
    .leftJoin(serviceTechnicians, eq(serviceTechnicians.id, serviceTimeLogs.technicianId))
    .where(and(...clauses))
    .orderBy(asc(serviceTimeLogs.startedAt));
  return rows.map(({ log, ...rest }) => ({ ...log, ...rest, customerName: titleCaseName(rest.customerName) }));
}

/* ============================================================
 * Finance
 * ============================================================ */

export type MonthlyPoint = SeriesPoint;

export type FinanceReport = {
  range: ResolvedRange;
  /** "day" buckets for This month, otherwise "month". */
  granularity: "day" | "month";
  months: MonthlyPoint[];
  kpis: {
    invoicedCents: number;
    invoiceCount: number;
    collectedCents: number;
    expenseCents: number;
    netCents: number;
    /** As of today — not range-dependent. Sent / part-paid invoices only. */
    outstandingCents: number;
    overdueCents: number;
    /** Invoiced ÷ invoices issued in the range, or ÷ jobs completed in the range — see `options.avgInvoiceBasis`. */
    avgInvoiceCents: number;
    /** Paid so far on what was invoiced in the range. */
    collectionRatePct: number;
  };
  aging: AgingSummary;
  /** Created but never sent: reported apart from invoiced / outstanding. */
  drafts: { count: number; totalCents: number };
  expenseByCategory: { category: string; amountCents: number; count: number }[];
  /** Profit split into Service / Piano sales / Overhead (stock only counts once its piano is sold). */
  split: FinanceSplit & { unreviewedCount: number };
  /** Piano sale jobs completed in the range, one row per piano. */
  pianoSales: {
    jobId: string; title: string; pianoLabel: string | null; customerName: string; soldAt: Date;
    priceCents: number; costCents: number; profitCents: number; marginPct: number;
  }[];
  topCustomers: { customerId: string; name: string; billedCents: number; paidCents: number }[];
  /** Empty when the owner has hidden job margins (`options.showJobMargins` false). */
  jobMargins: {
    jobId: string; title: string; customerName: string;
    invoicedCents: number; taxCents: number; revenueCents: number;
    costCents: number; profitCents: number; marginPct: number;
  }[];
  /** The reporting settings this report was computed with, so the UI can label it honestly. */
  options: FinanceReportOptions;
};

export type FinanceReportOptions = Pick<
  ServiceSettings,
  "avgInvoiceBasis" | "marginExcludesVat" | "includeLaborCost" | "showJobMargins"
>;

/** SQL twin of `isCountable`: not void, and sent (or at least part-paid). Drafts are excluded. */
const countableInvoiceSql = sql`${serviceInvoices.voidedAt} is null and (${serviceInvoices.sentAt} is not null or ${serviceInvoices.amountPaidCents} > 0)`;

export async function getFinanceReport(
  options: FinanceReportOptions,
  rangeKey: RangeKey = "90d",
  now: Date = new Date(),
): Promise<FinanceReport> {
  const range = resolveRange(rangeKey, now);
  const completedIn = (col: SQL | typeof serviceJobs.completedAt) => and(
    range.from ? gte(sql`coalesce(${col}, ${serviceJobs.updatedAt})`, range.from) : undefined,
    lt(sql`coalesce(${col}, ${serviceJobs.updatedAt})`, range.to),
  );

  const [allInvoices, paymentRows, expenseRows, jobRows, completedJobs] = await Promise.all([
    db
      .select({
        id: serviceInvoices.id, customerId: serviceInvoices.customerId, totalCents: serviceInvoices.totalCents,
        amountPaidCents: serviceInvoices.amountPaidCents, dueDate: serviceInvoices.dueDate,
        issueDate: serviceInvoices.issueDate, sentAt: serviceInvoices.sentAt,
        voidedAt: serviceInvoices.voidedAt, status: serviceInvoices.status,
      })
      .from(serviceInvoices),
    db
      .select({ receivedAt: servicePayments.receivedAt, amountCents: servicePayments.amountCents })
      .from(servicePayments)
      .where(and(range.from ? gte(servicePayments.receivedAt, range.from) : undefined, lt(servicePayments.receivedAt, range.to))),
    db
      .select({ spentAt: serviceExpenses.spentAt, amountCents: serviceExpenses.amountCents, category: serviceExpenses.category, kind: serviceExpenses.kind, pianoId: serviceExpenses.pianoId, jobId: serviceExpenses.jobId })
      .from(serviceExpenses)
      .where(and(range.from ? gte(serviceExpenses.spentAt, range.from) : undefined, lt(serviceExpenses.spentAt, range.to))),
    // Margins hidden in settings → skip the per-job queries entirely.
    options.showJobMargins
      ? db
          .select({
            jobId: serviceJobs.id, title: serviceJobs.title, customerName: serviceCustomers.name,
            laborCostCents: serviceJobs.laborCostCents, partsCostCents: serviceJobs.partsCostCents,
            completedAt: serviceJobs.completedAt,
          })
          .from(serviceJobs)
          .innerJoin(serviceCustomers, eq(serviceCustomers.id, serviceJobs.customerId))
          .where(
            and(
              eq(serviceJobs.jobType, "service"),
              ne(serviceJobs.status, "cancelled"),
              or(inArray(serviceJobs.status, COMPLETED_JOB_STATUSES), isNotNull(serviceJobs.completedAt)),
              completedIn(serviceJobs.completedAt),
            ),
          )
          .orderBy(desc(sql`coalesce(${serviceJobs.completedAt}, ${serviceJobs.updatedAt})`))
          .limit(25)
      : Promise.resolve([]),
    // Completed jobs in the range — the "job" basis denominator for the average.
    // Status counts too: invoicing a job moves it to "invoiced" without necessarily stamping completedAt.
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(serviceJobs)
      .where(
        and(
          eq(serviceJobs.jobType, "service"),
          ne(serviceJobs.status, "cancelled"),
          or(inArray(serviceJobs.status, COMPLETED_JOB_STATUSES), isNotNull(serviceJobs.completedAt)),
          completedIn(serviceJobs.completedAt),
        ),
      ),
  ]);

  // Money tied up in unsold piano stock is not an expense yet, so it stays out of Spent / Net and the chart (it shows as "stock on hand").
  const rollup = financeRollup({ invoices: allInvoices, payments: paymentRows, expenses: expenseRows.filter((e) => effectiveKind(e) !== "stock") }, rangeKey, now);

  // Piano sales: completed sale jobs. Stock is judged over all time (a piano bought last year and sold this month still carries its cost).
  const soldWhere = and(
    eq(serviceJobs.jobType, "sale"),
    inArray(serviceJobs.status, COMPLETED_JOB_STATUSES),
  );
  const [allStock, unreviewedCount, soldAll, soldNames] = await Promise.all([
    db.select({ pianoId: serviceExpenses.pianoId, amountCents: serviceExpenses.amountCents }).from(serviceExpenses).where(eq(serviceExpenses.kind, "stock")),
    countUnreviewedExpenses(),
    db.select({
      id: serviceJobs.id, title: serviceJobs.title, salePianoId: serviceJobs.salePianoId, salePriceCents: serviceJobs.salePriceCents,
      buyCostCents: serviceJobs.buyCostCents, prepCostCents: serviceJobs.prepCostCents, customerName: serviceCustomers.name,
      soldAt: sql<Date>`coalesce(${serviceJobs.completedAt}, ${serviceJobs.updatedAt})`,
    }).from(serviceJobs).innerJoin(serviceCustomers, eq(serviceCustomers.id, serviceJobs.customerId)).where(soldWhere),
    db.select({ id: pianos.id, brand: pianos.brand, model: pianos.model }).from(pianos),
  ]);
  const stockByPiano = new Map<string, number>();
  for (const e of allStock) if (e.pianoId) stockByPiano.set(e.pianoId, (stockByPiano.get(e.pianoId) ?? 0) + e.amountCents);
  const pianoName = new Map(soldNames.map((p) => [p.id, `${p.brand} ${p.model}`]));
  const soldInRange = soldAll.filter((j) => inRange(new Date(j.soldAt), range));
  const saleLines: SaleLine[] = soldInRange.map((j) => ({
    pianoId: j.salePianoId, salePriceCents: j.salePriceCents, buyCostCents: j.buyCostCents, prepCostCents: j.prepCostCents,
    stockExpensesCents: j.salePianoId ? stockByPiano.get(j.salePianoId) ?? 0 : 0,
  }));
  const split = {
    ...financeSplit({
      serviceCollectedCents: rollup.collectedCents,
      periodExpenses: expenseRows,
      sales: saleLines,
      allStockExpenses: allStock,
      pianosWithSale: new Set(soldAll.map((j) => j.salePianoId).filter((x): x is string => !!x)),
    }),
    unreviewedCount,
  };
  const pianoSales = soldInRange.map((j, i) => {
    const p = salePianoProfit({ ...saleLines[i]!, depositCents: 0 });
    return {
      jobId: j.id, title: j.title, pianoLabel: j.salePianoId ? pianoName.get(j.salePianoId) ?? null : null,
      customerName: titleCaseName(j.customerName), soldAt: new Date(j.soldAt),
      priceCents: p.revenueCents, costCents: p.costOfGoodsCents, profitCents: p.profitCents, marginPct: p.marginPct,
    };
  }).sort((a, b) => b.soldAt.getTime() - a.soldAt.getTime());

  // Top customers: billed on invoices issued in the range (countable only).
  const inRangeInvoices = countable(allInvoices, now).filter((i) => inRange(i.issueDate, range));
  const byCustomer = new Map<string, { billed: number; paid: number }>();
  for (const i of inRangeInvoices) {
    const c = byCustomer.get(i.customerId) ?? { billed: 0, paid: 0 };
    c.billed += i.totalCents; c.paid += i.amountPaidCents; byCustomer.set(i.customerId, c);
  }
  const topIds = [...byCustomer.entries()].sort((a, b) => b[1].billed - a[1].billed).slice(0, 6).map(([id]) => id);
  const nameRows = topIds.length
    ? await db.select({ id: serviceCustomers.id, name: serviceCustomers.name }).from(serviceCustomers).where(inArray(serviceCustomers.id, topIds))
    : [];
  const nameMap = new Map(nameRows.map((r) => [r.id, r.name]));

  const jobIds = jobRows.map((j) => j.jobId);
  const [invoiceByJob, expenseByJob] = await Promise.all([
    jobIds.length
      ? db
          .select({
            jobId: serviceInvoices.jobId,
            invoiced: sql<number>`coalesce(sum(case when ${countableInvoiceSql} then ${serviceInvoices.totalCents} else 0 end), 0)::int`,
            // Saved VAT on the same countable invoices — never re-estimated from today's rate.
            tax: sql<number>`coalesce(sum(case when ${countableInvoiceSql} then ${serviceInvoices.taxCents} else 0 end), 0)::int`,
          })
          .from(serviceInvoices)
          .where(inArray(serviceInvoices.jobId, jobIds))
          .groupBy(serviceInvoices.jobId)
      : Promise.resolve([] as { jobId: string | null; invoiced: number; tax: number }[]),
    jobIds.length
      ? db
          .select({ jobId: serviceExpenses.jobId, amount: sql<number>`coalesce(sum(${serviceExpenses.amountCents}), 0)::int` })
          .from(serviceExpenses)
          .where(inArray(serviceExpenses.jobId, jobIds))
          .groupBy(serviceExpenses.jobId)
      : Promise.resolve([] as { jobId: string | null; amount: number }[]),
  ]);

  const invoicedMap = new Map(invoiceByJob.map((r) => [r.jobId!, r]));
  const expenseMap = new Map(expenseByJob.map((r) => [r.jobId!, r.amount]));

  const avgDenominator = options.avgInvoiceBasis === "job" ? completedJobs[0]?.count ?? 0 : rollup.invoiceCount;

  const jobMargins = jobRows.map((j) => {
    const money = invoicedMap.get(j.jobId);
    const invoiced = money?.invoiced ?? 0;
    const tax = money?.tax ?? 0;
    const m = jobMargin(
      {
        laborCostCents: j.laborCostCents,
        partsCostCents: j.partsCostCents,
        expenseCents: expenseMap.get(j.jobId) ?? 0,
        invoicedCents: invoiced,
        taxCents: tax,
      },
      { marginExcludesVat: options.marginExcludesVat, includeLaborCost: options.includeLaborCost },
    );
    return {
      jobId: j.jobId,
      title: j.title,
      customerName: j.customerName,
      invoicedCents: invoiced,
      taxCents: tax,
      revenueCents: m.revenueCents,
      costCents: m.costCents,
      profitCents: m.profitCents,
      marginPct: m.marginPct,
    };
  });

  return {
    range,
    granularity: rollup.granularity,
    months: rollup.series,
    split,
    pianoSales,
    kpis: {
      invoicedCents: rollup.invoicedCents,
      invoiceCount: rollup.invoiceCount,
      collectedCents: rollup.collectedCents,
      expenseCents: rollup.expenseCents,
      netCents: rollup.netCents,
      outstandingCents: rollup.aging.totalOutstandingCents,
      overdueCents: rollup.aging.overdueCents,
      avgInvoiceCents: avgInvoiceCents(rollup.invoicedCents, avgDenominator),
      collectionRatePct: rollup.collectionRatePct,
    },
    aging: rollup.aging,
    drafts: rollup.drafts,
    expenseByCategory: rollup.expenseByCategory,
    topCustomers: topIds.map((id) => ({
      customerId: id, name: nameMap.get(id) ?? "—", billedCents: byCustomer.get(id)!.billed, paidCents: byCustomer.get(id)!.paid,
    })),
    jobMargins,
    options: {
      avgInvoiceBasis: options.avgInvoiceBasis,
      marginExcludesVat: options.marginExcludesVat,
      includeLaborCost: options.includeLaborCost,
      showJobMargins: options.showJobMargins,
    },
  };
}

/* ============================================================
 * Customer detail page
 * ============================================================ */

export type CustomerDetail = NonNullable<Awaited<ReturnType<typeof getCustomerDetail>>>;

export async function getCustomerDetail(id: string, now: Date = new Date()) {
  const [row] = await db.select().from(serviceCustomers).where(eq(serviceCustomers.id, id)).limit(1);
  if (!row) return null;
  const [locations, pianos, jobs, invoices] = await Promise.all([
    db.select().from(serviceLocations).where(eq(serviceLocations.customerId, id)).orderBy(asc(serviceLocations.label)),
    db.select().from(servicePianos).where(eq(servicePianos.customerId, id)).orderBy(asc(servicePianos.brand)),
    getJobs({ customerId: id, limit: 200 }),
    getInvoices({ customerId: id, limit: 300 }, now),
  ]);
  const when = (j: JobRow) => new Date(j.scheduledStart ?? j.createdAt).getTime();
  return {
    customer: { ...row, name: titleCaseName(row.name) },
    locations,
    pianos,
    jobs: [...jobs].sort((a, b) => when(b) - when(a)),
    invoices,
    billedCents: billedCents(invoices, now),
    outstandingCents: receivables(invoices, now).totalOutstandingCents,
    drafts: draftSummary(invoices, now),
  };
}

/* ============================================================
 * Lookup helpers used by forms
 * ============================================================ */

export async function getCustomerOptions() {
  const rows = await db
    .select({ id: serviceCustomers.id, name: serviceCustomers.name, tags: serviceCustomers.tags })
    .from(serviceCustomers)
    .where(isNull(serviceCustomers.archivedAt))
    .orderBy(asc(serviceCustomers.name));
  // `isBatch` = a trip / batch placeholder, which never needs a piano on its jobs.
  return rows.map((r) => ({ id: r.id, name: titleCaseName(r.name), isBatch: isBatchCustomer(r.tags, r.name) }));
}

export async function getLocationsForCustomer(customerId: string): Promise<ServiceLocation[]> {
  return db
    .select()
    .from(serviceLocations)
    .where(eq(serviceLocations.customerId, customerId))
    .orderBy(asc(serviceLocations.label));
}

export async function getPianosForCustomer(customerId: string): Promise<ServicePiano[]> {
  return db
    .select()
    .from(servicePianos)
    .where(eq(servicePianos.customerId, customerId))
    .orderBy(asc(servicePianos.brand));
}
