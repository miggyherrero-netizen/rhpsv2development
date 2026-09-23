import { db } from "@/db";
import { workers, projects } from "@/db/schema";
import { asc } from "drizzle-orm";
import { getTaskRows } from "@/server/data";
import TasksBoard from "@/components/tasks-board";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Tasks" };

export default async function TasksPage() {
  const [rows, w, p] = await Promise.all([
    getTaskRows(true),
    db.select().from(workers).orderBy(asc(workers.name)),
    db.select({ id: projects.id, clientName: projects.clientName, pianoBrand: projects.pianoBrand, pianoModel: projects.pianoModel }).from(projects).orderBy(asc(projects.clientName)),
  ]);
  return <TasksBoard tasks={rows} workers={w} projects={p} />;
}
