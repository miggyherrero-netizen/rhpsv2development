import { requireUser } from "@/lib/auth";
import { getOwnerBundle } from "@/server/data";
import { addDays } from "@/lib/dates";
import TodayClient from "@/components/owner-today";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Today" };

export default async function OwnerTodayPage() {
  const user = await requireUser();
  const bundle = await getOwnerBundle(user.id, addDays(new Date(), -7), addDays(new Date(), 14));
  return <TodayClient bundle={bundle} />;
}
