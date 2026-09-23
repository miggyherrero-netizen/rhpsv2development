import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

/**
 * SSL on for hosted Postgres (e.g. the Supabase pooler), off for local/Docker databases.
 * Override with DATABASE_SSL=true|false.
 */
function sslEnabledFor(url: string): boolean {
  const flag = process.env.DATABASE_SSL?.toLowerCase();
  if (flag === "true") return true;
  if (flag === "false") return false;
  const host = new URL(url).hostname;
  return !["localhost", "127.0.0.1", "::1", "db"].includes(host);
}

const globalForDb = globalThis as typeof globalThis & {
  __arenaNextJsPostgresqlPool?: Pool;
};

export const pool =
  globalForDb.__arenaNextJsPostgresqlPool ??
  new Pool({
    connectionString: databaseUrl,
    ssl: sslEnabledFor(databaseUrl) ? { rejectUnauthorized: false } : false,
  });

pool.on("connect", (client) => {
  client.query('SET search_path TO "$user", public');
});

if (process.env.NODE_ENV !== "production") {
  globalForDb.__arenaNextJsPostgresqlPool = pool;
}

export const db = drizzle(pool);
