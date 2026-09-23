import { db } from "@/db";
import { settings } from "@/db/schema";
import SettingsClient from "@/components/settings-client";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const rows = await db.select().from(settings);
  const staleDays = Number(rows.find((s) => s.key === "staleUpdateDays")?.value ?? 10);
  return (
    <div className="p-4 sm:p-7 max-w-[1600px] mx-auto">
      <div className="mb-6">
        <h1 className="font-serif text-2xl sm:text-3xl text-white">Settings</h1>
        <p className="text-mist text-[12.5px] mt-1">Shop preferences and quick links.</p>
      </div>
      <SettingsClient staleDays={staleDays} />
    </div>
  );
}
