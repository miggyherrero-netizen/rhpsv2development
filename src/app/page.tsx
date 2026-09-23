import { getShowroom, getWebsiteContent } from "@/server/data";
import PublicSite from "@/components/public-site";

export const dynamic = "force-dynamic";

export default async function Home() {
  const [pianos, content] = await Promise.all([getShowroom(), getWebsiteContent()]);
  return <PublicSite pianos={pianos} content={content} />;
}
