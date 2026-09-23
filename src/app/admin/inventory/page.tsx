import { db } from "@/db";
import { inventoryItems } from "@/db/schema";
import { asc } from "drizzle-orm";
import InventoryClient from "@/components/inventory-client";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Inventory" };

export default async function InventoryPage() {
  const items = await db.select().from(inventoryItems).orderBy(asc(inventoryItems.category), asc(inventoryItems.name));
  return <InventoryClient items={items} />;
}
