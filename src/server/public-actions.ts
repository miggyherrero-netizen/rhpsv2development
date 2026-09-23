"use server";

import { db } from "@/db";
import { inquiries } from "@/db/schema";

export async function submitInquiry(input: {
  name: string; phone?: string; pianoContext?: string; message?: string; source?: string;
}) {
  const name = input.name.trim();
  if (!name) return { ok: false as const, error: "Please tell us your name." };
  const phone = input.phone?.trim() ?? "";
  if (!/^\d{11}$/.test(phone)) {
    return { ok: false as const, error: "Please enter an 11-digit phone number." };
  }
  await db.insert(inquiries).values({
    name,
    phone,
    pianoContext: input.pianoContext?.trim() || null,
    message: input.message?.trim() || null,
    source: input.source || "assessment",
  });
  return { ok: true as const };
}
