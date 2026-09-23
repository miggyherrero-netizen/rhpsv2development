import { db } from "@/db";
import { workers } from "@/db/schema";
import { asc } from "drizzle-orm";
import { getProjectRows } from "@/server/data";
import ProjectsBoard from "@/components/projects-board";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Projects" };

export default async function ProjectsPage() {
  const [rows, w] = await Promise.all([
    getProjectRows(),
    db.select().from(workers).orderBy(asc(workers.name)),
  ]);
  return <ProjectsBoard projects={rows} workers={w} />;
}
