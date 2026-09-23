import { getDashboard } from "@/server/data";
import { getUser } from "@/lib/auth";
import AdminDashboard from "@/components/admin-dashboard";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Dashboard" };

export default async function AdminPage() {
  const [data, user] = await Promise.all([getDashboard(), getUser()]);
  return <AdminDashboard data={data} firstName={user?.name.split(" ")[0] ?? "Owner"} />;
}
