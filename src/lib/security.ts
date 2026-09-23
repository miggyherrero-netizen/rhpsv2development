import {
  scryptSync,
  randomBytes,
  timingSafeEqual,
  createHmac,
  createHash,
} from "crypto";

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const computed = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  return computed.length === expected.length && timingSafeEqual(computed, expected);
}

export function hashPin(pin: string): string {
  return createHash("sha256").update(`herrero-pin-v1:${pin}`).digest("hex");
}

export function verifyPin(pin: string, stored: string): boolean {
  const a = Buffer.from(hashPin(pin));
  const b = Buffer.from(stored);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const AUTH_SECRET =
  process.env.AUTH_SECRET ?? "herrero-atelier-dev-secret-do-not-use-in-prod";

export function signPayload(payload: string): string {
  const sig = createHmac("sha256", AUTH_SECRET).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function verifySigned(token: string | undefined | null): string | null {
  if (!token) return null;
  const idx = token.lastIndexOf(".");
  if (idx <= 0) return null;
  const payload = token.slice(0, idx);
  const sig = token.slice(idx + 1);
  const expected = createHmac("sha256", AUTH_SECRET)
    .update(payload)
    .digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return payload;
}

export function newToken(): string {
  return randomBytes(32).toString("base64url");
}
