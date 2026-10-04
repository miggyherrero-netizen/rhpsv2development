import "dotenv/config";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { eq } from "drizzle-orm";
import { db, pool } from "../src/db";
import { users } from "../src/db/schema";
import { hashPassword } from "../src/lib/security";

async function main() {
  const rl = createInterface({ input, output });
  const email = (await rl.question("Owner email: ")).trim().toLowerCase();
  const name = (await rl.question("Name (e.g. Robert Herrero): ")).trim();
  const password = await rl.question("New password (12+ characters): ");
  rl.close();
  if (!email.includes("@") || name.length === 0 || password.length < 12) {
    throw new Error("Need a valid email, a name and a password of 12+ characters.");
  }
  const passwordHash = hashPassword(password);
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (existing) {
    await db.update(users).set({ passwordHash, name, role: "owner" }).where(eq(users.id, existing.id));
    console.log("Owner password updated.");
  } else {
    await db.insert(users).values({ email, name, passwordHash, role: "owner" });
    console.log("Owner account created.");
  }
  await pool.end();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
