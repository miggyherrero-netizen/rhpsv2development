import { eq } from "drizzle-orm";
import { db } from "@/db";
import { settings } from "@/db/schema";
import { HERO_IMAGE_KEY, HERO_IMAGE_RE } from "@/lib/hero-image";

export const dynamic = "force-dynamic";

/** Public: the homepage hero photo the owner uploaded. The page links it as /hero-image?v=<version>. */
export async function GET() {
  const [row] = await db.select().from(settings).where(eq(settings.key, HERO_IMAGE_KEY)).limit(1);
  const m = row && HERO_IMAGE_RE.test(row.value) ? /^data:(image\/[a-z]+);base64,(.*)$/.exec(row.value) : null;
  if (!m) return new Response("Not found", { status: 404 });
  return new Response(Buffer.from(m[2], "base64"), {
    headers: {
      "Content-Type": m[1],
      "X-Content-Type-Options": "nosniff",
      // The ?v= query changes on every upload, so a long cache is safe.
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
