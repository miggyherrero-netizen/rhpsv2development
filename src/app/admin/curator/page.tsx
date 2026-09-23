import { db } from "@/db";
import { projects } from "@/db/schema";
import { asc } from "drizzle-orm";
import CuratorClient from "@/components/curator-client";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Client Curator" };

export default async function CuratorPage() {
  const rows = await db
    .select({ id: projects.id, clientName: projects.clientName, pianoBrand: projects.pianoBrand, pianoModel: projects.pianoModel, portalUuid: projects.portalUuid, imageUrl: projects.imageUrl })
    .from(projects)
    .orderBy(asc(projects.clientName));
  return <CuratorClient projects={rows} />;
}
