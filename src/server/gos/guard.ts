import { redirect } from "next/navigation";
import { getUser } from "@/lib/auth";
import type { User } from "@/db/schema";
import { assertGosEnv } from "@/lib/gos/env";
import { isOwner } from "@/lib/gos/owner";

/** Pages: signed out → login; signed in but not owner → "forbidden". */
export async function requireOwnerPage(): Promise<User | "forbidden"> {
  assertGosEnv();
  const user = await getUser();
  if (!user) redirect("/login");
  return isOwner(user) ? user : "forbidden";
}

/** Server actions: never return data unless the caller is the owner. */
export async function requireOwnerAction(): Promise<{ ok: true; user: User } | { ok: false; error: string }> {
  assertGosEnv();
  const user = await getUser();
  if (!user) return { ok: false, error: "Please sign in again." };
  if (!isOwner(user)) return { ok: false, error: "No access (403)." };
  return { ok: true, user };
}
