import type { Metadata } from "next";
import { getShowroom, getWebsiteContent } from "@/server/data";
import ShowroomPage from "@/components/showroom-page";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Showroom",
  description: "Every piano in the Herrero Pianos showroom in Davao — uprights and grands, filter by type or price.",
};

export default async function Showroom() {
  const [pianos, content] = await Promise.all([getShowroom(), getWebsiteContent()]);
  return <ShowroomPage pianos={pianos} content={content} />;
}
