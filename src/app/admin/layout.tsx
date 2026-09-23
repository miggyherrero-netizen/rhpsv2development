import { requireUser } from "@/lib/auth";
import AdminShell from "@/components/admin-shell";
import type { ReactNode } from "react";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();
  return <AdminShell userName={user.name}>{children}</AdminShell>;
}
