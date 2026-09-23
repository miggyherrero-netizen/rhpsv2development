import { requireUser } from "@/lib/auth";
import { getOwnerBundle } from "@/server/data";
import { addDays } from "@/lib/dates";
import OwnerTasksClient from "@/components/owner-tasks";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Tasks" };

export default async function OwnerTasksPage() {
  const user = await requireUser();
  const bundle = await getOwnerBundle(user.id, addDays(new Date(), -7), addDays(new Date(), 30));
  return <OwnerTasksClient bundle={bundle} />;
}
