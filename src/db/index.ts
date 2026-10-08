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
    // Serverless-appropriate limits for Vercel + Supabase pooler
    max: 2, // Keep pool small (Vercel spins up multiple instances)
    connectionTimeoutMillis: 10_000, // Fail fast if pooler is saturated
    idleTimeoutMillis: 30_000, // Release idle connections quickly
    allowExitOnIdle: true, // Allow serverless function to shut down when idle
  });

pool.on("connect", (client) => {
  client.query('SET search_path TO "$user", public');
});

// Prevent unhandled 'error' events from crashing the process
// (Supabase pooler kills idle connections, emitting 'error' on the pool)
pool.on("error", (err) => {
  console.error("[pg.Pool] Idle client error (connection killed by pooler):", err.message);
  // Do not throw - this is expected behavior when pooler reclaims connections
});

// CRITICAL: Always cache pool globally, even in production
// Without this, every serverless invocation creates a new Pool → connection exhaustion
globalForDb.__arenaNextJsPostgresqlPool = pool;

export const db = drizzle(pool);
