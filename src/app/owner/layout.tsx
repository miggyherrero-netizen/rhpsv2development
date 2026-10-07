import { requireUser } from "@/lib/auth";
import { db } from "@/db";
import { ownerPreferences } from "@/db/schema";
import { eq } from "drizzle-orm";
import OwnerShell from "@/components/owner-shell";
import type { ReactNode } from "react";
import { Figtree } from "next/font/google";

const figtree = Figtree({ subsets: ["latin"], variable: "--font-figtree", display: "swap" });

export const dynamic = "force-dynamic";

export default async function OwnerLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();
  const [prefs] = await db.select().from(ownerPreferences).where(eq(ownerPreferences.ownerId, user.id)).limit(1);
  if (!prefs) await db.insert(ownerPreferences).values({ ownerId: user.id });
  return <div className={figtree.variable}><OwnerShell userName={user.name}>{children}</OwnerShell></div>;
}
