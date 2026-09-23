import { requireUser } from "@/lib/auth";
import { getOwnerBundle } from "@/server/data";
import { addDays } from "@/lib/dates";
import OwnerInboxClient from "@/components/owner-inbox";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Inbox" };

export default async function OwnerInboxPage() {
  const user = await requireUser();
  const bundle = await getOwnerBundle(user.id, addDays(new Date(), -7), addDays(new Date(), 14));
  return <OwnerInboxClient bundle={bundle} />;
}
