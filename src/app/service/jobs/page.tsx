import { requireUser } from "@/lib/auth";
import { getJobs, getCustomerOptions, getPianoOptions, getPianoOwnerId, getTechnicians } from "@/server/service-data";
import { parseJobsPageParams, resolveJobsPrefill, wantsJobsPrefill } from "@/lib/service-waitlist-convert";
import JobsClient from "@/components/service-jobs";

export const dynamic = "force-dynamic";

export default async function ServiceJobsPage({
  searchParams,
}: {
  searchParams: Promise<{ new?: string; filter?: string; customer?: string; piano?: string }>;
}) {
  await requireUser();
  const params = parseJobsPageParams(await searchParams);
  const [jobs, customers, technicians, showroomPianos] = await Promise.all([
    getJobs({ limit: 300, newestFirst: true }),
    getCustomerOptions(),
    getTechnicians(),
    getPianoOptions(),
  ]);
  // ?customer= / ?piano= only count when they point at real rows (and the piano is that customer's).
  const prefill = wantsJobsPrefill(params)
    ? resolveJobsPrefill(params, { customerIds: new Set(customers.map((c) => c.id)), pianoOwnerId: params.pianoId ? await getPianoOwnerId(params.pianoId) : null })
    : null;
  return (
    <JobsClient
      jobs={jobs}
      customers={customers}
      showroomPianos={showroomPianos}
      technicians={technicians.map((t) => ({ id: t.id, name: t.name, color: t.color }))}
      initialNew={params.open}
      initialPrefill={prefill}
      initialFilter={params.filter}
    />
  );
}
