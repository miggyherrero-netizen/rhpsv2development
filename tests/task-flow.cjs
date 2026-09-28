/* Integration checks against an isolated PostgreSQL schema; no application rows are modified.
   Run: node tests/task-flow.cjs (uses local .env DB_* settings). */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { randomUUID } = require("node:crypto");
const { AsyncLocalStorage } = require("node:async_hooks");
const ts = require("typescript");
const { Pool } = require("pg");
const { drizzle } = require("drizzle-orm/node-postgres");
require("dotenv").config({ quiet: true });

const namespace = `taskflow_test_${randomUUID().replaceAll("-", "")}`;
const config = {
  ...(process.env.DATABASE_URL ? { connectionString: process.env.DATABASE_URL } : {}),
  host: process.env.TEST_DB_HOST || "localhost", port: Number(process.env.DB_PORT || 5432),
  user: process.env.DB_USER || "postgres", password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || "nextjs_db",
};
const setup = new Pool(config);
const pool = new Pool({ ...config, options: `-c search_path=${namespace}` });
const db = drizzle(pool);
const context = new AsyncLocalStorage();
const cache = new Map();
function load(relative) {
  const filename = path.resolve(__dirname, "..", relative);
  if (cache.has(filename)) return cache.get(filename).exports;
  const mod = { exports: {} }; cache.set(filename, mod);
  const output = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const localRequire = (name) => {
    if (name === "@/db") return { db, pool };
    if (name === "next/headers") return { cookies: async () => ({
      get: (key) => context.getStore()?.get(key) ? { value: context.getStore().get(key) } : undefined,
      set: (key, value) => context.getStore().set(key, value), delete: (key) => context.getStore().delete(key),
    }) };
    if (name === "next/cache") return { revalidatePath: () => {} };
    if (name === "next/navigation") return { redirect: () => { throw new Error("AUTH_REDIRECT"); } };
    if (name.startsWith("@/")) return load(`src/${name.slice(2)}.ts`);
    return require(name);
  };
  vm.runInThisContext(`(function(require,module,exports){${output}\n})`, { filename })(localRequire, mod, mod.exports);
  return mod.exports;
}

async function main() {
  await setup.query(`CREATE SCHEMA "${namespace}"`);
  try {
    for (const table of ["users", "sessions", "workers", "projects", "tasks", "task_assignees", "time_entries", "worker_breaks", "payments"]) {
      await pool.query(`CREATE TABLE "${table}" (LIKE public."${table}" INCLUDING ALL)`);
    }
    await pool.query('ALTER TABLE tasks ADD COLUMN IF NOT EXISTS archived_at timestamp');
    await pool.query('ALTER TABLE time_entries ADD FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE SET NULL');
    const admin = load("src/server/admin.ts");
    const workshop = load("src/server/workshop.ts");
    const auth = load("src/lib/auth.ts");
    const { signPayload } = load("src/lib/security.ts");
    const [owner, workerA, workerB, project] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    await pool.query("INSERT INTO users (id,email,password_hash,name,role) VALUES ($1,'test@example.invalid','unused','Test owner','owner')", [owner]);
    await pool.query("INSERT INTO workers (id,name,pin_hash) VALUES ($1,'Test A','unused'),($2,'Test B','unused')", [workerA, workerB]);
    await pool.query("INSERT INTO projects (id,client_name,piano_brand,piano_model) VALUES ($1,'Test client','Test','Piano')", [project]);
    const ownerCookies = new Map();
    await context.run(ownerCookies, () => auth.createSession(owner));
    const workerCookies = (id) => new Map([["hp_worker", signPayload(`${id}:${Date.now() + 60000}`)]]);
    const a = workerCookies(workerA), b = workerCookies(workerB);
    const as = (cookies, fn) => context.run(cookies, fn);
    const row = async (id) => (await pool.query('SELECT * FROM tasks WHERE id=$1', [id])).rows[0];
    async function add(title, extra = {}) {
      const result = await as(ownerCookies, () => admin.createTask({ title, kind: "standalone", estimatedMinutes: 30, ...extra }));
      assert.equal(result.ok, true);
      return (await pool.query('SELECT id FROM tasks WHERE title=$1', [title])).rows[0].id;
    }
    assert.equal((await as(ownerCookies, () => admin.createTask({ title: "", kind: "standalone" }))).ok, false);
    assert.equal((await as(ownerCookies, () => admin.createTask({ title: "Missing project", kind: "project" }))).ok, false);
    const task = await add("Standalone");
    const linked = await add("Project task", { kind: "project", projectId: project });
    assert.equal((await row(task)).project_id, null);
    assert.equal((await row(linked)).project_id, project);
    await as(a, () => workshop.clockIn());
    const shift = (await pool.query('SELECT * FROM time_entries WHERE worker_id=$1', [workerA])).rows[0];
    await pool.query('INSERT INTO payments (time_entry_id,amount_cents) VALUES ($1,100)', [shift.id]);
    assert.equal((await as(a, () => workshop.startTask(task))).ok, true);
    assert.equal((await row(task)).status, "in_progress");
    assert.equal((await as(b, () => workshop.startTask(task))).ok, false, "another worker cannot steal a taken task");
    assert.equal((await as(b, () => workshop.finishTask(task))).ok, false);
    await as(a, () => workshop.startBreak());
    await as(a, () => workshop.endBreak());
    assert.equal((await as(a, () => workshop.finishTask(task))).ok, true);
    assert.equal((await row(task)).status, "done");
    assert.ok((await as(a, () => workshop.getWorkerState())).completed.some((t) => t.id === task));
    assert.equal((await as(a, () => workshop.releaseTask(task))).ok, false, "done tasks cannot be released");
    assert.equal((await as(a, () => workshop.startTask(task))).ok, false);
    const completion = (await row(task)).completed_at.getTime();
    await assert.rejects(as(a, () => admin.archiveTask(task)), /AUTH_REDIRECT/);
    await assert.rejects(as(a, () => admin.deleteTask(task)), /AUTH_REDIRECT/);
    await assert.rejects(as(a, () => admin.restoreTask(task)), /AUTH_REDIRECT/);
    await pool.query("UPDATE users SET role='viewer' WHERE id=$1", [owner]);
    await assert.rejects(as(ownerCookies, () => admin.archiveTask(task)), /Only the owner/);
    await pool.query("UPDATE users SET role='owner' WHERE id=$1", [owner]);
    assert.equal((await as(ownerCookies, () => admin.archiveTask(linked))).ok, false, "unfinished tasks cannot be archived");
    assert.equal((await as(ownerCookies, () => admin.archiveTask(task))).ok, true);
    assert.ok((await row(task)).archived_at);
    assert.equal((await row(task)).completed_at.getTime(), completion);
    assert.ok(!(await as(a, () => workshop.getWorkerState())).completed.some((t) => t.id === task));
    assert.equal((await as(ownerCookies, () => admin.updateTask(task, { status: "available" }))).ok, false);
    assert.equal((await as(ownerCookies, () => admin.restoreTask(task))).ok, true);
    assert.equal((await row(task)).status, "done");
    assert.ok((await as(a, () => workshop.getWorkerState())).completed.some((t) => t.id === task));
    const assigned = await add("Assigned", { assignedWorkerId: workerA });
    assert.equal((await as(b, () => workshop.startTask(assigned))).ok, false);
    const race = await add("Race");
    const results = await Promise.all([as(a, () => workshop.startTask(race)), as(b, () => workshop.startTask(race))]);
    assert.equal(results.filter((r) => r.ok).length, 1, "one winner for simultaneous take");
    await as(ownerCookies, () => admin.deleteTask(task));
    assert.equal(await row(task), undefined);
    const preserved = (await pool.query('SELECT * FROM time_entries WHERE id=$1', [shift.id])).rows[0];
    assert.equal(preserved.rate_at_clock_in_cents, shift.rate_at_clock_in_cents);
    assert.equal(preserved.clock_in.getTime(), shift.clock_in.getTime());
    assert.equal((await pool.query('SELECT * FROM payments WHERE time_entry_id=$1', [shift.id])).rowCount, 1);
    assert.equal((await pool.query('SELECT * FROM worker_breaks WHERE time_entry_id=$1', [shift.id])).rowCount, 1);
    const data = load("src/server/data.ts");
    assert.equal((await data.getProjectRows())[0].openTasks, 1);
    console.log("PASS: separation, validation, Take/Done, retained completions, assignment/claim protection, concurrent take, owner-only archive/restore/delete, and attendance/payment preservation.");
  } finally {
    await pool.end();
    await setup.query(`DROP SCHEMA "${namespace}" CASCADE`);
    await setup.end();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
