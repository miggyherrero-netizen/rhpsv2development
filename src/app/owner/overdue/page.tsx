import { requireUser } from "@/lib/auth";
import { getOwnerBundle } from "@/server/data";
import { addDays } from "@/lib/dates";
import OwnerOverdueClient from "@/components/owner-overdue";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Overdue" };

export default async function OwnerOverduePage() {
  const user = await requireUser();
  const bundle = await getOwnerBundle(user.id, addDays(new Date(), -60), addDays(new Date(), 7));
  return <OwnerOverdueClient bundle={bundle} />;
}
