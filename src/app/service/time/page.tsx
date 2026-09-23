import { requireUser } from "@/lib/auth";
import { addDays, startOfManilaDayUTC, startOfWeek, ymd } from "@/lib/dates";
import { getTimeLogs, getTechnicians } from "@/server/service-data";
import { db } from "@/db";
import { serviceTimeLogs, serviceJobs, serviceCustomers, serviceTechnicians } from "@/db/schema";
import { and, asc, eq, isNull } from "drizzle-orm";
import TimeClient from "@/components/service-time";
import type { TimeLogRow } from "@/server/service-data";

export const dynamic = "force-dynamic";

export default async function ServiceTimePage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  await requireUser();
  const { range = "week" } = await searchParams;

  const today = startOfManilaDayUTC(new Date());
  const monday = startOfManilaDayUTC(startOfWeek(new Date(), 1));
  let from = monday;
  let to = addDays(monday, 7);
  if (range === "last") {
    from = addDays(monday, -7);
    to = monday;
  } else if (range === "month") {
    from = startOfManilaDayUTC(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
    to = addDays(today, 1);
  }

  const [logs, technicians] = await Promise.all([getTimeLogs(from, to), getTechnicians()]);

  const runningRows = await db
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
    .where(isNull(serviceTimeLogs.endedAt))
    .orderBy(asc(serviceTimeLogs.startedAt));

  const running: TimeLogRow[] = runningRows.map(({ log, ...rest }) => ({ ...log, ...rest }));

  return (
    <TimeClient
      logs={logs}
      running={running}
      technicians={technicians.map((t) => ({
        id: t.id,
        name: t.name,
        color: t.color,
        hourlyRateCents: t.hourlyRateCents,
      }))}
      range={range}
    />
  );
}
