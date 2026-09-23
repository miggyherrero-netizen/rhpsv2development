import { requireUser } from "@/lib/auth";
import { db } from "@/db";
import { ownerCategories, ownerPreferences } from "@/db/schema";
import { eq, asc } from "drizzle-orm";
import OwnerSettingsClient from "@/components/owner-settings";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Workspace Settings" };

export default async function OwnerSettingsPage() {
  const user = await requireUser();
  const [cats, prefRows] = await Promise.all([
    db.select().from(ownerCategories).orderBy(asc(ownerCategories.position)),
    db.select().from(ownerPreferences).where(eq(ownerPreferences.ownerId, user.id)).limit(1),
  ]);
  return <OwnerSettingsClient categories={cats} prefs={prefRows[0] ?? null} />;
}
