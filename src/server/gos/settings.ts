"use server";

import { and, asc, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import { gosAds, gosSettings, type GosAd } from "@/db/gos-schema";
import { defaultGosSettings, gosSettingsSchema, type GosSettings } from "@/lib/gos/settings";
import { requireOwnerAction } from "@/server/gos/guard";

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

const DEFAULT_ADS = ["Photo 01", "Creative 02 Grand", "Creative 03 Upright"];

export async function loadGosSettings(): Promise<Result<GosSettings>> {
  const auth = await requireOwnerAction();
  if (!auth.ok) return auth;
  const [row] = await db.select().from(gosSettings).where(eq(gosSettings.id, 1)).limit(1);
  if (!row) {
    const fresh = defaultGosSettings();
    await db.insert(gosSettings).values({ id: 1, data: fresh }).onConflictDoNothing();
    return { ok: true, value: fresh };
  }
  const parsed = gosSettingsSchema.safeParse(row.data);
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false, error: "Settings are damaged. Restore from backup." };
}

export async function saveGosSettings(next: GosSettings): Promise<Result<GosSettings>> {
  const auth = await requireOwnerAction();
  if (!auth.ok) return auth;
  const parsed = gosSettingsSchema.safeParse(next);
  if (!parsed.success) return { ok: false, error: "Not saved — check the highlighted value." };
  await db
    .insert(gosSettings)
    .values({ id: 1, data: parsed.data, updatedAt: new Date() })
    .onConflictDoUpdate({ target: gosSettings.id, set: { data: parsed.data, updatedAt: new Date() } });
  return { ok: true, value: parsed.data };
}

export async function listAds(): Promise<Result<GosAd[]>> {
  const auth = await requireOwnerAction();
  if (!auth.ok) return auth;
  let rows = await db.select().from(gosAds).orderBy(asc(gosAds.sortOrder), asc(gosAds.createdAt));
  if (rows.length === 0) {
    await db.insert(gosAds).values(DEFAULT_ADS.map((name, i) => ({ name, sortOrder: i }))).onConflictDoNothing();
    rows = await db.select().from(gosAds).orderBy(asc(gosAds.sortOrder), asc(gosAds.createdAt));
  }
  return { ok: true, value: rows };
}

export async function addAd(name: string): Promise<Result<GosAd>> {
  const auth = await requireOwnerAction();
  if (!auth.ok) return auth;
  const clean = name.trim();
  if (clean.length < 1 || clean.length > 60) return { ok: false, error: "Ad name must be 1–60 characters." };
  const [row] = await db.insert(gosAds).values({ name: clean, sortOrder: 99 }).onConflictDoNothing().returning();
  return row ? { ok: true, value: row } : { ok: false, error: "That ad name already exists." };
}

export async function setAdRetired(id: string, retired: boolean): Promise<Result<null>> {
  const auth = await requireOwnerAction();
  if (!auth.ok) return auth;
  if (retired) {
    const active = await db.select({ id: gosAds.id }).from(gosAds).where(and(eq(gosAds.retired, false), ne(gosAds.id, id)));
    if (active.length === 0) return { ok: false, error: "Keep at least one active ad name." };
  }
  await db.update(gosAds).set({ retired }).where(eq(gosAds.id, id));
  return { ok: true, value: null };
}
