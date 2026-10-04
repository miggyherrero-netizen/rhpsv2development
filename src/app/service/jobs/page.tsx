import { requireUser } from "@/lib/auth";
import { getJobs, getCustomerOptions, getTechnicians } from "@/server/service-data";
import JobsClient from "@/components/service-jobs";

export const dynamic = "force-dynamic";

export default async function ServiceJobsPage({
  searchParams,
}: {
  searchParams: Promise<{ new?: string; filter?: string }>;
}) {
  await requireUser();
  const { new: isNew, filter } = await searchParams;
  const [jobs, customers, technicians] = await Promise.all([
    getJobs({ limit: 300 }),
    getCustomerOptions(),
    getTechnicians(),
  ]);
  return (
    <JobsClient
      jobs={jobs}
      customers={customers}
      technicians={technicians.map((t) => ({ id: t.id, name: t.name, color: t.color }))}
      initialNew={isNew === "1"}
      initialFilter={filter}
    />
  );
}
