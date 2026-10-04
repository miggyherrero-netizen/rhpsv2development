/** Same string as the fallback in src/lib/security.ts (left unchanged there on purpose). */
export const DEV_AUTH_SECRET = "herrero-atelier-dev-secret-do-not-use-in-prod";

export function gosEnvProblems(env: Record<string, string | undefined>): string[] {
  if (env.NODE_ENV !== "production") return [];
  const problems: string[] = [];
  if (!env.AUTH_SECRET || env.AUTH_SECRET === DEV_AUTH_SECRET) {
    problems.push("AUTH_SECRET is missing or uses the dev value");
  }
  if (!env.DATABASE_URL) problems.push("DATABASE_URL is missing");
  return problems;
}

export function assertGosEnv(env: Record<string, string | undefined> = process.env): void {
  const problems = gosEnvProblems(env);
  if (problems.length > 0) {
    throw new Error(`Growth OS cannot start: ${problems.join("; ")}`);
  }
}
