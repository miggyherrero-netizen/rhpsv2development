import GosEmpty from "@/components/gos/empty";
import CustomersClient from "@/components/gos/customers-client";
import { listCustomers } from "@/server/gos/customers";

export default async function CustomersPage() {
  const res = await listCustomers();
  if (!res.ok) return <p role="alert" className="gos-card mt-4">{res.error}</p>;
  if (res.value.length === 0) {
    return <GosEmpty title="Customers" text="No customers yet. Tap + Add inquiry when someone messages you." />;
  }
  return <CustomersClient rows={JSON.parse(JSON.stringify(res.value))} />;
}
