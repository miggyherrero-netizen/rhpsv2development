"use server";

import { db } from "@/db";
import { settings, users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { hashPin, verifyPassword, verifyPin } from "@/lib/security";
import { createSession, endSession, requireUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { LOGIN_GATE_COOKIE } from "@/lib/auth-constants";
import { afterFailure, isLocked, LOCK_MESSAGE } from "@/lib/gos/lockout";
import { clearAttemptState, getAttemptState, saveAttemptState } from "@/server/gos/login-attempts";

const LOGIN_GATE_PIN_KEY = "loginGatePinHash";
const DEFAULT_LOGIN_GATE_PIN = "0000";

async function getLoginGatePinHash() {
  const [row] = await db.select().from(settings).where(eq(settings.key, LOGIN_GATE_PIN_KEY)).limit(1);
  if (row) return row.value;

  const value = hashPin(DEFAULT_LOGIN_GATE_PIN);
  await db.insert(settings).values({ key: LOGIN_GATE_PIN_KEY, value }).onConflictDoNothing();
  return value;
}

export async function login(email: string, password: string): Promise<{ ok: boolean; error?: string }> {
  const key = email.trim().toLowerCase();
  const now = new Date();
  const attempts = await getAttemptState(key);
  if (isLocked(attempts, now)) {
    return { ok: false, error: LOCK_MESSAGE };
  }
  const [user] = await db.select().from(users).where(eq(users.email, key)).limit(1);
  if (!user || !verifyPassword(password, user.passwordHash)) {
    const next = afterFailure(attempts, now);
    await saveAttemptState(key, next);
    return { ok: false, error: isLocked(next, now) ? LOCK_MESSAGE : "Incorrect email or password." };
  }
  await clearAttemptState(key);
  await createSession(user.id);
  return { ok: true };
}

export async function unlockLogin(pin: string): Promise<{ ok: boolean; error?: string }> {
  if (!/^\d{4}$/.test(pin)) {
    return { ok: false, error: "Enter the 4-digit PIN." };
  }

  const pinHash = await getLoginGatePinHash();
  if (!verifyPin(pin, pinHash)) {
    return { ok: false, error: "Incorrect PIN." };
  }

  const jar = await cookies();
  jar.set(LOGIN_GATE_COOKIE, "ok", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 10 * 60,
  });
  return { ok: true };
}

export async function unlockLoginForm(formData: FormData) {
  const pin = String(formData.get("pin") ?? "");
  const res = await unlockLogin(pin);
  if (res.ok) redirect("/login");
  redirect("/login-gate?error=1");
}

export async function resetLoginGatePin(pin: string): Promise<{ ok: boolean; error?: string }> {
  await requireUser();

  if (!/^\d{4}$/.test(pin)) {
    return { ok: false, error: "PIN must be exactly 4 digits." };
  }

  const value = hashPin(pin);
  await db.insert(settings).values({ key: LOGIN_GATE_PIN_KEY, value })
    .onConflictDoUpdate({ target: settings.key, set: { value } });
  return { ok: true };
}

export async function logout() {
  await endSession();
  const jar = await cookies();
  jar.delete(LOGIN_GATE_COOKIE);
  redirect("/login-gate");
}
