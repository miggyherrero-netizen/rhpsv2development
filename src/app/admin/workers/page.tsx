import { db } from "@/db";
import { workers } from "@/db/schema";
import { asc } from "drizzle-orm";
import { getLiveOps } from "@/server/data";
import WorkersClient from "@/components/workers-client";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Workers" };

export default async function WorkersPage() {
  const [rows, live] = await Promise.all([db.select().from(workers).orderBy(asc(workers.name)), getLiveOps()]);
  return <WorkersClient workers={rows} liveWorkerIds={live.workers.map((w) => w.workerId)} />;
}
