"use server";

import { db } from "@/db";
import { inquiries } from "@/db/schema";
import { createWaitlistFromInquiry } from "@/server/service-waitlist-core";

export async function submitInquiry(input: {
  name: string; phone?: string; pianoContext?: string; message?: string; source?: string;
}) {
  const name = input.name.trim().slice(0, 120);
  if (!name) return { ok: false as const, error: "Please tell us your name." };
  const phone = input.phone?.trim() ?? "";
  if (!/^\d{11}$/.test(phone)) {
    return { ok: false as const, error: "Please enter an 11-digit phone number." };
  }
  await db.insert(inquiries).values({
    name,
    phone,
    pianoContext: input.pianoContext?.trim().slice(0, 200) || null,
    message: input.message?.trim().slice(0, 1_000) || null,
    source: input.source || "assessment",
  });
  // The inquiry also joins the Home Service waitlist (area read from what they wrote; "Unsorted" if unclear).
  await createWaitlistFromInquiry({ name, phone, pianoContext: input.pianoContext, message: input.message });
  return { ok: true as const };
}
