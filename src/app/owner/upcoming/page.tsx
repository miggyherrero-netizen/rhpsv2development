import { requireUser } from "@/lib/auth";
import { getOwnerBundle } from "@/server/data";
import { addDays } from "@/lib/dates";
import OwnerUpcomingClient from "@/components/owner-upcoming";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Upcoming" };

export default async function OwnerUpcomingPage() {
  const user = await requireUser();
  const bundle = await getOwnerBundle(user.id, new Date(), addDays(new Date(), 21));
  return <OwnerUpcomingClient bundle={bundle} />;
}
