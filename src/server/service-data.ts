/**
 * Home-service **reads**. Every query lives here so pages stay thin and Server Actions
 * stay write-only. Amounts are integer centavos; dates are UTC instants rendered in
 * Asia/Manila by the format helpers.
 */

import { db } from "@/db";
import {
  serviceTechnicians, serviceCustomers, serviceLocations, servicePianos, serviceCatalog,
  serviceJobs, serviceJobItems, serviceJobEvents, serviceTimeLogs, serviceInvoices,
  serviceInvoiceItems, servicePayments, serviceExpenses, serviceSettings,
  type ServiceTechnician, type ServiceCustomer, type ServiceLocation, type ServicePiano,
  type ServiceCatalogItem, type ServiceJob, type ServiceJobItem, type ServiceJobEvent,
  type ServiceTimeLog, type ServiceInvoice, type ServiceInvoiceItem, type ServicePayment,
  type ServiceExpense, type ServiceSetting,
} from "@/db/schema";
import { and, asc, desc, eq, gte, lt, isNull, isNotNull, or, ne, sql, inArray, type SQL } from "drizzle-orm";
import { startOfManilaDayUTC, addDays, expandRecurrence } from "@/lib/dates";
import {
  agingSummary, avgInvoiceCents, balanceCents, computeTotals, daysOverdue, invoiceStatus, jobCode,
  jobMargin, DEFAULT_WORKING_HOURS, COMPLETED_JOB_STATUSES,
  type AgingSummary, type AvgInvoiceBasis, type WorkingHours,
} from "@/lib/service";

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
      lastServiceAt: sql<Date | null>`max(${serviceJobs.completedAt})`,
    })
    .from(serviceJobs)
    .groupBy(serviceJobs.customerId);

  const moneyStats = await db
    .select({
      customerId: serviceInvoices.customerId,
      billed: sql<number>`coalesce(sum(case when ${serviceInvoices.voidedAt} is null then ${serviceInvoices.totalCents} else 0 end), 0)::int`,
      paid: sql<number>`coalesce(sum(${serviceInvoices.amountPaidCents}), 0)::int`,
    })
    .from(serviceInvoices)
    .groupBy(serviceInvoices.customerId);

  const jobMap = new Map(jobStats.map((j) => [j.customerId, j]));
  const moneyMap = new Map(moneyStats.map((m) => [m.customerId, m]));
  const locationMap = new Map(locations.map((l) => [l.id, l]));

  return customers.map((c) => {
    const jobs = jobMap.get(c.id);
    const money = moneyMap.get(c.id);
    const billed = money?.billed ?? 0;
    const paid = money?.paid ?? 0;
    return {
      ...c,
      locations: locations.filter((l) => l.customerId === c.id),
      pianos: pianos
        .filter((p) => p.customerId === c.id)
        .map((p) => ({ ...p, locationLabel: p.locationId ? locationMap.get(p.locationId)?.label ?? null : null })),
      jobCount: jobs?.total ?? 0,
      openJobCount: jobs?.open ?? 0,
      lastServiceAt: jobs?.lastServiceAt ?? null,
      billedCents: billed,
      paidCents: paid,
      outstandingCents: Math.max(0, billed - paid),
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
    customerName: customer.name,
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
    customerName: r.customerName,
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
  customers: { id: string; name: string }[];
  technicians: ServiceTechnician[];
  totals: { subtotalCents: number; taxCents: number; totalCents: number; quotedCents: number };
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
  const [customer, items, events, logs, invoices, expenses, catalog, customers, technicians, location, piano, technician] =
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
      db.select({ id: serviceCustomers.id, name: serviceCustomers.name }).from(serviceCustomers)
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
    ]);

  // Quote preview uses the owner's current effective VAT setting via the shared calculator.
  const quote = computeTotals(items, { taxRateBps: tax.taxRateBps, vatEnabled: tax.vatEnabled });

  return {
    job: toJobRow(row, running),
    customer,
    location,
    piano,
    technician,
    items,
    events,
    timeLogs: logs.map((l) => ({ ...l.log, technicianName: l.technicianName })),
    invoices,
    expenses,
    catalog,
    customers,
    technicians,
    totals: { subtotalCents: quote.subtotalCents, taxCents: quote.taxCents, totalCents: quote.totalCents, quotedCents: row.job.quotedCents },
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

export type TodayBoard = {
  date: Date;
  jobs: JobRow[];
  running: (ServiceTimeLog & { jobTitle: string; customerName: string; technicianName: string | null })[];
  technicians: ServiceTechnician[];
  recalls: RecallRow[];
  stats: {
    jobsToday: number;
    completedToday: number;
    minutesWorked: number;
    minutesTravel: number;
    collectedTodayCents: number;
    outstandingCents: number;
    openQuotesCents: number;
  };
};

export async function getTodayBoard(now: Date = new Date()): Promise<TodayBoard> {
  const dayStart = startOfManilaDayUTC(now);
  const dayEnd = addDays(dayStart, 1);

  const [jobs, technicians, recalls, running, moneyToday, timeToday] = await Promise.all([
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
  ]);

  const outstanding = await db
    .select({
      billed: sql<number>`coalesce(sum(case when ${serviceInvoices.voidedAt} is null then ${serviceInvoices.totalCents} else 0 end), 0)::int`,
      paid: sql<number>`coalesce(sum(${serviceInvoices.amountPaidCents}), 0)::int`,
    })
    .from(serviceInvoices);

  const openQuotes = await db
    .select({ total: sql<number>`coalesce(sum(${serviceJobs.quotedCents}), 0)::int` })
    .from(serviceJobs)
    .where(inArray(serviceJobs.status, ["lead", "quoted"]));

  const minutesWorked = timeToday.find((t) => t.kind === "work")?.minutes ?? 0;
  const minutesTravel = timeToday.find((t) => t.kind === "travel")?.minutes ?? 0;

  return {
    date: dayStart,
    jobs,
    running: running.map((r) => ({ ...r.log, jobTitle: r.jobTitle, customerName: r.customerName, technicianName: r.technicianName })),
    technicians,
    recalls: recalls.slice(0, 8),
    stats: {
      jobsToday: jobs.length,
      completedToday: jobs.filter((j) => j.status === "completed" || j.status === "invoiced" || j.status === "paid").length,
      minutesWorked,
      minutesTravel,
      collectedTodayCents: moneyToday[0]?.collected ?? 0,
      outstandingCents: Math.max(0, (outstanding[0]?.billed ?? 0) - (outstanding[0]?.paid ?? 0)),
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

export type InvoiceFilter = { statuses?: string[]; customerId?: string; from?: Date; to?: Date; limit?: number };

export async function getInvoices(filter: InvoiceFilter = {}, now: Date = new Date()): Promise<InvoiceRow[]> {
  const clauses: (SQL | undefined)[] = [];
  if (filter.statuses?.length) clauses.push(inArray(serviceInvoices.status, filter.statuses));
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
      customerName: r.customerName,
      customerPhone: r.customerPhone,
      jobCode: r.jobNumber ? jobCode("WO", r.jobNumber, r.jobCreatedAt) : null,
      jobTitle: r.jobTitle,
      balanceCents: balanceCents(r.invoice),
      daysOverdue: daysOverdue(r.invoice, now),
    };
  });
}

export type InvoiceDetail = {
  invoice: InvoiceRow;
  items: ServiceInvoiceItem[];
  payments: ServicePayment[];
  customer: ServiceCustomer;
  job: ServiceJob | null;
  settings: ServiceSettings;
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

  const [items, payments, settings] = await Promise.all([
    db.select().from(serviceInvoiceItems).where(eq(serviceInvoiceItems.invoiceId, id))
      .orderBy(asc(serviceInvoiceItems.position), asc(serviceInvoiceItems.id)),
    db.select().from(servicePayments).where(eq(servicePayments.invoiceId, id)).orderBy(desc(servicePayments.receivedAt)),
    getServiceSettings(ownerId),
  ]);

  const derived = invoiceStatus(row.invoice, now);
  return {
    invoice: {
      ...row.invoice,
      status: derived,
      customerName: row.customer.name,
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
  };
}

/* ============================================================
 * Expenses + time
 * ============================================================ */

export type ExpenseRow = ServiceExpense & { jobCode: string | null; jobTitle: string | null };

export async function getExpenses(from?: Date, to?: Date, limit = 300): Promise<ExpenseRow[]> {
  const clauses: (SQL | undefined)[] = [];
  if (from) clauses.push(gte(serviceExpenses.spentAt, from));
  if (to) clauses.push(lt(serviceExpenses.spentAt, to));
  const rows = await db
    .select({ expense: serviceExpenses, jobNumber: serviceJobs.jobNumber, jobTitle: serviceJobs.title, jobCreatedAt: serviceJobs.createdAt })
    .from(serviceExpenses)
    .leftJoin(serviceJobs, eq(serviceJobs.id, serviceExpenses.jobId))
    .where(clauses.length ? and(...clauses) : undefined)
    .orderBy(desc(serviceExpenses.spentAt))
    .limit(limit);
  return rows.map((r) => ({
    ...r.expense,
    jobCode: r.jobNumber ? jobCode("WO", r.jobNumber, r.jobCreatedAt) : null,
    jobTitle: r.jobTitle,
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
  return rows.map(({ log, ...rest }) => ({ ...log, ...rest }));
}

/* ============================================================
 * Finance
 * ============================================================ */

export type MonthKey = { year: number; month: number; label: string };

export type MonthlyPoint = {
  key: string;
  label: string;
  invoicedCents: number;
  collectedCents: number;
  expenseCents: number;
  jobCount: number;
};

export type FinanceReport = {
  months: MonthlyPoint[];
  kpis: {
    invoicedCents: number;
    collectedCents: number;
    expenseCents: number;
    netCents: number;
    outstandingCents: number;
    overdueCents: number;
    /** Invoiced ÷ non-void invoices, or ÷ all completed jobs — see `options.avgInvoiceBasis`. */
    avgInvoiceCents: number;
    collectionRatePct: number;
  };
  aging: AgingSummary;
  expenseByCategory: { category: string; amountCents: number; count: number }[];
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

function monthStartUTC(year: number, month: number) {
  return new Date(Date.UTC(year, month, 1));
}

export async function getFinanceReport(
  options: FinanceReportOptions,
  months = 6,
  now: Date = new Date(),
): Promise<FinanceReport> {
  const first = monthStartUTC(now.getUTCFullYear(), now.getUTCMonth() - (months - 1));
  const seriesStart = startOfManilaDayUTC(first);

  const [invoiceRows, paymentRows, expenseRows, allInvoices, categoryRows, customerRows, jobRows, completedJobs] = await Promise.all([
    db
      .select({
        month: sql<string>`to_char(${serviceInvoices.issueDate} AT TIME ZONE 'Asia/Manila', 'YYYY-MM')`,
        amount: sql<number>`coalesce(sum(case when ${serviceInvoices.voidedAt} is null then ${serviceInvoices.totalCents} else 0 end), 0)::int`,
        jobCount: sql<number>`count(*)::int`,
      })
      .from(serviceInvoices)
      .where(gte(serviceInvoices.issueDate, seriesStart))
      .groupBy(sql`to_char(${serviceInvoices.issueDate} AT TIME ZONE 'Asia/Manila', 'YYYY-MM')`),
    db
      .select({
        month: sql<string>`to_char(${servicePayments.receivedAt} AT TIME ZONE 'Asia/Manila', 'YYYY-MM')`,
        amount: sql<number>`coalesce(sum(${servicePayments.amountCents}), 0)::int`,
      })
      .from(servicePayments)
      .where(gte(servicePayments.receivedAt, seriesStart))
      .groupBy(sql`to_char(${servicePayments.receivedAt} AT TIME ZONE 'Asia/Manila', 'YYYY-MM')`),
    db
      .select({
        month: sql<string>`to_char(${serviceExpenses.spentAt} AT TIME ZONE 'Asia/Manila', 'YYYY-MM')`,
        amount: sql<number>`coalesce(sum(${serviceExpenses.amountCents}), 0)::int`,
      })
      .from(serviceExpenses)
      .where(gte(serviceExpenses.spentAt, seriesStart))
      .groupBy(sql`to_char(${serviceExpenses.spentAt} AT TIME ZONE 'Asia/Manila', 'YYYY-MM')`),
    db
      .select({
        id: serviceInvoices.id, totalCents: serviceInvoices.totalCents,
        amountPaidCents: serviceInvoices.amountPaidCents, dueDate: serviceInvoices.dueDate,
        issueDate: serviceInvoices.issueDate, sentAt: serviceInvoices.sentAt,
        voidedAt: serviceInvoices.voidedAt, status: serviceInvoices.status,
      })
      .from(serviceInvoices),
    getExpenseTotalsByCategory(seriesStart, addDays(now, 1)),
    db
      .select({
        customerId: serviceInvoices.customerId,
        name: serviceCustomers.name,
        billed: sql<number>`coalesce(sum(case when ${serviceInvoices.voidedAt} is null then ${serviceInvoices.totalCents} else 0 end), 0)::int`,
        paid: sql<number>`coalesce(sum(${serviceInvoices.amountPaidCents}), 0)::int`,
      })
      .from(serviceInvoices)
      .innerJoin(serviceCustomers, eq(serviceCustomers.id, serviceInvoices.customerId))
      .groupBy(serviceInvoices.customerId, serviceCustomers.name)
      .orderBy(desc(sql`sum(${serviceInvoices.totalCents})`))
      .limit(6),
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
              ne(serviceJobs.status, "cancelled"),
              or(inArray(serviceJobs.status, COMPLETED_JOB_STATUSES), isNotNull(serviceJobs.completedAt)),
            ),
          )
          .orderBy(desc(sql`coalesce(${serviceJobs.completedAt}, ${serviceJobs.updatedAt})`))
          .limit(25)
      : Promise.resolve([]),
    // All-time completed jobs (invoiced or not) — the "job" basis denominator for the
    // average. Deliberately separate from the 25-row margins list above. Status counts too:
    // invoicing a job moves it to "invoiced" without necessarily stamping completedAt.
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(serviceJobs)
      .where(
        and(
          ne(serviceJobs.status, "cancelled"),
          or(inArray(serviceJobs.status, COMPLETED_JOB_STATUSES), isNotNull(serviceJobs.completedAt)),
        ),
      ),
  ]);

  const jobIds = jobRows.map((j) => j.jobId);
  const [invoiceByJob, expenseByJob] = await Promise.all([
    jobIds.length
      ? db
          .select({
            jobId: serviceInvoices.jobId,
            invoiced: sql<number>`coalesce(sum(case when ${serviceInvoices.voidedAt} is null then ${serviceInvoices.totalCents} else 0 end), 0)::int`,
            // Saved VAT on the same non-void invoices — never re-estimated from today's rate.
            tax: sql<number>`coalesce(sum(case when ${serviceInvoices.voidedAt} is null then ${serviceInvoices.taxCents} else 0 end), 0)::int`,
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

  // Build the monthly series in Asia/Manila month buckets.
  const monthKeys: string[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    monthKeys.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  const invMap = new Map(invoiceRows.map((r) => [r.month, r]));
  const payMap = new Map(paymentRows.map((r) => [r.month, r.amount]));
  const expMap = new Map(expenseRows.map((r) => [r.month, r.amount]));

  const monthsOut: MonthlyPoint[] = monthKeys.map((key) => {
    const [y, m] = key.split("-").map(Number);
    const label = new Date(Date.UTC(y!, m! - 1, 1)).toLocaleDateString("en-US", {
      month: "short", year: "2-digit", timeZone: "UTC",
    });
    return {
      key,
      label,
      invoicedCents: invMap.get(key)?.amount ?? 0,
      collectedCents: payMap.get(key) ?? 0,
      expenseCents: expMap.get(key) ?? 0,
      jobCount: invMap.get(key)?.jobCount ?? 0,
    };
  });

  const aging = agingSummary(allInvoices, now);
  const liveInvoices = allInvoices.filter((i) => !i.voidedAt);
  const invoicedCents = liveInvoices.reduce((s, i) => s + i.totalCents, 0);
  const collectedCents = allInvoices.reduce((s, i) => s + i.amountPaidCents, 0);
  const expenseCents = categoryRows.reduce((s, c) => s + c.amountCents, 0);
  const avgDenominator = options.avgInvoiceBasis === "job"
    ? completedJobs[0]?.count ?? 0
    : liveInvoices.length;

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
    months: monthsOut,
    kpis: {
      invoicedCents,
      collectedCents,
      expenseCents,
      netCents: collectedCents - expenseCents,
      outstandingCents: aging.totalOutstandingCents,
      overdueCents: aging.overdueCents,
      avgInvoiceCents: avgInvoiceCents(invoicedCents, avgDenominator),
      collectionRatePct: invoicedCents > 0 ? Math.round((collectedCents / invoicedCents) * 100) : 0,
    },
    aging,
    expenseByCategory: categoryRows,
    topCustomers: customerRows.map((c) => ({
      customerId: c.customerId, name: c.name, billedCents: c.billed, paidCents: c.paid,
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
 * Lookup helpers used by forms
 * ============================================================ */

export async function getCustomerOptions() {
  return db
    .select({ id: serviceCustomers.id, name: serviceCustomers.name })
    .from(serviceCustomers)
    .where(isNull(serviceCustomers.archivedAt))
    .orderBy(asc(serviceCustomers.name));
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
