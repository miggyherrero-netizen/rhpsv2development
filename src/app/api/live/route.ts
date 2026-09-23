import { NextResponse } from "next/server";
import { getLiveOps } from "@/server/data";
import { getUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const data = await getLiveOps();
  return NextResponse.json(data);
}
