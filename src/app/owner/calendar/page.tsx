import { requireUser } from "@/lib/auth";
import { getOwnerBundle } from "@/server/data";
import { addDays } from "@/lib/dates";
import CalendarClient from "@/components/owner-calendar";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Calendar" };

export default async function OwnerCalendarPage() {
  const user = await requireUser();
  const now = new Date();
  const bundle = await getOwnerBundle(user.id, addDays(now, -40), addDays(now, 120));
  return <CalendarClient bundle={bundle} now={now.toISOString()} />;
}
