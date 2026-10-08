import { requireUser } from "@/lib/auth";
import { getJobs, getCustomerOptions, getPianoOptions, getTechnicians } from "@/server/service-data";
import JobsClient from "@/components/service-jobs";

export const dynamic = "force-dynamic";

export default async function ServiceJobsPage({
  searchParams,
}: {
  searchParams: Promise<{ new?: string; filter?: string }>;
}) {
  await requireUser();
  const { new: isNew, filter } = await searchParams;
  const [jobs, customers, technicians, showroomPianos] = await Promise.all([
    getJobs({ limit: 300, newestFirst: true }),
    getCustomerOptions(),
    getTechnicians(),
    getPianoOptions(),
  ]);
  return (
    <JobsClient
      jobs={jobs}
      customers={customers}
      showroomPianos={showroomPianos}
      technicians={technicians.map((t) => ({ id: t.id, name: t.name, color: t.color }))}
      initialNew={isNew === "1"}
      initialFilter={filter}
    />
  );
}
